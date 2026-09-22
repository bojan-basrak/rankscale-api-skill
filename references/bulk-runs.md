# Bulk runs: run every search term N times

Use this when the user wants many search terms executed now. The usual ask is "run every prompt in topic X N times", for example a one-off visibility snapshot for a prospect, where each search term is one prompt on one engine and each prompt-engine pair should end with N runs.

**The rule: fire every `/run` at once, never retry a 502, poll `executionsAmount`, and re-fire each term as soon as its count goes up.** `scripts/bulk_run.js` does all of this. Use it instead of writing your own loop. The rest of this file explains why and how to run it safely.

## How `/run` behaves

Verified in two field tests: 20 terms × 10 runs (2026-09-10) and 36 terms × 20 runs (2026-09-22). Evidence in quirks §31.

| Behavior | What it means for a bulk run |
|---|---|
| `/run` holds the connection until the run finishes, about 60–70 s for a GUI engine | Awaiting each call before the next runs one term at a time. Fire them concurrently. |
| The gateway cuts the call at about 60 s with an HTML `502`; the run continues and completes | A 502 means "still running". Never retry it: a retry after completion is a duplicate run. |
| A term that is running rejects another `/run` with `skippedCount: 1` ("currently being executed by scheduled function") | Each term runs one at a time. Wait for its count to rise, then re-fire. |
| Different terms run in parallel | 36 at once worked. Larger batches are untested; the script caps concurrency at 40 by default. |
| `executionsAmount` on `GET /v1/metrics/search-terms` rises by one when a run completes | The only reliable progress signal. Never count runs from `/run` replies. |
| `/run` works on `inactive` terms and leaves them `inactive` | Never activate terms to run them: activating schedules recurring runs that spend credits. |
| A single-engine run costs 0.25 `rankCredits`; `analysisCredits` is untouched | Estimate the cost as runs × 0.25 and check `rankCredits`. |

## Before you fire anything

1. **Resolve the brand and the topic.** Brands: recipe §1. Topics: `GET /v1/metrics/topics?brandRef=<brandId>&limit=5000`. Match names case-insensitively, and ask the user when more than one matches.
2. **List the terms:** `GET /v1/metrics/search-terms?brandId=<brandId>&limit=5000`, keeping those whose `searchTermTopicRef.id` is the topic. Note the count and the engines.
3. **Check the engines per term.** One engine per term is the tested case. For a term with several engines, how one `/run` counts toward `executionsAmount` and what it costs are untested. Tell the user, and check the counts after the first cycle.
4. **Decide what "N times" means, and say which reading you used:**
   - `--target N`: each term ends with N runs in total, and runs it already has count. This is right for a snapshot, and a rerun resumes where it stopped.
   - `--add N`: each term gets N more runs than it has now. A rerun adds N again.
5. **Check credits:** `GET /v1/metrics/credits` → `rankCredits`. The balance is workspace-wide, so other brands' scheduled runs draw it down too.
6. **Confirm with the user** (SKILL.md, "Workspace writes"). For example: *"I'll run the 36 search terms in topic 'Acme prospects' until each has 20 runs: 720 runs, about 180 rankCredits of your 12,160. They run in parallel, so it should take roughly 30–40 minutes. The terms stay inactive. Proceed?"*

The script's dry run prints steps 2–5 for you.

## Running it

```bash
# 1. Dry run: prints terms, engines, runs to fire, and estimated cost. Fires nothing.
node <skill-folder>/scripts/bulk_run.js --brand "Acme" --topic "Acme prospects" --target 20

# 2. After the user confirms:
node <skill-folder>/scripts/bulk_run.js --brand "Acme" --topic "Acme prospects" --target 20 --execute
```

`<skill-folder>` is the folder this skill was loaded from; on Claude Code it is `~/.claude/skills/rankscale-api-skill`. The script needs Node 18 or later. Run it from the user's working folder: output goes to `./Rankscale/bulk-run-<timestamp>/` unless you pass `--out`. For anything longer than a few minutes, run it in the background and read `bulk_run.log`.

| Option | Default | Meaning |
|---|---|---|
| `--brand <name\|id>` | required | Brand name, alias, or ID |
| `--topic <name\|id>` | — | The topic to run; or `--all-terms` for every term on the brand |
| `--target N` / `--add N` | one required | Total runs per term / extra runs per term |
| `--engine <id>` | all | Only terms that use this engine |
| `--execute` | off | Without it, the script only prints the plan |
| `--key-file <path>` | env `RANKSCALE_API_KEY` | Read the key from a file; it is never printed |
| `--max-concurrent N` | 40 | Most terms running at once |
| `--poll-seconds N` | 15 | How often to read `executionsAmount` |
| `--probe-minutes N` | 3 | Re-fire a term that shows no completion after this long |
| `--max-minutes N` | 180 | Stop after this long |
| `--out <dir>` | `Rankscale/bulk-run-<timestamp>` | Output folder |

If Node isn't available, implement the same loop in any language:

```
for each term: goal = N (target) or current count + N (add); state = idle
repeat every ~15 s until every term is done or stuck:
    for idle terms below goal, up to the concurrency cap:
        send /run without waiting for the reply; state = running; remember the count
    when a reply arrives:
        skipped/locked, 502, network error, or success → leave it running
        failure with an error → back to idle with a growing delay; stuck after 5 in a row
    read executionsAmount for all terms:
        running term whose count rose → idle (done once it reaches the goal)
    running term with no rise for 3 minutes → send /run once more
        (a "skipped" reply means the earlier run is still going)
keep all requests together under 200 per minute
```

## While it runs

- The dashboard should show many terms as "Running…" at once. If only one runs at a time, the calls are being awaited in sequence. That is a client bug, not a Rankscale limit: stop and fix the loop.
- Observed pace: most first runs completed 60–90 s after firing, and 36 terms × 20 runs took 34 minutes.
- Some runs take far longer, 10+ minutes in testing. The 3-minute re-fire handles this: a "skipped" reply means the run is still going.
- Stopping the script is safe. Runs already started finish on the server, and a `--target` rerun resumes from the live counts.

## Output and reporting

| File | Contents |
|---|---|
| `bulk_run_plan.json` | The plan the batch started from |
| `bulk_run.log` | One line per poll: fired, running, done, stuck, runs so far, `rankCredits` |
| `bulk_run_calls.jsonl` | Every `/run` reply: status, seconds, outcome, error |
| `bulk_run_progress.json` | Current state of every term, rewritten each poll |
| `bulk_run_result.json` | Final counts per term, `stuck[]` with errors, runs and credits spent, `allDone` |

Exit code: 0 when every term reached its goal, 2 when some are stuck or the time limit was hit, and 1 on a fatal error.

Report terms done against the goal, runs this batch, `rankCredits` spent, the duration, and any stuck terms with their error quoted verbatim. Before calling the batch complete, re-read `GET /v1/metrics/search-terms` and confirm the final `executionsAmount` values. The credit delta covers the whole workspace, so it can include other brands' runs from the same window.

## Mistakes seen in testing

- **Awaiting each `/run` in turn.** Only one term ran at a time; the 36 × 20 batch would have taken about 13 hours instead of 34 minutes.
- **Retrying 502s.** Retries after a run had finished created duplicate runs.
- **Firing in rounds and waiting for the slowest term.** A 20 × 10 batch run in rounds took 1 h 44 min, much of it spent waiting on a few slow runs each round. Re-firing each term as soon as it finishes likely avoids most of that wait.
- **Checking `analysisCredits`.** Runs draw on `rankCredits`.
