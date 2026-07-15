# Rankscale API quirks

Read this before presenting metrics to the user. None of these are bugs — they're behaviors that affect how the numbers should be interpreted or how to call the API correctly.

## 1. Parameter names are camelCase-strict, and unknowns are silently ignored

The reporting body uses **`timeFrame`** (capital F), not `timeframe` or `time_frame`. Same goes for `isoStartDate`, `isoEndDate`, `selectedTopic`, `includeNotFoundExecutions`, etc. Send the wrong casing or a guessed name (`window`, `lookbackDays`, `range`, `period`…) and the API will:
1. Return HTTP 200 with `success: true`
2. Silently drop the unknown field
3. Apply its default behavior

The result *looks* like the API is responding to your filter but in fact it's ignoring it. **Always check that the response window matches what you asked for** (e.g. `data.ownBrandMetrics.historicalData.daily.timestamps.length` should be ~30 for a `30d` request with `daily` aggregation). If it doesn't match, you almost certainly mistyped a param name.

The full canonical body schema for `/report` is in `endpoints.md`.

## 1b. `isoEndDate` is exclusive (off-by-one)

When you pass `isoStartDate` + `isoEndDate` for a custom range, the API treats `isoEndDate` as **exclusive** — it returns data up to and including the day *after*. Asking for `2026-04-01` → `2026-05-25` returns 56 days ending `2026-05-26`. Asking for `2026-04-01` → `2026-05-24` returns 55 days ending `2026-05-25`.

Two ways to handle it:
1. Pass `isoEndDate` as `(intended_end_date - 1 day)` to compensate.
2. Pass the user's intended end date, then slice the response client-side to drop the extra trailing day.

Option 2 is more defensive — if Rankscale ever fixes the off-by-one, option 1 silently starts dropping a day. Prefer client-side slicing and always sanity-check that the first and last timestamps in the response match what the user asked for.

## 2. `includeNotFoundExecutions` controls whether absent-brand runs count

When set to `false`, the metrics only include executions where the brand was actually detected in the AI answer. When `true`, all executions count, even ones where the brand wasn't found. The default (when omitted) is unclear — **pass it explicitly** to avoid surprises.

The daily historical data also includes a `brandNotFound[]` parallel array of booleans (one per timestamp). When `true` for most days, the brand isn't being directly named in AI responses even though metrics still get computed from topic/search-term coverage. **Surface this to the user** — it usually means the alias list (`brandInfo.names`) is incomplete or the tracked search terms don't naturally elicit the brand's name. The fix is in the Rankscale dashboard, not in the API call.

## 3. Aliases drive matching

Each brand carries a `brandInfo.names[]` array of aliases (e.g. a brand "Acme" might match *"Acme Inc", "Acme Corp", "acme.com"*). When the user refers to a brand, search both the canonical `name` and `brandInfo.names[]` for matches. Missing aliases is the most common cause of low detection rates.

## 4. Snapshot metrics ≠ sum of daily metrics

The snapshot values at the top of `ownBrandMetrics` (`mentions`, `citations`, etc.) are **weighted aggregates over the requested window**, not the sum of the daily arrays. Don't try to reconcile them. Use the snapshot for "right now" headlines and the daily arrays for trend visualization.

## 5. `trends` is delta vs. the previous comparable window

The `trends` object is the raw change vs. the previous comparable window (same length, immediately preceding). Sign reflects raw delta, not "improvement":
- For `visibilityScore`, `sentiment`, `mentions`, `citations`, `detectionRate`, `top3` — positive = up = better.
- For `avgPosition` — positive = position got higher in number = *worse* (lower rank). Negative = better. Always explain this in user-facing output ("avg position improved by 0.4").

## 6. URL gotcha: `/v1/...`, not `/api/v1/...`

The API sits at `https://rankscale.ai/v1/...` on the marketing domain. Using `https://rankscale.ai/api/v1/...` returns a Next.js HTML 404 page (Content-Type: text/html), which is confusing because it looks like a network error rather than a path error. `https://api.rankscale.ai/...` does not resolve.

## 7. Param name inconsistency: `brandId` vs `brandRef`

Most endpoints use **`brandId`**. The exception: `GET /v1/metrics/topics?brandRef=<id>` — topics use `brandRef`. Same value, different key. Easy to mistype; the response will be `{success:false, error:{code:"validation_error"}}` if you use the wrong one for that endpoint.

## 8. Reporting endpoints are POST, not GET

All four reporting endpoints (`/report`, `/citations`, `/sentiment`, `/search-terms-report`) use POST with a JSON body, not GET with query params. This is slightly unusual for read endpoints — easy to get wrong if you've used other analytics APIs.

## 9. Credits include several separate balances

The `/credits` response separates **rankCredits**, **bonusRankCredits**, **analysisCredits**, and **promptResearchCredits**. These are not interchangeable — different operations consume different pools. Present them as separate lines, and surface `creditsInFlight` if non-zero (means runs are queued or executing).

## 10. The `run` action consumes credits

`POST /v1/metrics/search-terms/{id}/run` triggers an immediate AI-engine run for that search term. It costs credits across however many engines are attached. Always confirm with the user and show the current `analysisCredits` balance before triggering. The `runway.totalCostForNextExecution` field in `/credits` gives a rough estimate of cost-per-run.

## 11. Deprecated engines block activation

If a search term has a deprecated engine attached (see the engine catalog in `endpoints.md` for current deprecation status), `activate` and `run` calls fail with `400 deprecated_engine`. The fix is to update the search term to use the replacement engine (e.g. `google_gemini_30_flash` instead of the older Gemini 2.0/2.5).

## 12. Rate limit is firm: 200 req/min per key

Read `X-RateLimit-Remaining` from response headers and slow down before it hits zero. On `429`, use `X-RateLimit-Reset` (seconds) for backoff. For dashboards/reports, cache results 5–10 min — Rankscale recommends not polling reporting endpoints more often than the underlying execution schedule.

## 13b. `/citations` response shape — `occurrences` is the count, not `citations`

In the `/citations` response, `citationsByDomain[]` entries look like `{domain, occurrences, citations}` but **`citations` is the array of URL objects, not a number** — the per-domain count is `occurrences`, and `data.totalCitations` equals the sum of all `occurrences`. Citation share = `occurrences / totalCitations`. Top URLs come from flattening every domain's URL array (`{url, occurrences}`) and sorting by `occurrences`.

Two more gotchas in `domainSummary`:
- `topDomainsByOwnBrandCitations` (domains that cite the tracked brand) and `topDomainsByCompetitor` are **capped at 20 / 10 entries** respectively. Don't treat them as complete.
- `topDomainsByCompetitor` groups domains where a **competitor was mentioned** — this includes neutral third-party sites (Reddit, Booking, review blogs), NOT just competitor-owned domains. To find competitor-*owned* sites (e.g. to exclude them from an opportunity list), classify domains by judgment; don't rely on this field.

## 14. Workspace-member API keys resolve to the owner

If a workspace member generates an API key, all reads and writes operate on the **workspace owner's** data. This is fine in practice but worth knowing if multiple teammates have keys — you're all reading and writing the same dataset.

## 15. API keys are workspace-scoped — "Unauthorized access to brand" means wrong workspace

An API key (`rk_<hash>_<brandId>`) only reaches brands in the workspace that issued it. If `/report` (or any brand call) returns `bad_request` / `"Unauthorized access to brand"` **while `/credits` succeeds**, the key is valid but the brand lives in a different account/workspace — you have the wrong key for that brand, not a malformed request. Confirm which account owns the brand. (The Rankscale MCP connector authenticates separately and may be bound to a different account than `RANKSCALE_API_KEY`, so one surface can see a brand the other can't.)

## 16. `competitorTimeSeriesData` excludes the own brand

The per-competitor series in `data.competitorTimeSeriesData` lists competitors only — the tracked brand is **not** in it. Its daily values live in `data.ownBrandMetrics.historicalData.<agg>`. To compute a daily Brand Rank you must merge the two (timestamps align — verify first/last). This competitor set is also smaller (~25–35) than the full detected pool in `competitorMetrics` (dozens), so daily ranks for low-visibility brands are lower bounds. See the Brand Rank recipe (SKILL.md §6).

## 17. Aggregate metrics are period-weighted, not daily averages

Window-level `visibilityScore` (and any Brand Rank derived from it) is a weighted aggregate over the requested window — not the mean of the daily series. A brand can be aggregate rank 1 while sitting at daily rank 2 on most days. Use the aggregate for the headline and the daily series for the trend; don't try to reconcile them (cf. quirk 4).

## 18. Date filtering is reliable — the old "~7–8 days only" claim was a mis-casing artifact

Custom ranges (`isoStartDate`/`isoEndDate`) and long presets (`30d`, `3m`, `1y`) return the full requested window **when the params are cased correctly** (quirk 1). The earlier belief that the API "only returns the last 7–8 days" came from sending `timeframe` (wrong case), which was silently dropped. Verified in practice: `30d`/`daily` returns the correct daily buckets and custom ISO ranges are honored (mind the exclusive end, quirk 1b). Still verify the returned `timestamps[]` span matches the request — but don't fall back to the dashboard for long windows; the API handles them.
