---
name: rankscale-api-skill
description: Query the Rankscale AI brand-visibility API — list brands, pull reporting metrics (visibility, sentiment, citations, search terms), check credits, and manage workspace items (brands, topics, search terms). Use this whenever the user mentions Rankscale, RS, brand visibility tracking, AI brand mentions, GEO/AEO analytics, or asks about how a brand they track appears in AI assistant responses. Trigger even if they don't name the API explicitly — phrases like "how is my brand doing this week", "show me citations for brand X", "what's my credit balance", "list my tracked brands", "add a search term", or "run a search term" all warrant this skill.
---

# Rankscale REST API

Rankscale is an AI brand-visibility tracking tool. It prompts various AI models (ChatGPT, Gemini, Claude, Perplexity, etc.) with the user's tracked search terms, analyzes the responses, and reports how often, where, and how favorably tracked brands are mentioned.

This skill calls the REST API directly so the user (an SEO professional, not a developer) can pull data into reports, charts, and custom analyses without clicking through the dashboard.

## Setup

- **API key**: Read from environment variable `RANKSCALE_API_KEY`. Key format is `rk_<hash>_<workspaceId>` — the suffix is a **workspace** identifier, not a brand ID, so one key reaches every brand in its workspace (quirks §15). If unset, ask the user to set it once: PowerShell `setx RANKSCALE_API_KEY "rk_..."` (new shell required to take effect) or pass per-session with `$env:RANKSCALE_API_KEY = "rk_..."`. **Never** print the key in responses or write it into files.
- **Base URL**: `https://rankscale.ai` (note: no `/api` prefix — the path is `/v1/...` directly on the marketing domain).
- **Auth header**: `Authorization: Bearer $RANKSCALE_API_KEY`.
- **Rate limit**: 200 requests per minute per API key. The response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (seconds until window resets) — read them with `curl -i` if you're doing batch work. Cache reporting responses for 5–10 min when possible.
- **Tools available**: `curl` for requests. For JSON parsing, use whatever the environment provides — `node -e "..."`, `jq`, or `python -m json.tool`. Check what's on PATH before assuming; don't hard-depend on any one of them.
- **Shell syntax**: examples below use bash-style variable expansion (`$RANKSCALE_API_KEY`). On Windows PowerShell that becomes `$env:RANKSCALE_API_KEY`. Pick whichever shell tool you call — both work, but mind the syntax.

## Calling pattern

Every endpoint returns `{success: true, data: {...}}` on success, or `{success: false, error: {code, message, details}}` on failure. Always check `.success` before reading `.data`.

**Check `warnings` too.** A successful response may carry a third top-level key, `warnings[]`, listing any request fields the API didn't recognize and ignored — often with a did-you-mean (`"Ignored unrecognized field 'startDate'. Did you mean 'isoStartDate'? …"`). It's absent when the request was clean, so `if (json.warnings)` is a reliable guard. **A warning means the numbers answer a different question than the one asked** — the API falls back to defaults for the dropped field. Surface it to the user instead of swallowing it; this is the cheapest possible catch for the camelCase trap (quirks §1).

Save raw JSON responses to a file next to the user's work (typically `Rankscale/<endpoint>_<context>.json`) so they can be re-analyzed without re-calling the API. Show the user a clean summary, not raw JSON, unless they ask for it.

**Token efficiency — the biggest lever.** For anything bulk (multi-topic, multi-engine, full history, or `/search-terms-report` with `includeAnswerTexts`), write the response straight to disk with `-o` and extract only the values you need with `node -e`. Do **not** read whole `/report` payloads into context — one filtered report runs ~40–50 KB and a 7-topic sweep is ~300 KB. Extracting scalars/series client-side keeps that off-context and, on bulk pulls, roughly halves token usage versus reading payloads inline. (For a single narrow metric the overhead isn't worth it — just read the small response.)

**Payload sizes are wildly uneven — plan around them.** Measured on a single brand:

| Endpoint | Window | Size |
|---|---|---|
| `/report` (filtered) | 30d | ~40–50 KB |
| `/report` (filtered) | 1 calendar month | ~105–110 KB |
| `/citations` | 3m | ~3.9 MB |
| `/citations` **`uncapped: true`** | 1 calendar month | **~4.4–5.7 MB** |
| `/sentiment` | 30d | ~9 MB |
| `/sentiment` | 3m | ~17 MB |

**Size does not scale with window length** — `uncapped: true` matters far more. A single uncapped month came back *larger* than a capped three-month pull, so don't extrapolate a 1-month size from the 3m row.

`/sentiment` and `/citations` are **never** safe to read inline — always `-o` to a file and extract. On calls this heavy, capture the HTTP status too (`curl -w '%{http_code}'`), because a transient `502` arrives as an HTML body that looks like a broken path but just needs a retry (quirks §6).

```bash
# Bash (Git Bash / WSL / macOS / Linux)
curl -s -H "Authorization: Bearer $RANKSCALE_API_KEY" \
     "https://rankscale.ai/v1/metrics/brands" \
     -o brands.json

curl -s -X POST -H "Authorization: Bearer $RANKSCALE_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"brandId":"<id>"}' \
     "https://rankscale.ai/v1/metrics/report" \
     -o report.json
```

```powershell
# PowerShell equivalent
curl.exe -s -H "Authorization: Bearer $env:RANKSCALE_API_KEY" `
     "https://rankscale.ai/v1/metrics/brands" `
     -o brands.json

curl.exe -s -X POST -H "Authorization: Bearer $env:RANKSCALE_API_KEY" `
     -H "Content-Type: application/json" `
     -d '{\"brandId\":\"<id>\"}' `
     "https://rankscale.ai/v1/metrics/report" `
     -o report.json
```

Note in PowerShell: use `curl.exe` (the alias `curl` points to `Invoke-WebRequest`, which behaves differently), escape inner quotes in `-d` JSON bodies with `\"`, and use backtick `` ` `` for line continuation. `Invoke-RestMethod` also works and auto-parses JSON, but the curl form keeps responses consistent across shells.

The complete endpoint inventory and request shapes live in `references/endpoints.md`. Read it before any call you're not sure about. Surprises and gotchas are in `references/quirks.md` — **read it before reporting metrics to the user**, because several of them affect how the numbers should be interpreted.

**Out of scope: the Share Links API.** Rankscale publishes a second REST API for public dashboard share links. It uses a different key (Settings → Sharing, not Settings → Integrations), so `RANKSCALE_API_KEY` won't authenticate against it. If the user asks to create or revoke a share link, say it's a separate API this skill doesn't cover — don't guess at its paths.

## Workflow recipes

### 1. Identify the brand

Most reporting endpoints need a `brandId`. When the user names a brand ("show me Acme's metrics"), resolve the ID first:

1. If `Rankscale/brands.json` exists in the user's working directory, read it.
2. Otherwise call `GET /v1/metrics/brands` and save the result.
3. Match the user's brand name against `brands[].name` (case-insensitive) and against `brands[].brandInfo.names` (aliases). If multiple matches, ask the user to disambiguate.

### 2. Pull metrics for a brand over a window

The user almost always asks for a time window. Use `timeFrame` (camelCase, capital F — **the API silently ignores any other spelling**) with one of these documented presets: `24h`, `7d`, `30d`, `3m`, `1y`. Pair it with `aggregation` (`hourly`, `daily`, `weekly`, or `monthly`) for the bucket size. For custom windows, use `isoStartDate` + `isoEndDate` (paired ISO date strings); these override `timeFrame`.

```json
{
  "brandId": "<id>",
  "timeFrame": "30d",
  "aggregation": "daily",
  "includeNotFoundExecutions": true
}
```

Optional reporting filters (all accept a single string, an array for OR-within-field, or `"all"` for no filter; filters combine with AND across fields):
- `selectedTopic` — topic ID, topic name, `_orphaned`, or array
- `selectedTags` — tag, `__UNTAGGED__`, or array
- `selectedEngine` — engine ID (preferred — see `references/endpoints.md` for the catalog) or friendly name
- `selectedQuery` — exact search-term query string or array
- `searchTermId` — single search-term ID
- `periodOffset` — integer, shifts the preset window back N periods (0 = current, 1 = previous, …)
- `userTimezone` — IANA tz like `Europe/Berlin` for user-local day boundaries
- `includeNotFoundExecutions` — boolean, controls whether the "brand not found in answer" executions count toward the metrics (see quirks.md)

Read the response from `data.ownBrandMetrics.historicalData.<aggregation>` (e.g. `.daily` when you asked for `aggregation: "daily"`). Each bucket array — `visibilityScore`, `sentiment`, `mentions`, `sources`, `citations`, `citationCounts`, `avgPosition`, `detectionRate`, `top3`, `brandNotFound` — runs in parallel with `timestamps`.

Three parallel time series sit alongside it:
- `data.ownBrandMetrics.topicMetricsData.<aggregation>` — per topic
- `data.ownBrandMetrics.engineMetricsData.<aggregation>` — **per engine**; undocumented upstream, and usually the highest-value cut when a window aggregate looks flat, because engine-level moves cancel each other out in the total (quirks §25)
- `data.competitorTimeSeriesData.<aggregation>` — per competitor, own brand excluded (quirks §16)

Two bucket-array traps:
- `brandNotFound[]` is a **non-signal** — it reads `true` for essentially any brand with sub-100% detection. Use `detectionRate` instead and never report "brand not found" off the flag (quirks §2).
- **The last ~3 buckets of `citations[]` and `sources[]` are window-dependent, not real** — `citations` under-counts there and `sources` populates *only* there. Drop them, and never plot `sources` daily at all. `visibilityScore`, `mentions`, and `detectionRate` are window-stable to the edge (quirks §26).

Present a metrics table with these columns: Date, Visibility, Sentiment, Mentions, Citations, Avg Position, Detection %, Top-3 %. Above it, show the snapshot summary (current snapshot values from `ownBrandMetrics` + the `trends` delta).

**Brand Rank (by Visibility) — vs. competitors.** Compute this from `data.competitorMetrics[]` (which includes the own brand, flagged `isOwnBrand: true`): rank = `1 + (count of entries with strictly greater visibilityScore)` — ties don't push the brand down. This reproduces the dashboard's rank. The response also carries `latestRank`/`avgRank` per entry — **these are not ranks.** Verified 2026-08-07: they return non-integer values (`latestRank: 2.7`, `avgRank: 2.9`) for a brand whose computed rank was 1, so they track something position-like, not an ordinal. Ignore them. The MCP's equivalent `own_brand_rank` is likewise always `1` (a display pin). The visibility-sorted computation above is the method that matched the dashboard in testing. The shared filters (`selectedEngine`, `selectedTopic`, `selectedTags`, `selectedQuery`) work per-cut, so you can rank within a single engine, topic, tag, or query by re-running filtered. Note `competitorMetrics` entries may carry a different `validMetricsCount` than the own brand (competitor baselines use a wider window) — the ordering still matches the UI. **Full recipe — including daily rank over time and its caveats — in recipe §6 below.**

### 3. Citation analytics

`/v1/metrics/citations` returns which sources (sites, articles) AI models cite when answering the user's search terms. Useful for understanding which third-party domains influence AI answers about a brand.

Key fields: `data.totalCitations`, `data.uniqueCitations` (distinct URLs), `data.uniqueDomains`, and `data.citationsByDomain[]` (every domain). In each domain entry, **`occurrences` is the count; the `citations` field is the array of URLs, not a number** — so citation share = `occurrences / totalCitations`, and top URLs come from flattening each domain's URL array and sorting by `occurrences`.

Each URL object is `{url, normalizedUrl, occurrences, engineAppearances: {<engineId>: count}, firstSeenAt, lastSeenAt, category, searchTerms[]}`. **`engineAppearances` is the only per-engine citation breakdown in the API** — sum it across a domain's URLs to answer "which engines cite our site." `firstSeenAt`/`lastSeenAt` are the only echo of the window you actually got. Normalise `normalizedUrl` further before page-level analysis (it leaves `www.`/trailing-slash/query variants distinct), and note **`category: "owned"` means "a company's own site", not owned by the tracked brand** — competitors carry it too. See quirks.md §13b. `data.domainSummary` has pre-cut views (`topDomainsOverall`, `topDomainsByEngine`, `topDomainsByQuery`, `topDomainsByOwnBrandCitations`, `topDomainsByCompetitor`) — but these are capped (≈20/10 entries) and `topDomainsByCompetitor` lists domains where a *competitor was mentioned* (includes neutral third-party sites like Reddit/Booking), so don't use it to identify competitor-*owned* sites. See quirks.md §13b.

**Check the caps before calling a list complete.** The response caps at **5,000 unique URLs** and **50 brands** by default. `data.paginationInfo` reports the truth — `citationsCapped`, `brandsCapped`, `responseTrimmed`, `capBypassed`, `maxCitations`, `maxBrands`, `totalCount` vs `returnedCount`. Pass **`uncapped: true`** (body or query param) to lift the URL cap; it does not lift the 50-brand cap or the response-size guard. `deduplicated: true` deduplicates response paths and adds `data.searchTermsById`. If any cap flag is `true`, tell the user and narrow the window or filter rather than presenting a truncated list as the full picture. See quirks.md §13c.

### 4. Sentiment

`/v1/metrics/sentiment` returns **window-level sentiment aggregates plus keyword clouds** for the tracked brand and every competitor — not a time series (use `/report`'s `historicalData.<agg>.sentiment[]` for sentiment over time). Same shared filters, plus `deduplicated: true`.

Two arrays with different scopes: `data.brandSentiments[]` is the tracked brand only; `data.companySentiments[]` is every detected brand including the own brand (`isOwnBrand: true`) — use this one for competitor comparisons. `brandSentimentsBySearchTerm[]` / `companySentimentsBySearchTerm[]` give the same cuts per search term.

Per entry: `avgSentiment` (**0–100 scale**, = `totalSentimentScore / sentimentCount`), `sentimentCount`, `executionCount`, and `positiveCount` / `neutralCount` / `negativeCount`. Sentiment is split by source — `webGrounding*` (web-grounded engines) vs `trainingData*` blocks, gated by the `hasWebGrounding` / `hasTrainingData` booleans, with `webGroundingSentimentByEngine[<engineId>] = {sum, count, avg}` for per-engine scores.

**Two traps — read quirks.md §19 before reporting any of this.** (1) `positiveCount + neutralCount + negativeCount` are *keyword*-level and do **not** sum to `sentimentCount`/`executionCount`, so never present their ratio as "% of executions that were positive." (2) This is the heaviest endpoint in the API (~9 MB for `30d`) — always write to a file, never read it inline.

### 5. Credits

`/v1/metrics/credits` returns balances + runway. Show `rankCredits`, `analysisCredits`, `promptResearchCredits`, and the estimated `runway.estimatedRunwayHours` (convert to days for readability). Mention `creditsInFlight` if non-zero (means runs are queued/in-progress).

The response carries two runway views: `runway` (detailed simulation, bounded — check `simulationLimitedByBilling` / `simulationLimitedByHorizon` and say which limit capped the estimate) and `dashboardRunway` (the burn-rate view the app's dashboard shows). Quote one, not a blend of both. `runway.nextBilling` can be `null`, so guard before reading `._seconds`.

### 6. Brand Rank (by Visibility) — custom metric

**Definition.** The own brand's position among all brands detected for a given cut, sorted by `visibilityScore` descending. **Rank 1 = highest visibility (best).** Reproduces the dashboard's rank. Always compute it from visibility — don't trust ready-made rank fields (see recipe §2 note).

**Aggregate (window-level) rank:**
1. `POST /report` for the cut you want (add `selectedTopic` / `selectedEngine` / `selectedQuery` to rank within a topic, engine, or query).
2. From `data.competitorMetrics[]` (own brand included, `isOwnBrand: true`): rank = `1 + (count of entries whose visibilityScore is strictly greater than the own brand's)`. Strict-greater means ties don't demote the brand.
3. Report the pool size = `competitorMetrics.length` next to the rank (e.g. "rank 3 of 50").

**Daily rank over time:**
1. Own-brand daily visibility: `data.ownBrandMetrics.historicalData.daily` (`visibilityScore[]` parallel to `timestamps[]`).
2. Competitor daily visibility: `data.competitorTimeSeriesData.daily` — **the own brand is NOT in this array** (quirk 16). Merge the own series from step 1; timestamps align exactly (verify first/last).
3. For each timestamp: rank = `1 + (count of competitors with strictly greater visibilityScore that day)`.
4. A day where own `visibilityScore` is 0 (brand not detected) → rank `null`; don't rank it among detected brands. Untracked days (no executions) → leave as gaps; never interpolate.

**Per-topic table** (the common ask): get topics via `GET /v1/metrics/topics?brandRef=<id>&limit=5000` (note `brandRef`, and raise `limit` off its 1000 default), then one filtered `/report` per topic. Present `Topic | Brand Rank (by Visibility) | Visibility Index`, where **Visibility Index = `ownBrandMetrics.visibilityScore`**.

**Caveats — state these when reporting:**
- **Aggregate ≠ average of daily.** The aggregate rank is period-weighted share-of-voice, so a brand can be aggregate rank 1 yet daily rank 2 on most days (quirk 17). Don't reconcile them.
- **~2-week competitor backfill.** `competitorTimeSeriesData` only carries competitor values for roughly the trailing ~2 weeks of the window — earlier buckets are 0 for every competitor, so daily ranks there are spurious rank-1s (quirk 16b). Null-out (don't zero) those older values and caption the truncation; window aggregates stay valid.
- **Low-visibility lower bound.** `competitorTimeSeriesData` carries a smaller competitor set (~25–35) than the full detected pool in `competitorMetrics` (dozens). For a deep long-tail brand the daily rank is a *lower bound* — a competitor absent from the series could outrank it on a given day. Flag it.
- **Cross-surface note.** If computing this via the Rankscale MCP instead of the API, ignore its `own_brand_rank` field — it is always `1` (a display pin), not a ranking.
- When a rank surprises you, cross-check the dashboard UI before trusting it.

### 7. Month-over-month comparison

The most common reporting ask, and the one where traps compound. Run this checklist.

**Getting comparable windows:**
1. Use explicit `isoStartDate`/`isoEndDate` per month, not `timeFrame` + `periodOffset` — calendar months aren't 30 days.
2. **Compensate the exclusive end date** (quirks §1b): for July pass `2026-07-01` → `2026-07-30`. On `/report` you can instead slice client-side; on `/citations` you cannot, so compensating is the only option.
3. **Verify the returned span before comparing anything.** On `/report` read the sliced `timestamps[]`; on `/citations` read `firstSeenAt`/`lastSeenAt`. Drop any bucket outside the intended month.
4. **Check the execution counts match.** Brands run on a schedule (often every *other* day, ~15 runs/month — not daily). Two months with equal run counts make raw totals directly comparable; unequal counts mean you must compare rates, not totals. Say which you did.

**Interpreting the deltas:**
5. **Compare against the pool, not just the prior value.** A brand's citations rising 18% while the total citation pool rose 12.5% is a ~5.5pp real gain, not an 18% one. Always pull `data.totalCitations` for both months and report **share** alongside the raw delta.
6. **Normalise competitor names before matching** and inspect every ENTERED/EXITED entity for merges and renames (quirks §24). The biggest apparent mover is the most likely artifact.
7. **Cross-check the aggregate against the daily series.** They can disagree in direction (quirks §17) — `avgPosition` did exactly that in testing. When they disagree, say so and call the metric flat rather than picking whichever supports the story.
7b. **Discard the last ~3 buckets of any `citations`/`sources` series before comparing** — they're window artifacts and will fake a month-end decline (quirks §26). Keeping the two months' window geometry identical makes the effect cancel; say that you did.
8. **Use `engineMetricsData` and `topicMetricsData`, not just the headline.** A flat window aggregate routinely hides double-digit swings in opposite directions across engines and topics — that's usually the actual finding.
9. **Cross-reference citations against visibility per engine.** They can move in *opposite* directions on the same engine (observed: ChatGPT visibility −5.1 while owned-domain citations +120%; Gemini 3.0 Flash visibility +11.8 while citations −36%). Visibility measures mention share; citations measure whether the brand's own site was the source. A visibility gain with a citation drop means the engine is discussing the brand while sourcing third parties — a materially weaker win, and worth flagging as such.

## Workspace writes — confirm before acting

PATCH, DELETE, and the activate/deactivate/run actions modify the user's live Rankscale workspace. Before any write call, **state in plain language what will happen and to which item, then wait for explicit confirmation**. Example: *"I'll deactivate search term IZFBct… (\"best running shoes for flat feet\") on the Acme brand. This stops it from running until reactivated. Proceed?"*

The `run` action on a search term costs credits — always show the user the current `analysisCredits` balance and a rough cost estimate (each run typically consumes a handful of credits across multiple AI engines) before triggering. **Creating a search term with `status: "active"` schedules runs immediately** — treat it as the same class of action as `/activate` and confirm it the same way. The default is `inactive`, so plain provisioning is safe.

Full request bodies for every create/update call are documented in `references/endpoints.md` — read it rather than probing. Five things to get right:

- **`brandRef`, not `brandId`, in search-term and topic bodies** — even though `GET /search-terms` filters by `brandId`. Both keys live in the same endpoint family (quirks §7).
- **`POST /brands` requires `url` as well as `name`.** Both are min-length-1 strings.
- **`brandInfo` doesn't round-trip.** Output is `{names[], productNames[]}`; input is `[{brands[], products[]}]`. Feeding the response shape back in silently does nothing (quirks §22).
- **Never send empty-string placeholders.** `brandRef: ""` on a topic PATCH *detaches* it — and the docs' own example payload contains exactly that. Send only the keys you're changing (quirks §23).
- **Check `data.success` on `/run`, not the envelope.** A `200` with `success: true` can wrap a failed execution; read `data.failureCount` and `results[].error` (quirks §21).

After any write, re-read the affected resource and confirm the change landed — unrecognized fields are accepted, reported only in `warnings[]`, and return `200`.

**On list calls, pass `limit=5000` when the count matters.** `/brands`, `/search-terms`, and `/topics` default to `limit=1000` with no pagination and no "more results" flag, so a large workspace truncates silently (quirks §20).

## When the API returns an error

The full documented error catalog is in `references/endpoints.md`. Most common:
- `422 validation_error`: schema validation failed; check `error.details`.
- `400 validation_error`: service-level validation, e.g. missing `name` or `term` on a create.
- `401 auth_failed`: API key missing or invalid.
- `403 forbidden`: resource doesn't belong to your workspace.
- `404 not_found`: wrong path (remember `/v1/...` not `/api/v1/...`) or missing resource ID.
- `429 rate_limited`: exceeded 200 req/min. Back off exponentially; read `X-RateLimit-Reset`.
- `400 deprecated_engine`: tried to activate/run a search term whose engine is retired (see engine catalog in endpoints.md).
- `400 limit_reached`: creating a brand would exceed your plan's brand cap.

Send `X-Request-Id` (any string you choose) when you want a correlation ID echoed back — useful when reporting an issue to Rankscale support.

## Output conventions

- **Tables for the user, JSON for the file.** Save full JSON to `Rankscale/<thing>.json`; show the user a small markdown table or summary.
- **Round metric numbers to 1 decimal** unless the user asks for raw values.
- **Convert timestamps** to plain dates (YYYY-MM-DD) in user-facing output.
- **Reference the saved JSON file** in your response (e.g., "Full data in [Rankscale/acme_report.json](Rankscale/acme_report.json)") so the user can ask follow-ups against it.
- **Do not report `brandNotFound` as a finding.** It reads `true` for almost every brand and means nothing on its own; cite `detectionRate` instead (quirks §2).
- **State the caveat next to the number, not in a footnote.** Most of the traps in quirks.md change what a figure *means* rather than invalidating it — a reader who sees "+18%" without "the whole pool grew 12.5%" has been misled even though the number is right.
