---
name: rankscale-api-skill
description: Query the Rankscale AI brand-visibility API — list brands, pull reporting metrics (visibility, sentiment, citations, search terms), check credits, and manage workspace items (brands, topics, search terms). Use this whenever the user mentions Rankscale, RS, brand visibility tracking, AI brand mentions, GEO/AEO analytics, or asks about how a brand they track appears in AI assistant responses. Trigger even if they don't name the API explicitly — phrases like "how is my brand doing this week", "show me citations for brand X", "what's my credit balance", "list my tracked brands", "add a search term", or "run a search term" all warrant this skill.
---

# Rankscale REST API

Rankscale is an AI brand-visibility tracking tool. It prompts various AI models (ChatGPT, Gemini, Claude, Perplexity, etc.) with the user's tracked search terms, analyzes the responses, and reports how often, where, and how favorably tracked brands are mentioned.

This skill calls the REST API directly so the user (an SEO professional, not a developer) can pull data into reports, charts, and custom analyses without clicking through the dashboard.

## Setup

- **API key**: Read from environment variable `RANKSCALE_API_KEY`. Key format is `rk_<hash>_<brandId>`. If unset, ask the user to set it once: PowerShell `setx RANKSCALE_API_KEY "rk_..."` (new shell required to take effect) or pass per-session with `$env:RANKSCALE_API_KEY = "rk_..."`. **Never** print the key in responses or write it into files.
- **Base URL**: `https://rankscale.ai` (note: no `/api` prefix — the path is `/v1/...` directly on the marketing domain).
- **Auth header**: `Authorization: Bearer $RANKSCALE_API_KEY`.
- **Rate limit**: 200 requests per minute per API key. The response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (seconds until window resets) — read them with `curl -i` if you're doing batch work. Cache reporting responses for 5–10 min when possible.
- **Tools available**: `curl` for requests. For JSON parsing, use whatever the environment provides — `node -e "..."`, `jq`, or `python -m json.tool`. Check what's on PATH before assuming; don't hard-depend on any one of them.
- **Shell syntax**: examples below use bash-style variable expansion (`$RANKSCALE_API_KEY`). On Windows PowerShell that becomes `$env:RANKSCALE_API_KEY`. Pick whichever shell tool you call — both work, but mind the syntax.

## Calling pattern

Every endpoint returns `{success: true, data: {...}}` on success, or `{success: false, error: {code, message, details}}` on failure. Always check `.success` before reading `.data`.

Save raw JSON responses to a file next to the user's work (typically `Rankscale/<endpoint>_<context>.json`) so they can be re-analyzed without re-calling the API. Show the user a clean summary, not raw JSON, unless they ask for it.

**Token efficiency — the biggest lever.** For anything bulk (multi-topic, multi-engine, full history, or `/search-terms-report` with `includeAnswerTexts`), write the response straight to disk with `-o` and extract only the values you need with `node -e`. Do **not** read whole `/report` payloads into context — one filtered report runs ~40–50 KB and a 7-topic sweep is ~300 KB. Extracting scalars/series client-side keeps that off-context and, on bulk pulls, roughly halves token usage versus reading payloads inline. (For a single narrow metric the overhead isn't worth it — just read the small response.)

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

Read the response from `data.ownBrandMetrics.historicalData.<aggregation>` (e.g. `.daily` when you asked for `aggregation: "daily"`). Each bucket array — `visibilityScore`, `sentiment`, `mentions`, `citations`, `avgPosition`, `detectionRate`, `top3`, `brandNotFound` — runs in parallel with `timestamps`. Per-topic and per-competitor time series live in `data.ownBrandMetrics.topicMetricsData.<aggregation>` and `data.competitorTimeSeriesData.<aggregation>`.

Present a metrics table with these columns: Date, Visibility, Sentiment, Mentions, Citations, Avg Position, Detection %, Top-3 %. Above it, show the snapshot summary (current snapshot values from `ownBrandMetrics` + the `trends` delta).

**Brand Rank (by Visibility) — vs. competitors.** Compute this from `data.competitorMetrics[]` (which includes the own brand, flagged `isOwnBrand: true`): rank = `1 + (count of entries with strictly greater visibilityScore)` — ties don't push the brand down. This reproduces the dashboard's rank. The response also carries `latestRank`/`avgRank` per entry, but treat any ready-made rank field with suspicion and verify against the UI — the MCP's equivalent `own_brand_rank` is always `1` (a display pin), so don't trust rank fields blind; the visibility-sorted computation is the method that matched the dashboard in testing. The shared filters (`selectedEngine`, `selectedTopic`, `selectedTags`, `selectedQuery`) work per-cut, so you can rank within a single engine, topic, tag, or query by re-running filtered. Note `competitorMetrics` entries may carry a different `validMetricsCount` than the own brand (competitor baselines use a wider window) — the ordering still matches the UI. **Full recipe — including daily rank over time and its caveats — in recipe §6 below.**

### 3. Citation analytics

`/v1/metrics/citations` returns which sources (sites, articles) AI models cite when answering the user's search terms. Useful for understanding which third-party domains influence AI answers about a brand.

Key fields: `data.totalCitations`, `data.uniqueDomains`, and `data.citationsByDomain[]` (every domain). In each domain entry, **`occurrences` is the count; the `citations` field is the array of URLs, not a number** — so citation share = `occurrences / totalCitations`, and top URLs come from flattening each domain's URL array and sorting by `occurrences`. `data.domainSummary` has pre-cut views (`topDomainsOverall`, `topDomainsByEngine`, `topDomainsByQuery`, `topDomainsByOwnBrandCitations`, `topDomainsByCompetitor`) — but these are capped (≈20/10 entries) and `topDomainsByCompetitor` lists domains where a *competitor was mentioned* (includes neutral third-party sites like Reddit/Booking), so don't use it to identify competitor-*owned* sites. See quirks.md §13b.

### 4. Sentiment

`/v1/metrics/sentiment` returns sentiment breakdowns — positive/neutral/negative mentions over time. Lower granularity than the main report but more focused.

### 5. Credits

`/v1/metrics/credits` returns balances + runway. Show `rankCredits`, `analysisCredits`, `promptResearchCredits`, and the estimated `runway.estimatedRunwayHours` (convert to days for readability). Mention `creditsInFlight` if non-zero (means runs are queued/in-progress).

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

**Per-topic table** (the common ask): get topics via `GET /v1/metrics/topics?brandRef=<id>`, then one filtered `/report` per topic. Present `Topic | Brand Rank (by Visibility) | Visibility Index`, where **Visibility Index = `ownBrandMetrics.visibilityScore`**.

**Caveats — state these when reporting:**
- **Aggregate ≠ average of daily.** The aggregate rank is period-weighted share-of-voice, so a brand can be aggregate rank 1 yet daily rank 2 on most days (quirk 17). Don't reconcile them.
- **Low-visibility lower bound.** `competitorTimeSeriesData` carries a smaller competitor set (~25–35) than the full detected pool in `competitorMetrics` (dozens). For a deep long-tail brand the daily rank is a *lower bound* — a competitor absent from the series could outrank it on a given day. Flag it.
- **Cross-surface note.** If computing this via the Rankscale MCP instead of the API, ignore its `own_brand_rank` field — it is always `1` (a display pin), not a ranking.
- When a rank surprises you, cross-check the dashboard UI before trusting it.

## Workspace writes — confirm before acting

PATCH, DELETE, and the activate/deactivate/run actions modify the user's live Rankscale workspace. Before any write call, **state in plain language what will happen and to which item, then wait for explicit confirmation**. Example: *"I'll deactivate search term IZFBct… (\"best running shoes for flat feet\") on the Acme brand. This stops it from running until reactivated. Proceed?"*

The `run` action on a search term costs credits — always show the user the current `analysisCredits` balance and a rough cost estimate (each run typically consumes a handful of credits across multiple AI engines) before triggering.

Exact request bodies for create/update calls aren't fully documented. The robust pattern: POST with the obvious required field (e.g., `name`), read the validation error to learn what else is required, build up from there. See `references/endpoints.md` for what we've confirmed.

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
- **Flag the `brandNotFound` quirk** in the report response when present — see quirks.md.
