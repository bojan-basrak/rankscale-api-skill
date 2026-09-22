#!/usr/bin/env node
// Run Rankscale search terms in bulk: every term in a topic (or on a brand) until each reaches a run count.
// Why it works this way and how to use it safely: references/bulk-runs.md. Needs Node 18+ (global fetch).
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = (process.env.RANKSCALE_BASE_URL || 'https://rankscale.ai').replace(/\/+$/, '');
const RATE_PER_MIN = 170; // headroom under the API's 200 requests/min
const STAGGER_MS = 200;
const MAX_FAILS = 5;
const COST_PER_ENGINE_RUN = 0.25; // rankCredits; verified for single-engine terms (2026-09)

const USAGE = `Usage: node bulk_run.js --brand <name|id> (--topic <name|id> | --all-terms) (--target N | --add N) [options]

Without --execute this is a dry run: it prints the plan and fires nothing.

  --target N           each term ends with N runs in total (existing runs count; safe to re-run)
  --add N              each term gets N more runs than it has now
  --engine <id>        only terms that use this engine
  --execute            trigger the runs
  --key-file <path>    read the API key from this file (default: env RANKSCALE_API_KEY)
  --max-concurrent N   most terms running at once (default 40)
  --poll-seconds N     how often to read executionsAmount (default 15)
  --probe-minutes N    re-fire a term that shows no completion after this long (default 3)
  --max-minutes N      stop after this long (default 180)
  --out <dir>          output folder (default Rankscale/bulk-run-<timestamp>)`;

function fail(msg) {
  console.error(`Error: ${msg}\n\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv) {
  const switches = new Set(['execute', 'all-terms', 'help']);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) fail(`unexpected argument "${a}"`);
    const name = a.slice(2);
    if (switches.has(name)) { out[name] = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`);
    out[name] = v;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(USAGE); process.exit(0); }
if (!args.brand) fail('--brand is required');
if (!args.topic && !args['all-terms']) fail('pass --topic <name|id>, or --all-terms to run every term on the brand');
if (args.topic && args['all-terms']) fail('use either --topic or --all-terms, not both');
if ((args.target === undefined) === (args.add === undefined)) fail('pass exactly one of --target N or --add N');

function num(name, def, min, integer) {
  if (args[name] === undefined) return def;
  const n = Number(args[name]);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    fail(`--${name} must be ${integer ? 'a whole number' : 'a number'} of at least ${min}`);
  }
  return n;
}

const target = num('target', null, 1, true);
const add = num('add', null, 1, true);
const maxConcurrent = num('max-concurrent', 40, 1, true);
const pollMs = num('poll-seconds', 15, 1, false) * 1000;
const probeMs = num('probe-minutes', 3, 0.1, false) * 60000;
const maxMs = num('max-minutes', 180, 1, false) * 60000;

const KEY = (args['key-file'] ? fs.readFileSync(args['key-file'], 'utf8') : process.env.RANKSCALE_API_KEY || '').trim();
if (!KEY) fail('no API key: set RANKSCALE_API_KEY or pass --key-file');

const stamp = new Date().toISOString().replace(/\..*$/, '').replace(/[:T]/g, '-');
const OUT = path.resolve(args.out || path.join('Rankscale', `bulk-run-${stamp}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Sliding one-minute window shared by every request, so polling plus firing never exceeds the rate limit.
const sent = [];
async function slot() {
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] >= 60000) sent.shift();
    if (sent.length < RATE_PER_MIN) { sent.push(now); return; }
    await sleep(60000 - (now - sent[0]) + 50);
  }
}

async function api(pathname, opts = {}) {
  await slot();
  const headers = { Authorization: `Bearer ${KEY}` };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + pathname, { method: opts.method || 'GET', headers, body: opts.body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML error pages are expected on 502 */ }
  return { status: res.status, json, text };
}

async function getJson(pathname) {
  for (let attempt = 1; ; attempt++) {
    let r;
    try {
      r = await api(pathname);
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(2000 * attempt);
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await sleep(5000 * attempt); continue; }
    if (!r.json || !r.json.success) {
      const detail = r.json && r.json.error ? JSON.stringify(r.json.error) : r.text.slice(0, 200);
      throw new Error(`GET ${pathname.split('?')[0]} returned HTTP ${r.status}: ${detail}`);
    }
    return r.json;
  }
}

const norm = s => String(s || '').trim().toLowerCase();

function pickOne(items, query, label, extraNames) {
  const q = norm(query);
  let hits = items.filter(x => x.id === String(query).trim());
  if (!hits.length) hits = items.filter(x => norm(x.name) === q);
  if (!hits.length && extraNames) hits = items.filter(x => extraNames(x).some(n => norm(n) === q));
  if (hits.length === 1) return hits[0];
  const list = arr => arr.map(x => `  ${x.id}  ${x.name}`).join('\n') || '  (none)';
  if (!hits.length) throw new Error(`no ${label} matches "${query}". Available:\n${list(items)}`);
  throw new Error(`"${query}" matches ${hits.length} ${label}s. Pass the ID instead:\n${list(hits)}`);
}

async function resolveBrand(query) {
  const j = await getJson('/v1/metrics/brands?limit=5000');
  return pickOne(j.data.brands || [], query, 'brand', b => (b.brandInfo && b.brandInfo.names) || []);
}

async function resolveTopic(brandId, query) {
  const j = await getJson(`/v1/metrics/topics?brandRef=${encodeURIComponent(brandId)}&limit=5000`);
  return pickOne(j.data.topics || [], query, 'topic');
}

async function listTerms(brandId) {
  const j = await getJson(`/v1/metrics/search-terms?brandId=${encodeURIComponent(brandId)}&limit=5000`);
  return j.data.searchTerms || [];
}

async function getCredits() {
  try {
    return (await getJson('/v1/metrics/credits')).data;
  } catch {
    return null;
  }
}

function buildPlan(brand, topic, terms, allTermsCount, credits) {
  const rows = terms.map(t => {
    const count = t.executionsAmount || 0;
    const goal = target !== null ? target : count + add;
    return {
      id: t.id,
      term: t.term,
      engines: t.aiSearchEngines || [],
      status: t.status,
      count,
      goal,
      needed: Math.max(0, goal - count)
    };
  });
  const engines = {};
  for (const r of rows) for (const e of r.engines) engines[e] = (engines[e] || 0) + 1;
  const runsNeeded = rows.reduce((a, r) => a + r.needed, 0);
  const warnings = [];
  const multi = rows.filter(r => r.engines.length > 1).length;
  if (multi) warnings.push(`${multi} term(s) have more than one engine. How one run of a multi-engine term counts toward executionsAmount, and what it costs, is untested: check the counts after the first cycle. The estimate assumes 0.25 per engine.`);
  const active = rows.filter(r => r.status === 'active').length;
  if (active) warnings.push(`${active} term(s) are active. Their scheduled runs also raise executionsAmount and hold the per-term lock, so they count toward the goal.`);
  if (topic && Array.isArray(topic.searchTermIds) && !args.engine) {
    const found = new Set(rows.map(r => r.id));
    const missing = topic.searchTermIds.filter(id => !found.has(id)).length;
    if (missing) warnings.push(`the topic lists ${missing} search-term ID(s) that GET /search-terms did not return for this brand; they are not included.`);
  }
  if (allTermsCount >= 5000) warnings.push('GET /search-terms returned 5,000 terms, its maximum: the list may be truncated.');
  const estimatedCredits = rows.reduce((a, r) => a + r.needed * COST_PER_ENGINE_RUN * Math.max(1, r.engines.length), 0);
  const rankCredits = credits ? credits.rankCredits : null;
  if (rankCredits != null && estimatedCredits > rankCredits) warnings.push(`the estimate (${estimatedCredits}) exceeds the rankCredits balance (${rankCredits}).`);
  return {
    createdAt: new Date().toISOString(),
    brand: { id: brand.id, name: brand.name },
    topic: topic ? { id: topic.id, name: topic.name } : null,
    engineFilter: args.engine || null,
    mode: target !== null ? { target } : { add },
    terms: rows.length,
    termsNeedingRuns: rows.filter(r => r.needed > 0).length,
    existingRuns: rows.reduce((a, r) => a + r.count, 0),
    runsNeeded,
    estimatedCredits,
    rankCredits,
    creditsInFlight: credits ? credits.creditsInFlight || 0 : null,
    engines,
    warnings,
    rows
  };
}

function printPlan(p) {
  const scope = p.topic ? `topic "${p.topic.name}" (${p.topic.id})` : 'every term on the brand';
  console.log(`Brand:            ${p.brand.name} (${p.brand.id})`);
  console.log(`Scope:            ${scope}${p.engineFilter ? `, engine ${p.engineFilter} only` : ''}`);
  const s = n => (n === 1 ? '' : 's');
  const goal = p.mode.target !== undefined
    ? `${p.mode.target} run${s(p.mode.target)} per term in total`
    : `${p.mode.add} more run${s(p.mode.add)} per term`;
  console.log(`Goal:             ${goal}`);
  console.log(`Terms:            ${p.terms} (${p.termsNeedingRuns} need runs), ${p.existingRuns} runs already`);
  console.log(`Engines:          ${Object.entries(p.engines).map(([e, n]) => `${e} x${n}`).join(', ') || 'none'}`);
  console.log(`Runs to fire:     ${p.runsNeeded}`);
  console.log(`Estimated cost:   ~${p.estimatedCredits} rankCredits (0.25 per single-engine run, observed 2026-09)`);
  console.log(`rankCredits now:  ${p.rankCredits != null ? p.rankCredits : 'unknown'}${p.creditsInFlight ? `, ${p.creditsInFlight} in flight` : ''}`);
  for (const w of p.warnings) console.log(`Warning:          ${w}`);
}

async function execute(plan) {
  fs.mkdirSync(OUT, { recursive: true });
  const LOG = path.join(OUT, 'bulk_run.log');
  const CALLS = path.join(OUT, 'bulk_run_calls.jsonl');
  const PROGRESS = path.join(OUT, 'bulk_run_progress.json');
  const RESULT = path.join(OUT, 'bulk_run_result.json');
  fs.writeFileSync(path.join(OUT, 'bulk_run_plan.json'), JSON.stringify(plan, null, 2));
  const log = m => {
    const line = `[${new Date().toISOString()}] ${m}`;
    console.log(line);
    fs.appendFileSync(LOG, line + '\n');
  };

  const t0 = Date.now();
  const st = plan.rows.map(r => ({
    ...r,
    state: r.count >= r.goal ? 'done' : 'idle', // idle | running | done | stuck
    countAtFire: null,
    firedAt: 0,
    reqOpen: false,
    outcome: null,
    lastError: null,
    fails: 0,
    calls: 0,
    nextTry: 0
  }));
  let backoffUntil = 0;

  process.on('SIGINT', () => {
    log('interrupted. Runs already started finish on the server; re-run with --target to resume.');
    process.exit(130);
  });

  log(`=== bulk run start: ${plan.terms} terms, ${plan.runsNeeded} runs to fire, rankCredits ${plan.rankCredits}, output ${OUT} ===`);

  // /run blocks until the execution ends; past ~60 s the gateway answers 502 while the run continues.
  // So the reply is never awaited before the next fire, and a 502 is never retried.
  function fire(s) {
    s.state = 'running';
    s.countAtFire = s.count;
    s.firedAt = Date.now();
    s.reqOpen = true;
    s.calls++;
    const started = Date.now();
    api(`/v1/metrics/search-terms/${encodeURIComponent(s.id)}/run`, { method: 'POST', body: '{}' })
      .then(r => {
        const d = r.json && r.json.data;
        const first = d && Array.isArray(d.results) ? d.results[0] : null;
        let outcome;
        if (r.status === 502 || r.status === 504) outcome = 'gateway';
        else if (r.status === 429) outcome = 'rate_limited';
        else if (d && (d.skippedCount > 0 || d.duplicate)) outcome = 'locked';
        else if (d && d.successCount > 0) outcome = 'ok';
        else outcome = 'failed';
        s.outcome = outcome;
        s.lastError = (first && first.error) || (r.json && r.json.error && (r.json.error.message || r.json.error.code)) ||
          (outcome === 'failed' ? `HTTP ${r.status}` : null);
        if (outcome === 'rate_limited') backoffUntil = Date.now() + 60000;
        if (outcome === 'failed') s.fails++;
        if ((outcome === 'failed' || outcome === 'rate_limited') && s.state === 'running') {
          s.state = s.fails >= MAX_FAILS ? 'stuck' : 'idle';
          s.nextTry = Date.now() + 2 * pollMs * Math.max(1, s.fails);
        }
        fs.appendFileSync(CALLS, JSON.stringify({
          ts: new Date().toISOString(), id: s.id, engines: s.engines, countAtFire: s.countAtFire,
          httpStatus: r.status, secs: Math.round((Date.now() - started) / 1000), outcome, error: s.lastError, data: d || undefined
        }) + '\n');
      })
      .catch(e => {
        s.outcome = 'network';
        s.lastError = String((e && e.message) || e);
        fs.appendFileSync(CALLS, JSON.stringify({
          ts: new Date().toISOString(), id: s.id, outcome: 'network', error: s.lastError,
          secs: Math.round((Date.now() - started) / 1000)
        }) + '\n');
      })
      .finally(() => { s.reqOpen = false; });
  }

  async function poll() {
    let fresh;
    try {
      fresh = await listTerms(plan.brand.id);
    } catch (e) {
      log(`  term list failed, will retry: ${e.message}`);
      return;
    }
    const byId = new Map(fresh.map(t => [t.id, t]));
    for (const s of st) {
      const t = byId.get(s.id);
      if (!t) {
        if (s.state !== 'done') { s.state = 'stuck'; s.lastError = 'no longer returned by GET /search-terms'; }
        continue;
      }
      s.count = t.executionsAmount || 0;
      if (s.state === 'running' && s.count > s.countAtFire) { s.state = 'idle'; s.fails = 0; }
      if (s.state === 'idle' && s.count >= s.goal) s.state = 'done';
    }
  }

  let fired = 0;
  for (;;) {
    const now = Date.now();
    let firedThisTick = 0;
    if (now >= backoffUntil) {
      for (const s of st) {
        if (s.state === 'running' && !s.reqOpen && now - s.firedAt > probeMs) {
          fire(s); // a "locked" reply means the earlier run is still going
          firedThisTick++;
          await sleep(STAGGER_MS);
        }
      }
      let running = st.filter(s => s.state === 'running').length;
      for (const s of st) {
        if (running >= maxConcurrent) break;
        if (s.state === 'idle' && s.count < s.goal && now >= s.nextTry) {
          fire(s);
          running++;
          firedThisTick++;
          await sleep(STAGGER_MS);
        }
      }
    }
    fired += firedThisTick;

    await sleep(pollMs);
    await poll();
    const credits = await getCredits();

    const by = state => st.filter(s => s.state === state).length;
    const runsNow = st.reduce((a, s) => a + s.count, 0);
    log(`fired ${firedThisTick}; running ${by('running')}; done ${by('done')}/${st.length}; stuck ${by('stuck')}; ` +
      `runs ${runsNow - plan.existingRuns}/${plan.runsNeeded}; rankCredits ${credits ? credits.rankCredits : '?'}`);
    fs.writeFileSync(PROGRESS, JSON.stringify({
      updatedAt: new Date().toISOString(),
      rows: st.map(s => ({ id: s.id, term: s.term, engines: s.engines, count: s.count, goal: s.goal, state: s.state, outcome: s.outcome, lastError: s.lastError, calls: s.calls }))
    }, null, 2));

    const settled = st.every(s => s.state === 'done' || s.state === 'stuck') && st.every(s => !s.reqOpen);
    if (settled) break;
    if (Date.now() - t0 > maxMs) {
      log(`time limit of ${maxMs / 60000} min reached. Runs already started finish on the server; re-run with --target to resume.`);
      break;
    }
  }

  const endCredits = await getCredits();
  const rows = st.map(s => ({
    id: s.id, term: s.term, engines: s.engines, count: s.count, goal: s.goal,
    reachedGoal: s.count >= s.goal, calls: s.calls, lastError: s.count >= s.goal ? null : s.lastError
  }));
  const stuck = rows.filter(r => !r.reachedGoal);
  const runsAfter = rows.reduce((a, r) => a + r.count, 0);
  const start = plan.rankCredits;
  const end = endCredits ? endCredits.rankCredits : null;
  const result = {
    finishedAt: new Date().toISOString(),
    durationMinutes: Math.round((Date.now() - t0) / 6000) / 10,
    brand: plan.brand,
    topic: plan.topic,
    mode: plan.mode,
    runCalls: fired,
    runsBefore: plan.existingRuns,
    runsAfter,
    runsThisBatch: runsAfter - plan.existingRuns,
    rankCreditsStart: start,
    rankCreditsEnd: end,
    rankCreditsSpent: start != null && end != null ? Math.round((start - end) * 100) / 100 : null,
    rankCreditsNote: 'Workspace-wide balance: runs of other brands in the same window are included.',
    allDone: stuck.length === 0,
    stuck,
    rows
  };
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));
  log(`=== bulk run end: allDone=${result.allDone}, runs this batch ${result.runsThisBatch}, rankCredits spent ${result.rankCreditsSpent}, ${result.durationMinutes} min ===`);
  process.exitCode = result.allDone ? 0 : 2;
}

(async () => {
  const brand = await resolveBrand(args.brand);
  const topic = args.topic ? await resolveTopic(brand.id, args.topic) : null;
  const allTerms = await listTerms(brand.id);
  const terms = allTerms.filter(t =>
    (!topic || (t.searchTermTopicRef && t.searchTermTopicRef.id === topic.id)) &&
    (!args.engine || (t.aiSearchEngines || []).includes(args.engine)));
  if (!terms.length) throw new Error('no search terms match that scope');
  const plan = buildPlan(brand, topic, terms, allTerms.length, await getCredits());
  printPlan(plan);
  if (!args.execute) {
    console.log('\nDry run: nothing fired. Confirm the plan with the user, then add --execute.');
    return;
  }
  if (plan.runsNeeded === 0) {
    console.log('\nNothing to run: every term already has its goal.');
    return;
  }
  console.log('');
  await execute(plan);
})().catch(e => {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
});
