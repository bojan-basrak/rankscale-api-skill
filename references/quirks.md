# Rankscale API quirks

Read this before presenting metrics to the user. None of these are bugs — they're behaviors that affect how the numbers should be interpreted or how to call the API correctly.

## 1. Parameter names are camelCase-strict — but the API now tells you when you get it wrong

The reporting body uses **`timeFrame`** (capital F), not `timeframe` or `time_frame`. Same goes for `isoStartDate`, `isoEndDate`, `selectedTopic`, `includeNotFoundExecutions`, etc. Send the wrong casing or a guessed name (`window`, `lookbackDays`, `range`, `period`…) and the API will still:
1. Return HTTP 200 with `success: true`
2. Drop the unknown field
3. Apply its default behavior

**As of the 2026-07-29 API revision this is no longer silent.** The response envelope carries a top-level **`warnings[]`** array naming every field it ignored, often with a did-you-mean. Verified live 2026-07-29 — sending `{"startDate":"2026-07-01","timeframe":"7d"}` returned:

```json
"warnings": [
  "Ignored unrecognized field 'startDate'. Did you mean 'isoStartDate'? Falling back to the default reporting window.",
  "Ignored unrecognized field 'timeframe'."
]
```

**So the first thing to check on any reporting response is `warnings`.** It is omitted entirely when the request was clean, so `if (json.warnings) { … }` is a reliable one-line guard. Surface it to the user rather than swallowing it — a warning means the numbers you just got answer a different question than the one asked.

Still verify the window independently, because `warnings` only catches *unrecognized* fields — a recognized field with a wrong value won't warn. Check `data.ownBrandMetrics.historicalData.daily.timestamps.length` (~30 for `30d` + `daily`), or read `data.requestedDateRange` on `/search-terms-report`.

The full canonical body schema for `/report` is in `endpoints.md`.

**Same failure mode, a recognized field: `searchTermId` is silently ignored on `/report`.** It is a real field name (the GET `/search-terms` family uses it), so it doesn't look like a typo — but on `/report` the API drops it, adds `"Ignored unrecognized field 'searchTermId'"` to `warnings[]`, and returns the **whole unfiltered workspace**. Verified 2026-08-26. A clean-looking `200` then answers a far broader question than you asked. To filter `/report` to a single search term, use `selectedQuery` with the exact query string instead.

## 1b. `isoEndDate` is exclusive (off-by-one)

When you pass `isoStartDate` + `isoEndDate` for a custom range, the API treats `isoEndDate` as **exclusive** — it returns data up to and including the day *after*. Asking for `2026-04-01` → `2026-05-25` returns 56 days ending `2026-05-26`. Asking for `2026-04-01` → `2026-05-24` returns 55 days ending `2026-05-25`.

Two ways to handle it:
1. Pass `isoEndDate` as `(intended_end_date - 1 day)` to compensate.
2. Pass the user's intended end date, then slice the response client-side to drop the extra trailing day.

Option 2 is more defensive — if Rankscale ever fixes the off-by-one, option 1 silently starts dropping a day. Prefer client-side slicing and always sanity-check that the first and last timestamps in the response match what the user asked for.

**On `/citations` (and any window-aggregate endpoint), option 2 is unavailable.** `/citations` returns aggregates over the window with no per-day array to slice, so compensating the end date (option 1) is the *only* way to control the window. Verified 2026-08-07: requesting `2026-07-01` → `2026-07-30` returned citations whose `firstSeenAt`/`lastSeenAt` spanned `2026-07-02` … `2026-07-30`, a clean July. Use the per-URL `firstSeenAt` / `lastSeenAt` fields (quirk 13b) to confirm the window you actually got — they are the only window echo the endpoint provides.

**The extra day only materialises if an execution actually ran on it.** A brand on an every-other-day schedule requesting `2026-06-01` → `2026-06-30` came back ending `2026-06-30` (no run on 07-01), while `2026-07-01` → `2026-07-31` came back ending `2026-08-01` (a run did happen). So the off-by-one can look absent on one window and present on the next — never conclude it's been fixed from a single clean result.

## 2. `includeNotFoundExecutions` controls whether absent-brand runs count

When set to `false`, the metrics only include executions where the brand was actually detected in the AI answer. When `true`, all executions count, even ones where the brand wasn't found. The default (when omitted) is unclear — **pass it explicitly** to avoid surprises.

### `brandNotFound[]` is not "the brand was not found" — do not report it as a finding

The daily historical data includes a `brandNotFound[]` parallel array of booleans (one per timestamp). **An earlier revision of this document described it as meaning the brand isn't being named in AI responses, and told you to surface it with an alias-list fix. That is wrong and produces a false finding.**

Verified 2026-08-07 on a brand with 23 topics / 200 search terms: `brandNotFound` was `true` on **all 15 buckets across two consecutive months**, while over the same buckets `detectionRate` ran 63–70% and `mentions` ran 102–126 per bucket. A brand generating 1,800+ mentions a month is self-evidently being named.

The flag behaves like **"at least one execution in this bucket did not surface the brand"** — which is trivially `true` for any brand whose detection rate is below 100%, i.e. almost every brand. It carries no information at the bucket level.

**Practical guidance:**
- Treat `brandNotFound` as a **non-signal**. Do not report "the brand wasn't found" off it.
- `detectionRate` is the real measure of how often the brand surfaces. Read that instead, and read its *direction* over the window.
- Only investigate aliases (quirk 3) when `detectionRate` is genuinely low or falling — never on the strength of `brandNotFound` alone.
- If you ever observe `brandNotFound: true` alongside `detectionRate: 0` and `mentions: 0`, that is a real absent-brand bucket. That combination, not the flag by itself, is the thing worth surfacing.

## 3. Aliases drive matching

Each brand carries a `brandInfo.names[]` array of aliases (e.g. a brand "Acme" might match *"Acme Inc", "Acme Corp", "acme.com"*). When the user refers to a brand, search both the canonical `name` and `brandInfo.names[]` for matches. Missing aliases is the most common cause of low detection rates.

## 4. Snapshot metrics ≠ sum of daily metrics

The snapshot values at the top of `ownBrandMetrics` (`mentions`, `citations`, etc.) are **weighted aggregates over the requested window**, not the sum of the daily arrays. Don't try to reconcile them. Use the snapshot for "right now" headlines and the daily arrays for trend visualization.

## 5. `trends` is delta vs. the previous comparable window

The `trends` object is the raw change vs. the previous comparable window (same length, immediately preceding). Sign reflects raw delta, not "improvement":
- For `visibilityScore`, `sentiment`, `mentions`, `citations`, `detectionRate`, `top3` — positive = up = better.
- For `avgPosition` — positive = position got higher in number = *worse* (lower rank). Negative = better. Always explain this in user-facing output ("avg position improved by 0.4").

## 6. URL gotcha: `/v1/...`, not `/api/v1/...` — and not every HTML body is a path error

The API sits at `https://rankscale.ai/v1/...` on the marketing domain. Using `https://rankscale.ai/api/v1/...` returns a Next.js HTML 404 page (Content-Type: text/html), which is confusing because it looks like a network error rather than a path error. `https://api.rankscale.ai/...` does not resolve.

**But don't diagnose every HTML body as a bad path.** A heavy request can come back as a transient **`502 Server Error`** with a generic HTML error page (observed 2026-07-29 on a `3m` `/sentiment` call; the identical request succeeded on immediate retry with a 17 MB JSON body). Distinguish them by status code, not by the fact that the body isn't JSON:
- **404 + HTML** → wrong path. Fix the URL; retrying won't help.
- **502/503/504 + HTML** → transient gateway failure, most likely on a large payload. Retry once, then narrow the window (`3m` → `30d`) or add filters to shrink the response.
- **Exception, `POST /search-terms/{id}/run`:** a 502 there means the gateway gave up at ~60 s while the run continues on the server. **Never retry it**: a retry after the run finished starts a duplicate. See quirk 31.

Because both arrive as unparseable text, always capture the HTTP status alongside the body (`curl -w '%{http_code}'` or `-i`) on heavy calls — otherwise a retryable 502 gets misread as a broken integration.

## 7. Param name inconsistency: `brandId` vs `brandRef` — it splits *within* the search-term endpoints

Same value, different key, and it's not a clean per-resource split. The full confirmed map (2026-07-29 docs):

| Call | Key |
|---|---|
| All four reporting endpoints (`/report`, `/citations`, `/sentiment`, `/search-terms-report`) | `brandId` |
| `GET /v1/metrics/search-terms?brandId=` | `brandId` |
| **`POST` / `PATCH /v1/metrics/search-terms`** (body) | **`brandRef`** |
| `GET /v1/metrics/topics?brandRef=` | `brandRef` |
| `POST` / `PATCH /v1/metrics/topics` (body) | `brandRef` |
| Brand paths `/v1/metrics/brands/{brandId}` | `brandId` |

So **the search-term endpoints use both**: you list with `brandId` but create and patch with `brandRef`. Listing a brand's terms and then creating one in the same script means switching keys mid-flow — the most likely place to get this wrong.

Using the wrong key on a **GET** returns `{success:false, error:{code:"validation_error"}}`. On a **POST/PATCH body** it's worse: the unknown key is accepted, lands in `warnings[]`, and the required key is reported missing — so read `warnings` (quirk 1), not just the error.

## 8. Reporting endpoints are POST, not GET

All four reporting endpoints (`/report`, `/citations`, `/sentiment`, `/search-terms-report`) use POST with a JSON body, not GET with query params. This is slightly unusual for read endpoints — easy to get wrong if you've used other analytics APIs.

## 9. Credits include several separate balances

The `/credits` response separates **rankCredits**, **bonusRankCredits**, **analysisCredits**, and **promptResearchCredits**. These are not interchangeable — different operations consume different pools. Present them as separate lines, and surface `creditsInFlight` if non-zero (means runs are queued or executing).

## 10. The `run` action consumes `rankCredits`, not `analysisCredits`

`POST /v1/metrics/search-terms/{id}/run` triggers an immediate AI-engine run for that search term. It draws on **`rankCredits`**: 0.25 per run of a single-engine term (verified 2026-09-10 and 2026-09-22; 708 runs cost exactly 177). Multi-engine terms are untested and likely cost more.

**`analysisCredits` is not touched.** Verified 2026-09-22: about 740 runs left it at 200. Earlier revisions of this skill told you to show `analysisCredits` before a run; that is the wrong balance and makes a well-funded account look unable to afford the runs.

Always confirm with the user and show the `rankCredits` balance and the estimated cost before triggering. The balance is workspace-wide, so other brands' scheduled runs draw it down too; a before/after delta can over-count a batch's cost when other brands ran in the same window. `runway.totalCostForNextExecution` in `/credits` may give a per-run estimate where present (unverified), but some workspaces return no `runway` block at all (observed 2026-09-22).

## 11. Deprecated engines block activation

If a search term has a deprecated engine attached (see the engine catalog in `endpoints.md` for current deprecation status), `activate` and `run` calls fail with `400 deprecated_engine`. The fix is to update the search term to use the replacement engine (e.g. `google_gemini_30_flash` instead of the older Gemini 2.0/2.5).

## 12. Rate limit is firm: 200 req/min per key

Read `X-RateLimit-Remaining` from response headers and slow down before it hits zero. On `429`, use `X-RateLimit-Reset` (seconds) for backoff. For dashboards/reports, cache results 5–10 min — Rankscale recommends not polling reporting endpoints more often than the underlying execution schedule.

## 13b. `/citations` response shape — `occurrences` is the count, not `citations`

In the `/citations` response, `citationsByDomain[]` entries look like `{domain, occurrences, citations}` but **`citations` is the array of URL objects, not a number** — the per-domain count is `occurrences`, and `data.totalCitations` equals the sum of all `occurrences`. Citation share = `occurrences / totalCitations`. Top URLs come from flattening every domain's URL array and sorting by `occurrences`.

**Each URL object carries more than `{url, occurrences}`** (verified 2026-08-07) — the full shape is:

```
{url, normalizedUrl, occurrences, engineAppearances: {<engineId>: count},
 firstSeenAt, lastSeenAt, category, searchTerms: [{id, …}]}
```

Three of these are load-bearing and easy to miss:
- **`engineAppearances`** is a per-engine citation count for that single URL. Summing it across a domain's URLs gives per-engine citation totals for that domain — the only way to answer "which engines cite our site." There is no top-level per-engine citation breakdown.
- **`firstSeenAt` / `lastSeenAt`** are the only echo of the window actually returned (see quirk 1b).
- **`normalizedUrl`** still leaves `www.` / trailing-slash / query-string variants distinct. For page-level analysis, normalise further or a single page splits across several entries — on one brand, 141 raw URLs collapsed to 114 real pages.

**`category: "owned"` does NOT mean owned by the tracked brand.** It marks *a company's own website* as opposed to a portal, directory, or editorial site — so every competitor's own domain carries it too. Verified 2026-08-07: ~100 distinct domains per month carried `category: "owned"`, including the tracked brand's site and all of its competitors' sites side by side. Never use it to isolate the user's own properties — match on the known domain instead. Same class of trap as `topDomainsByCompetitor` below.

Three more URL-object fields (observed 2026-09-22):
- **`searchTerms[]`** entries are `{id, urlOccurrences}`, and `urlOccurrences` summed over a URL's entries equals its `occurrences` exactly (checked across 1,266 URLs). Map each term ID to its prompt and engine and you get exact per-prompt and per-engine citation counts for every page.
- **`brands[]`** entries are `{brandName, occurrences, isOwnBrand, firstSeenAt, lastSeenAt}`. They appear to be the brands named in the answers that cited the URL (co-mentions), not brands found on the page. Useful as "answers citing this page tend to name X", not as proof that X is on the page.
- **`counts`** is `{<date>: n}` with `countsGranularity` (e.g. `"daily"`).

Two more gotchas in `domainSummary`:
- `topDomainsByOwnBrandCitations` (domains that cite the tracked brand) and `topDomainsByCompetitor` are **capped at 20 / 10 entries** respectively. Don't treat them as complete.
- `topDomainsByCompetitor` groups domains where a **competitor was mentioned** — this includes neutral third-party sites (Reddit, Booking, review blogs), NOT just competitor-owned domains. To find competitor-*owned* sites (e.g. to exclude them from an opportunity list), classify domains by judgment; don't rely on this field.

## 13c. `/citations` silently caps at 5,000 unique URLs and 50 brands — `paginationInfo` tells you

The citations response is capped by default, and the cap is on **unique** URLs, not total citations. Verified 2026-07-29 (`3m`, one brand): `totalCitations: 16599`, `uniqueCitations: 4008`, `uniqueDomains: 1008` — and `paginationInfo.totalCount` was `4008`, tracking *unique* citations. So a brand can be far past 5,000 total citations while still under the cap.

`data.paginationInfo` is the full diagnostics block (only `responseTrimmed` is documented upstream):

```
hasMore, totalCount, returnedCount,
citationsCapped, brandsCapped, capBypassed,
maxCitations: 5000, maxBrands: 50,
responseTrimmed, returnedDomainCount, totalDomainCount
```

**`maxBrands: 50` is undocumented** — the citation breakdown covers at most 50 brands. On a brand with a large competitor set, `brandsCapped: true` means the per-competitor citation cuts are partial.

Pass **`uncapped: true`** (body or query param) to bypass the URL cap; it flips `capBypassed: true`. It does *not* remove the response-size guard, so still check `responseTrimmed` — and note `uncapped` doesn't lift `maxBrands`.

**Before telling the user a citation list is complete, read `citationsCapped`, `brandsCapped`, and `responseTrimmed`.** If any is `true`, say so and narrow the window or filter by topic/engine instead of presenting a truncated list as the whole picture. Uncapped payloads get big — a `3m` pull ran ~3.9 MB — so always `-o` to a file.

## 14. Workspace-member API keys resolve to the owner

If a workspace member generates an API key, all reads and writes operate on the **workspace owner's** data. This is fine in practice but worth knowing if multiple teammates have keys — you're all reading and writing the same dataset.

## 15. API keys are workspace-scoped — "Unauthorized access to brand" means wrong workspace

**The key suffix is a workspace ID, not a brand ID.** Earlier revisions of this document described the format as `rk_<hash>_<brandId>`. That is wrong. The real shape is `rk_<hash>_<workspaceId>` — verified 2026-08-07 on two live keys, both 23 characters (`rk_` + 8 + `_` + 11). Two proofs: the suffix is 11 characters while Rankscale brand IDs are 20 (Firestore-style, e.g. `AbC1dEfGhIjKlMnOpQrS`), and a single key returned **7 different brands** from `GET /brands`, which a brand-scoped key could not do. Never try to parse a brand ID out of the key.

An API key only reaches brands in the workspace that issued it. If `/report` (or any brand call) returns `bad_request` / `"Unauthorized access to brand"` **while `/credits` succeeds**, the key is valid but the brand lives in a different account/workspace — you have the wrong key for that brand, not a malformed request. Confirm which account owns the brand. (The Rankscale MCP connector authenticates separately and may be bound to a different account than `RANKSCALE_API_KEY`, so one surface can see a brand the other can't.)

## 16. `competitorTimeSeriesData` excludes the own brand

The per-competitor series in `data.competitorTimeSeriesData` lists competitors only — the tracked brand is **not** in it. Its daily values live in `data.ownBrandMetrics.historicalData.<agg>`. To compute a daily Brand Rank you must merge the two (timestamps align — verify first/last). This competitor set is also smaller (~25–35) than the full detected pool in `competitorMetrics` (dozens), so daily ranks for low-visibility brands are lower bounds. It also only backfills the trailing ~2 weeks (quirk 16b). See the Brand Rank recipe (SKILL.md §6).

## 16b. `competitorTimeSeriesData` only backfills the trailing ~2 weeks

In `POST /v1/metrics/report`, `data.competitorTimeSeriesData` (both `daily` and `weekly` aggregation) only carries competitor values for roughly the trailing ~2 weeks of the requested window. Earlier buckets are `0` for **every** competitor, even when the competitors were demonstrably present in that period — re-querying an earlier block alone as its own window returns real (non-zero) `competitorMetrics` aggregates for the same dates where the full-window series showed 0 (verified 2026-07-15). The own-brand series (`ownBrandMetrics.historicalData`) is complete for the full window, and window-level `competitorMetrics` aggregates remain valid for the full period.

**Practical guidance:** when plotting competitor time series, null-out (don't zero) competitor values older than ~2 weeks and caption the truncation. Daily Brand Ranks (SKILL.md §6) computed from those older buckets are spurious — the entire competitor pool reads 0, so the own brand appears rank 1. Use window aggregates for anything beyond the trailing ~2 weeks.

## 17. Aggregate metrics are period-weighted, not daily averages

Window-level `visibilityScore` (and any Brand Rank derived from it) is a weighted aggregate over the requested window — not the mean of the daily series. A brand can be aggregate rank 1 while sitting at daily rank 2 on most days. Use the aggregate for the headline and the daily series for the trend; don't try to reconcile them (cf. quirk 4).

## 18. Date filtering is reliable — the old "~7–8 days only" claim was a mis-casing artifact

Custom ranges (`isoStartDate`/`isoEndDate`) and long presets (`30d`, `3m`, `1y`) return the full requested window **when the params are cased correctly** (quirk 1). The earlier belief that the API "only returns the last 7–8 days" came from sending `timeframe` (wrong case), which was silently dropped — a mistake the `warnings[]` array now catches for you. Verified in practice: `30d`/`daily` returns the correct daily buckets and custom ISO ranges are honored (mind the exclusive end, quirk 1b). Still verify the returned `timestamps[]` span matches the request — but don't fall back to the dashboard for long windows; the API handles them.

## 19. `/sentiment` is the heaviest endpoint, and its counts are not execution counts

Two separate traps, both verified 2026-07-29 on one brand.

**Payload size.** `/sentiment` returned **~9 MB for `30d`** and **~17 MB for `3m`** — two to three orders of magnitude heavier than `/report` (~40–50 KB). The driver: every keyword in `webGroundingKeywords` / `trainingDataKeywords` carries a full `executionIds[]` array *and* a parallel `timestamps[]` array of every execution that produced it. Always write it to a file with `-o` and extract only the fields you need; never read the payload inline. It is also the endpoint most likely to throw a transient 502 (quirk 6).

**`positiveCount` / `neutralCount` / `negativeCount` are keyword-level, not execution-level.** They do not sum to `sentimentCount`. Observed: `positiveCount 1489 + neutralCount 318 + negativeCount 135 = 1942`, while `sentimentCount` and `executionCount` were both `835`. So:
- **Never** compute "% of executions that were positive" as `positiveCount / (positiveCount + neutralCount + negativeCount)`. That's a share of *sentiment keywords*, not of executions — label it that way.
- `avgSentiment` is exactly `totalSentimentScore / sentimentCount`, on a **0–100** scale (not −1…1). Verified: `71079 / 835 = 85.12`.

**Web-grounded vs training-data sentiment are separate sources.** Each entry carries `hasWebGrounding` and `hasTrainingData` booleans with parallel `webGrounding*` / `trainingData*` blocks. A brand can be `hasWebGrounding: true, hasTrainingData: false` (observed), in which case the `trainingData*` buckets exist but are empty — don't report `0` sentiment from training data as a finding when the source simply didn't contribute. `webGroundingSentimentByEngine[<engineId>]` is `{sum, count, avg}`, so per-engine sentiment is `avg` — don't re-derive it.

**Two arrays, different scopes:** `brandSentiments[]` is the tracked brand only (typically one entry); `companySentiments[]` is every detected brand including the own brand (`isOwnBrand: true`) — 38 entries on the test brand. For competitor sentiment comparisons use `companySentiments`. The undocumented `brandSentimentsBySearchTerm[]` / `companySentimentsBySearchTerm[]` give the same cuts per search term.

## 20. List endpoints default to `limit=1000` and truncate silently

`GET /brands`, `GET /search-terms`, and `GET /topics` each take a `limit` query param — integer, min 1, **max 5000, default 1000**. There is **no cursor, offset, or page token**: `limit` is the only lever, and the response carries no "there's more" flag (unlike `/citations`, which at least has `paginationInfo.hasMore`).

So on a workspace with more than 1,000 search terms, `GET /search-terms?brandId=X` returns exactly 1,000 and looks complete. Any count, coverage audit, or "how many terms do we track" answer built on the default is wrong with no visible symptom.

**Practical guidance:** pass `limit=5000` explicitly on list calls whenever the count matters. If a list comes back at exactly 1000 (or 5000), treat that as a truncation signal, not a coincidence — say so rather than reporting it as the total. Above 5,000 records the API cannot enumerate them in one call at all; fall back to filtered reporting endpoints or the dashboard.

## 21. `POST /search-terms/{id}/run` — the envelope lies, and creates default to inactive

Two things about the write path that cost credits.

**The outer `success` is not the run result.** The docs say it outright: *"The envelope is successful even when the term-level result failed; inspect `data.success` and `data.results`."* So a `200` with `{"success": true, ...}` can wrap a completely failed execution. The real result:

```
data: {success, duplicate, totalRequested, successCount, failureCount, skippedCount,
       results[]: {searchTermId, success, executionId, error}}
```

**Never report a run as successful off the envelope.** Check `data.success`, then `data.failureCount` / `data.skippedCount`, then surface `results[].error` verbatim when non-zero. `data.duplicate: true` means the run was recognized as a repeat — flag it rather than presenting it as a fresh execution. Also note `/run` wants a body (`--data '{}'`), not a bodyless POST. For why `/run` usually answers 502 while the run succeeds, and the per-term execution lock, see quirk 31.

**Creating a search term does *not* start it.** `SearchTermCreateRequest.status` defaults to **`inactive`**, so `POST /search-terms` provisions without scheduling runs or burning credits. That makes create-then-review-then-activate the safe flow. Conversely, passing `status: "active"` at create time *does* schedule runs immediately — treat it as the same class of action as `/activate` and confirm it with the user. Creating an active term on a deprecated engine is blocked with `400 deprecated_engine`.

## 22. `brandInfo` has a different shape on input than on output

You cannot round-trip a brand. `GET /brands` returns:

```json
"brandInfo": {"names": ["Acme", "Acme Inc"], "productNames": ["Widget"], "description": "..."}
```

…an **object** with `names` / `productNames`. But `BrandCreateRequest` / `BrandPatchRequest` expect:

```json
"brandInfo": [{"brands": ["Acme", "Acme Inc"], "products": ["Widget"]}]
```

…an **array** of objects with `brands` / `products`. Different container *and* different key names.

So the read-modify-write pattern — fetch a brand, tweak one alias, PATCH the object back — fails: the `{names, productNames}` object goes in as unrecognized fields, lands in `warnings[]`, and the alias update silently does nothing while the call returns `200`. **Translate the shape explicitly**, and re-read the brand afterwards to confirm the aliases actually changed. Aliases drive detection (quirk 3), so a silently-dropped update quietly suppresses the brand's metrics.

## 23. `brandRef: ""` on a topic PATCH detaches it — and the docs' example ships that value

`PATCH /v1/metrics/topics/{topicId}` moves a topic between brands via `brandRef`. Per the docs: *"Providing an empty `brandRef` detaches the topic and clears the stored `myBrand` string."*

The trap: the API reference's own example payload for this endpoint is

```json
{"name": "", "description": "", "keywords": "", "brandRef": ""}
```

Copy that verbatim to rename a topic and you detach it from its brand. A detached topic stops being a usable `selectedTopic` filter and drops out of the brand's operational topics list, so reporting cuts built on it silently return nothing.

**Send only the keys you intend to change.** To rename, PATCH `{"name": "New name"}` — omit `brandRef` entirely. Never pass an empty string as filler. This applies to the other PATCH bodies too: the docs' examples are field-complete templates with empty-string placeholders, not safe starting points.

## 24. Competitor entities split and merge between windows — this manufactures phantom movers

`competitorMetrics[]` and `competitorTimeSeriesData` key competitors by **display name**, and those names are not stable across windows. Rankscale's entity resolution changes between months, so the same real-world company can appear as one entry in one window and two in another. Verified 2026-08-07 comparing two consecutive months on one brand:

| Window | Entries | Visibility |
|---|---|---|
| June | `Acme` **and** `Acme Group` (two separate entries) | 10.4 + 6.5 = 16.9 |
| July | `Acme Group` (one entry) | 16.7 |

Compared naively that reads as **+157% growth for the fastest-rising competitor in the market**. The company was actually flat-to-slightly-down. It was the single largest apparent mover in the dataset and it was entirely an artifact.

Three distinct failure modes, all seen in the same pair of months:
- **Merge across windows** — `Acme` + `Acme Group` → `Acme Group`.
- **Case-only variants across windows** — `Beta Estates` (June) vs `Beta estates` (July). A `Set`/`Map` keyed on the raw name reports these as one EXITED and one NEW brand.
- **Duplicates co-existing inside a single window** — `GammaCorp` *and* `Gamma Corp` both present in July; `Delta` and `Delta.com` both present in both months. Each splits that company's true visibility, which also distorts Brand Rank (recipe §6) by inflating the pool.

**Before reporting any month-over-month competitor comparison:**
1. Normalise names before matching — lowercase and strip non-alphanumerics (`s => s.toLowerCase().replace(/[^a-z0-9]/g, '')`).
2. After normalising, list every collapsed key that came from more than one source name, and every ENTERED/EXITED brand. Inspect that list by eye — a brand that "entered" at high visibility next to one that "exited" at similar visibility is a rename or a merge, not market movement.
3. When an entity merged, compare the **summed** prior-window value against the current one, and say in the output that you did.
4. Never present a top-mover list straight from raw name matching. The largest apparent movers are the most likely to be artifacts, because merges concentrate visibility.

Recommend the user clean duplicate entities in the dashboard — until then, competitor rankings carry a known error bar.

## 25. Undocumented series in the `/report` response

Three things the response returns that the upstream docs and earlier revisions of this skill did not mention (verified 2026-08-07):

**`ownBrandMetrics.engineMetricsData.<aggregation>`** — a per-engine daily time series, same array-parallel shape as `topicMetricsData`:

```
[{engineId, engineName, visibilityScore[], sentiment[], avgPosition[], detectionRate[], …}, …]
```

This is the only way to see per-engine movement over time without one filtered `/report` call per engine, and on a month-over-month comparison it was the highest-value cut in the whole response — it exposed a ~14-point visibility swing between engines that the window aggregate completely hid. Reach for it whenever the user asks "which AI engines".

**Two extra daily bucket arrays.** The `historicalData.<agg>` bucket list also includes **`sources`** and **`citationCounts`**, beyond the documented `visibilityScore` / `sentiment` / `mentions` / `citations` / `avgPosition` / `detectionRate` / `top3` / `brandNotFound`. Read quirk 26 before using `sources` — outside the trailing few buckets of the requested window it is structurally `0`, not measured.

**`hourly` / `weekly` / `monthly` keys exist but are empty** on `topicMetricsData` and `engineMetricsData` when you request `aggregation: "daily"` — they come back as `[]`, not absent. An `Object.keys()` presence check will wrongly conclude the data is there. Check `.length`, and read the sub-key matching the `aggregation` you actually requested.

## 26. The last ~3 buckets of any window are computed differently — `citations` under-counts, `sources` populates only there

**Confirmed 2026-08-07.** The same calendar dates return *different* values for `citations` and `sources` depending on which window you requested them in. Two overlapping `/report` calls on one brand, `aggregation: "daily"`:

| Date | `citations` in a 07-01→07-14 window | `citations` in a full-July window | `sources` short | `sources` full |
|---|---|---|---|---|
| 2026-07-02 | 121 | 121 ✓ | 0 | 0 ✓ |
| 2026-07-04 | 113 | 113 ✓ | 0 | 0 ✓ |
| 2026-07-06 | 118 | 118 ✓ | 0 | 0 ✓ |
| 2026-07-08 | 143 | 143 ✓ | 0 | 0 ✓ |
| **2026-07-10** | **121** | **130** | **22** | **0** |
| **2026-07-12** | **77** | **118** | **83** | **0** |
| **2026-07-14** | **83** | **160** | **95** | **0** |

The first four buckets match exactly; **the last three buckets of the requested window disagree** — and they are the last three of the *window*, not of the month. This settles the earlier open question: the trailing citation dip is a **windowing artifact, not real end-of-month behaviour**.

Both previously-separate observations are the same effect. `citations` is *under-counted* in the trailing ~3 buckets; `sources` is *only populated* in those same buckets and reads `0` everywhere else. That is why a full-month `sources` series looks like a row of zeros with a few values glued to the end — those aren't the only days with sources, they're just the only days near the window edge.

**Critically, this does not affect the core metrics.** In the same comparison, `visibilityScore`, `mentions`, and `detectionRate` were **identical in every overlapping bucket** (0 of 7 differed). The artifact is confined to `citations` and `sources`.

**Practical guidance:**
- **Never read the last ~3 buckets of a `citations` or `sources` daily series.** Drop them, or request a window extending a few buckets past the period you actually care about and slice back.
- **Never plot the `sources` daily series at all** until this is understood — outside the window edge it is structurally zero, not measured-zero.
- A trailing decline in a citations chart is almost certainly this artifact. Check it against a longer window before reporting it as a trend.
- `visibilityScore` / `mentions` / `detectionRate` are window-stable — trust those series to the edge.
- **Window-level aggregates and the `/citations` endpoint were not tested here.** For month-over-month work this matters less than it looks: if both months are pulled with identical window geometry, any systematic edge effect applies to both and largely cancels in the comparison. Keep the geometry identical and say that you did.

## 27. `timeFrame` presets and ISO dates disagree — always pass ISO dates

Verified 2026-08-26 on one workspace: `timeFrame: "3m"` and the equivalent `isoStartDate` / `isoEndDate` pair resolved to the **same span** (identical weekly buckets, same 10 grouped competitors) yet returned **different aggregates and a different competitor set**.

| | `3m` preset | ISO dates | Dashboard |
|---|---|---|---|
| Competitor entries | 28 | 22 | 22 |
| Example competitor visibility | 46.3 | **62.7** | 62.7 |
| Example competitor detection | 55.9 | **76.2** | 76.2 |

Only the ISO form matched the dashboard UI — exactly, across visibility, detection, top-3, and sentiment on every competitor checked. Root cause unknown: the preset appears to resolve a different underlying execution set than its own reported span implies.

**Rule: convert every user-facing window to explicit `isoStartDate` + `isoEndDate` and never send a `timeFrame` preset for numbers a user will see.** Presets are acceptable only for a throwaway "is there any data at all" probe. Mind the exclusive end date (quirk 1b) when converting.

## 28. `competitorMetrics[]` is truncated unless you filter by query

Unfiltered, `/report` returned only 22 competitor entries; the identical call filtered to a single search term with `selectedQuery` returned 64. The unfiltered `competitorMetrics[]` is a **summarised** view, not the full detected roster.

To get the complete competitor set, run one `/report` per search term (each with its own `selectedQuery`) and union the `competitorMetrics[]` results, normalising names first (quirk 24). Verified 2026-08-26: doing this across 7 search terms surfaced 440 entities and 668 aliases covering ~92% of roster appearances, versus the couple-dozen the unfiltered call showed.

**Consequence for Brand Rank (SKILL.md §6):** a pool size taken from one unfiltered call understates the true pool, so it is a lower bound. Call the rank "of the summarised set" unless you unioned per-query results.

**Filtered calls are capped too, at about 100 entries.** Observed 2026-09-22 on a 36-term snapshot: `selectedTopic` and per-prompt `selectedQuery` calls returned 99 to 101 entries (100 competitors plus the tracked brand) whenever the roster was larger, while `/search-terms-report` listed up to 88 brands for a single prompt-engine pair. For complete rosters on large prompt sets, build them from `/search-terms-report` (quirk 33) rather than from `competitorMetrics[]`.

## 29. `/search-terms-report` returns raw per-execution detections — no brand grouping

Whatever entity consolidation the workspace applies (merging `Acme` and `Acme Group`, case variants, and so on), `/search-terms-report` does **not** apply it — it returns raw per-execution brand detections. `/report`'s `competitorMetrics[]` is grouped (see `groupMeta`, endpoints.md); `/search-terms-report` is not. Don't match competitor names across the two endpoints without normalising and grouping yourself (quirk 24). Verified 2026-08-26.

`includeNotFoundExecutions` is silently ignored here too — it is a `/report`-only field, and on `/search-terms-report` it lands in `warnings[]` and changes nothing.

## 30. When the API and dashboard disagree, refresh the dashboard first

Observed 2026-08-26: an API figure that disagreed with the dashboard came into line after the dashboard was hard-refreshed — the dashboard had been serving a cached value, not the API being wrong. Before concluding the API is off, have the user refresh the relevant dashboard view and re-compare. This is distinct from the preset-vs-ISO divergence in quirk 27, where the API genuinely returns different numbers by request shape.

## 31. `/run` holds the connection until the run finishes — a 502 means "still running", and awaited calls serialize a batch

**Corrected 2026-09-22.** An earlier revision of this quirk called `/run` "async". It is the opposite: **the call blocks until the execution finishes.** A GUI-engine run takes about 60–70 s, longer than the gateway's ~60 s timeout, so the call routinely ends in an HTML **`502`** (quirk 6) even though the run started and completes seconds later on the server. The "async" label is dangerous because it suggests each call returns quickly, so a loop that awaits each call looks harmless. It isn't.

Evidence from the 2026-09-22 field test (36 single-engine terms):
- **Timing.** In a loop that awaited each call, every call took ~60 s to end in a 502. A retry 3 s later hit the per-term lock ("currently being executed"). The term's `lastExecutionTime` landed ~4 s after that.
- **Throughput.** Awaiting each call in turn ran **one term at a time**. The dashboard showed a single "Running…" row, and completions arrived 60–70 s apart. Firing all 36 at once ran all 36 in parallel: 32 of 36 completed within ~90 s, and 708 runs finished in 34 minutes.

**Rules that follow:**
1. **Never await `/run` calls one after another in a batch.** Fire them concurrently (a short stagger is fine) and treat the reply as fire-and-forget.
2. **Never retry a 502 from `/run`.** If the run already finished, the retry starts a duplicate. Retry-on-502 loops left one test term with extra runs.
3. **Count runs with `executionsAmount`** on `GET /v1/metrics/search-terms`. It rises by one when a run *completes* (not when it starts), and `lastExecutionTime` moves at the same moment. Never count runs from `/run` replies.
4. A reply that arrives in time (a run under ~60 s) has `data.successCount: 1` and an `executionId`. Still confirm through `executionsAmount`.

**Per-term lock.** While a term is executing, another `/run` on it is **skipped**: `data.skippedCount: 1` with `results[].error: "Search term is currently being executed by scheduled function"`, and nothing new starts. This is distinct from `data.duplicate` (quirk 21). Different terms run concurrently; the same term is lock-serialized, which enforces "wait for finish, then rerun" and keeps a batch from overshooting its goal.

**Status is untouched.** `/run` works on `inactive` / `manual` terms and leaves them `inactive`. There is no need to activate a term to run it, and activating would schedule recurring runs that spend credits.

**Runs vary widely in length.** Most finish in 60–70 s, but some took 10+ minutes in testing. A term with no completion after a few minutes can be re-fired: a "skipped" reply means it is still running; otherwise the earlier run failed without an error, and the new call starts a fresh one.

**Cost:** 0.25 `rankCredits` per single-engine run, and `creditsInFlight` in `/credits` reflects runs in progress (2026-09-10 test); see quirk 10.

Full bulk-run procedure: `references/bulk-runs.md`. Ready-made tool: `scripts/bulk_run.js`.

## 32. Topic-level `competitorMetrics` shares use a different base for each brand

**Observed 2026-09-22 through the API; not yet cross-checked in the dashboard.** On a one-hour snapshot (36 single-engine terms × 20 runs = 720 executions), a `/report` filtered by `selectedTopic` gave each competitor a `detectionRate` that implies a different denominator per brand. The top brand had 164 `appearances` at `detectionRate: 30.4`, so its base was about 539, not 720. Other brands ranged from about 315 to about 567. `visibilityScore` follows the same base, so the topic-level shares run high (top brand 28.7, against 20.8 recomputed over all 720 executions) and the brands are not measured against the same total. The mechanism is unclear. One guess is that each brand's base is the executions inside its own first-seen to last-seen window, which would distort short snapshots most.

**Per term, the numbers are exact.** For every brand in every term of `/search-terms-report`, `visibilityScore` equals `round1(100 × (appearances / runs) / (1 + 0.1 × (avgRank - 1)))`, with no deviation above 0.1 across all brand-term entries. `detectionRate` equals `appearances / runs × 100`.

**Practical guidance:**
- For snapshot or topic-wide comparisons, recompute from `/search-terms-report` (SKILL.md §9). Per brand, sum `appearances` and `appearances × avgRank` over the terms in scope, divide by the total executions of those terms, then apply the formula. Every brand then shares one base.
- State the base next to the numbers ("% of all 720 answers").
- If a client may compare with the dashboard's topic view, say in the report that its topic totals use a different base, and that per-term figures match.
- Cross-check one topic in the dashboard before relying on this finding for anything beyond a snapshot (see quirk 30).

## 33. `/search-terms-report` per-term fields: what the counts mean

Observed 2026-09-22 on 36 single-engine terms with 20 runs each (checked against the answer texts):
- **`appearances`** = executions of the term whose answer names the brand. `detectionRate` = `appearances / runs × 100`.
- **`top3`** is a percentage of the term's executions with the brand in positions 1 to 3 (always ≤ `detectionRate`). Multiply by runs / 100 for a count.
- **`variations[]`** holds spelling variants that Rankscale grouped *within that term*, each with its own counts. The parent's `appearances` counts unique executions: the variants' sum, or one less when a single answer used both spellings.
- **Grouping stops at the term boundary.** The same company shows up as `Acme` in one term and `ACME` in another. Sometimes two spellings even sit as separate top-level entries in the same term (`Gamma Pixel` and `GammaPixel`). Normalise names across terms (quirk 24). When two top-level entries in one term map to one company, the summed `appearances` can double count an answer that used both. In practice the sums held: 39 such merges checked against the answer texts, and 3 needed capping.
- **`answerTexts[]`** gives one entry per execution. The longest of 720 was exactly 5,000 characters, so texts appear to be capped at 5,000.
- **`competitors[]`** also lists entities that are not competitors: software, directories, marketplaces, example clients the answers mention. Classify them before ranking competitors.
