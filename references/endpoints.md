# Rankscale Metrics API — endpoint reference

Server: `https://rankscale.ai`. All endpoints sit under `/v1/`. Authentication: `Authorization: Bearer <RANKSCALE_API_KEY>`. POST endpoints require `Content-Type: application/json`. All responses follow the `{success, data}` / `{success, error}` envelope.

**`warnings[]` — third envelope key.** A successful response may carry a top-level `warnings` array alongside `data` when the request contained fields the API didn't recognize. It is omitted entirely when there's nothing to report. Example (verified live 2026-07-29):

```json
{"success": true, "data": {...}, "warnings": [
  "Ignored unrecognized field 'startDate'. Did you mean 'isoStartDate'? Falling back to the default reporting window.",
  "Ignored unrecognized field 'timeframe'."
]}
```

**Always check `warnings` before trusting a reporting response** — it is the fastest way to catch the camelCase trap in quirks §1. Request bodies allow additional properties, so a mistyped field never errors; it lands here instead.

Rate limit: **200 requests per minute per API key.** Response headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (seconds to window reset), and `X-API-Version` (currently `1`). The API echoes any `X-Request-Id` you send.

Auth fallback for clients that can't set headers: `?api_key=$RANKSCALE_API_KEY` query param. Prefer the header form.

The API is available on **Agency Growth** and **Enterprise** plans only.

## Contents
- [Reporting](#reporting) — `/report`, `/search-terms-report`, `/sentiment`, `/citations`
- [Shared reporting filters](#shared-reporting-filters)
- [Engine ID catalog](#engine-id-catalog)
- [Brands](#brands)
- [Search terms](#search-terms)
- [Topics](#topics)
- [Credits](#credits)
- [Error codes](#error-codes)
- [Not covered: Share Links API](#not-covered-share-links-api)

---

## Reporting

All reporting endpoints are **POST** with a JSON body. `brandId` is always required. They share the time-window and filter options listed in [Shared reporting filters](#shared-reporting-filters) below.

### POST `/v1/metrics/report` — dashboard-ready metrics

Body (`MetricsReportRequest`):

| Field | Type | Notes |
|---|---|---|
| `brandId` | string, required | The brand to report on |
| `timeFrame` | enum string | `24h`, `7d`, `30d`, `3m`, `1y` |
| `aggregation` | enum string | `hourly`, `daily`, `weekly`, `monthly` — bucket size for time series |
| `periodOffset` | integer, default 0 | Shifts the preset window back; 0=current, 1=previous, … |
| `isoStartDate` | string | Custom range start. Paired with `isoEndDate`. Overrides `timeFrame`+`periodOffset`. |
| `isoEndDate` | string | Custom range end. Paired with `isoStartDate`. |
| `userTimezone` | string | IANA tz, e.g. `Europe/Berlin` — affects day-boundary alignment |
| `selectedTopic` | string \| string[] | Topic ID, name, `_orphaned`, array, or `"all"` |
| `selectedTags` | string \| string[] | Tag, `__UNTAGGED__`, array, or `"all"` |
| `selectedEngine` | string \| string[] | Engine ID (preferred) or friendly name, array, or `"all"` |
| `selectedQuery` | string \| string[] | Exact search-term query, array, or `"all"` |
| `searchTermId` | string | Single search-term filter |
| `includeNotFoundExecutions` | boolean | Whether executions where the brand wasn't found count toward metrics |
| `showLastRunMetrics` | boolean | Include the latest single-run snapshot alongside the window |

Response (`data` object, observed shape):

```
data.ownBrandMetrics:
  name, aliases[]
  visibilityScore, sentiment, mentions, citations, avgPosition, detectionRate, top3
  validMetricsCount
  trends: { visibilityScore, sentiment, mentions, citations, avgPosition, detectionRate, top3 }
  historicalData:
    hourly, daily, weekly, monthly      # only the one matching `aggregation` is populated
    each contains: timestamps[] + parallel arrays for each metric, plus brandNotFound[]
  topicMetricsData:
    hourly, daily, weekly, monthly      # per-topic time series; each entry has topicId, topicName,
                                        # plus the same metric arrays + timestamps[]
  engineMetricsData: similar shape, per AI engine
  preselectionWhitelist[], preselectionBlacklist[], manualWhitelist[], manualBlacklist[]

data.competitorMetrics[]:
  name, isOwnBrand, latestValue, trend, variations[],
  visibilityScore, latestRank, avgRank, avgSentiment, appearances,
  citationCount, detectionRate, top3, validMetricsCount

data.competitorTimeSeriesData:
  hourly, daily, weekly, monthly        # per-competitor time series — own brand NOT included
                                        # (merge ownBrandMetrics.historicalData for daily rank; see quirks 16)
```

Example:
```bash
curl -X POST https://rankscale.ai/v1/metrics/report \
  -H "Authorization: Bearer $RANKSCALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"brandId":"brand_abc123","timeFrame":"30d","aggregation":"daily","includeNotFoundExecutions":true}'
```

### POST `/v1/metrics/search-terms-report` — per-search-term snapshots

Same shared filters. Supports `includeAnswerTexts: true` to include the raw AI answer text for each execution (heavier payload).

Response (`data`):

```
data.timeFrame
data.requestedDateRange: {source, startDate, endDate}   # echo of the resolved window — check this
data.searchTerms[]:
  searchTermId, query, aiSearchEngines[], tags[], status
  topic: {id, name}
  interval, region, websearch, lastSnapshotAt
  ownBrand:      {name, visibilityScore, avgRank, detectionRate, top3, citationCount, avgSentiment}
  competitors[]: {name, visibilityScore, avgRank, detectionRate, top3, citationCount, avgSentiment}
  answerTexts[]: {executionId, executedAt, engine, answerText}   # only with includeAnswerTexts
```

`requestedDateRange` is the cheapest way to confirm the window the API actually applied (cf. quirks §1).

### POST `/v1/metrics/sentiment` — brand sentiment

Returns aggregate sentiment plus keyword clouds for the tracked brand and competitors. Same shared filters, plus:

| Field | Type | Notes |
|---|---|---|
| `deduplicated` | boolean | Deduplicates sentiment response paths where supported. Adds per-search-term cuts. |

Response (`data`) — observed shape is wider than the published schema:

```
data.brandSentiments[]                # the tracked brand (typically n=1)
data.companySentiments[]              # every detected brand incl. own (isOwnBrand: true) — dozens
data.brandSentimentsBySearchTerm[]    # undocumented; per-search-term cut
data.companySentimentsBySearchTerm[]  # undocumented; per-search-term cut

each entry:
  name, isOwnBrand, nameVariations[]
  totalSentimentScore, sentimentCount, avgSentiment       # avgSentiment = totalSentimentScore / sentimentCount, 0–100
  positiveCount, neutralCount, negativeCount              # keyword-level, NOT executions (quirks §19)
  executionCount
  hasWebGrounding, hasTrainingData                        # which sources contributed
  positiveKeywords, neutralKeywords, negativeKeywords     # objects, not arrays
  webGroundingKeywords:  {positive, neutral, negative, byEngine}
  trainingDataKeywords:  {positive, neutral, negative, byEngine}   # empty when hasTrainingData: false
  webGroundingSentimentByEngine:  {<engineId>: {sum, count, avg}}
  trainingDataSentimentByEngine:  {<engineId>: {sum, count, avg}}
```

**This is the heaviest endpoint in the API** — ~9 MB for `30d`, ~17 MB for `3m` on a single brand, because every keyword carries full `executionIds[]` and `timestamps[]` arrays. Always `-o` to a file; never read the payload inline. See quirks §19.

### POST `/v1/metrics/citations` — citation analytics

URL- and domain-level citation aggregations with breakdowns by engine, query, own brand, and competitors. Same shared filters, plus two options accepted **either as query params or in the body**:

| Field | Type | Notes |
|---|---|---|
| `deduplicated` | boolean | Deduplicates citation response paths where supported. Adds `data.searchTermsById`. |
| `uncapped` | boolean | Bypasses the default **5,000 unique-URL** detail cap for API callers. A final response-size guard may still trim the JSON — check `paginationInfo.responseTrimmed`. |

```bash
curl -X POST 'https://rankscale.ai/v1/metrics/citations?deduplicated=true&uncapped=true' \
  -H "Authorization: Bearer $RANKSCALE_API_KEY" -H "Content-Type: application/json" \
  -d '{"brandId":"brand_abc123","timeFrame":"30d"}'
```

Response (`data`):

```
totalCitations        # sum of all occurrences (e.g. 16599)
uniqueCitations       # distinct normalized URLs (e.g. 4008) — what the 5,000 cap counts
uniqueDomains         # distinct domains (e.g. 1008)
totalBrands           # undocumented; brands in the citation breakdown
timestampFormat       # undocumented; bucket the API chose, e.g. "weekly"
paginationInfo: {hasMore, totalCount, returnedCount,
                 citationsCapped, brandsCapped, capBypassed,
                 maxCitations: 5000, maxBrands: 50,
                 responseTrimmed, returnedDomainCount, totalDomainCount}
domainSummary: {topDomainsOverall, topDomainsByEngine, topDomainsByQuery,
                topDomainsByOwnBrandCitations, topDomainsByCompetitor}
citationsByDomain[]: {domain, occurrences, citations[]}   # `citations` is URLs, not a count (quirks §13b)
searchTermsById       # only with deduplicated: true
```

`paginationInfo` is the full cap-diagnostics block (only `responseTrimmed` is documented upstream). Read it before claiming a citation list is complete — see quirks §13c. A `3m` pull runs ~3.9 MB; write it to a file.

---

## Shared reporting filters

All four reporting endpoints accept the same time-window and filter fields.

**Time windows:**
- `timeFrame`: preset window. `24h | 7d | 30d | 3m | 1y`
- `periodOffset`: integer, moves the preset N periods into the past
- `isoStartDate` + `isoEndDate`: custom range (paired). Overrides `timeFrame`/`periodOffset`.
- `aggregation`: `hourly | daily | weekly | monthly`
- `userTimezone`: IANA tz string

**Filters** (AND across fields, OR within arrays):
- `selectedTopic` — topic ID/name, `_orphaned`, array, or `"all"`
- `selectedTags` — tag, `__UNTAGGED__`, array, or `"all"`
- `selectedEngine` — engine ID, array, or `"all"` (prefer IDs over friendly names)
- `selectedQuery` — exact query string, array, or `"all"`
- `searchTermId` — single search-term ID

---

## Engine ID catalog

### GUI engines (browser-based)
| Engine | ID |
|---|---|
| Google AI Overview | `google_ai_overview` |
| Google AI Mode | `google_ai_mode_gui` |
| Google Gemini | `google_gemini_gui` |
| ChatGPT | `chatgpt_gui` |
| Perplexity | `perplexity_gui` |
| xAI Grok | `xai_grok_gui` |
| Bing Copilot | `bing_copilot_gui` |

### API engines (provider APIs)
| Engine | ID | Status |
|---|---|---|
| Perplexity Sonar | `perplexity_sonar` | active |
| Perplexity Sonar-Pro | `perplexity_sonar_pro` | active |
| Perplexity Sonar-Reasoning | `perplexity_sonar_reasoning` | deprecated 2025-12-15 |
| Perplexity Sonar-Reasoning-Pro | `perplexity_sonar_reasoning_pro` | active |
| OpenAI GPT-4o | `openai_gpt-4o` | deprecated 2026-02-16 |
| OpenAI GPT-5 | `openai_gpt-5` | active |
| Google Gemini 1.5 Flash | `google_gemini_15` | deprecated 2025-09-24 |
| Google Gemini 2.0 Flash | `google_gemini_20` | deprecated 2026-04-01 → `google_gemini_30_flash` |
| Google Gemini 2.5 Flash | `google_gemini_25` | deprecates 2026-06-17 → `google_gemini_30_flash` |
| Google Gemini 3 Flash | `google_gemini_30_flash` | active |
| Google Gemini 3 Pro | `google_gemini_30_Pro` | **deprecated** → `google_gemini_31_Pro` |
| Google Gemini 3.1 Pro | `google_gemini_31_Pro` | active |
| Anthropic Claude 3.5 Sonnet | `anthropic_claude_3_5_sonnet` | active |
| Anthropic Claude 3.5 Haiku | `anthropic_claude_3_5_haiku` | deprecated 2026-02-19 |
| Anthropic Claude 4.5 Haiku | `anthropic_claude_4_5_haiku` | active |
| DeepSeek V3 | `deepseek_chat` | active |
| Mistral Large | `mistral_large` | active |

Some endpoints accept friendly names (`ChatGPT`, `Perplexity`, `Gemini 2.5`, `Claude Haiku`, `Grok`, `Bing Copilot`) but **prefer IDs for integrations** — they're stable across naming changes.

Note the inconsistent casing in the Gemini Pro IDs (`_Pro`, capital P) versus every other ID. Copy them exactly. Reporting responses may return legacy IDs for historical executions even after an engine is retired, so don't treat an unknown ID in a response as an error.

*Catalog current as of the 2026-07-29 docs revision.* Engines get deprecated on a rolling basis — if `400 deprecated_engine` fires on an ID listed active here, the catalog has moved on.

---

## Workspace endpoints — the `limit` param

All three list endpoints (`/brands`, `/search-terms`, `/topics`) take a `limit` query param: integer, **min 1, max 5000, default 1000**. There is no cursor or offset — `limit` is the only control, so a workspace with more than 1,000 records of a kind gets a silently truncated list unless you raise it. See quirks §20.

Create calls return **`201`** with `data: {id}`. Patch calls return `200` with `data: {id}`. Delete calls return `200` with `data: {id, deleted: true}`.

---

## Brands

### GET `/v1/metrics/brands?limit=1000` — list brands

Returns `data.brands[]`:
```
id, name, description, url, additionalDomains[], createdAt
brandInfo: {names[], productNames[], description}     # NOTE: output shape ≠ input shape (quirks §22)
defaultCountry, defaultLanguage
syncSchedules: {daily: {hour}, weekly: {weekday}, monthly: {dayOfMonth}}
operationalTopics[]:      {topicId, name, addedAt}
operationalSearchTerms[]: {searchTermId}
```

### POST `/v1/metrics/brands` — create a brand

Body (`BrandCreateRequest`). Enforces plan brand limits (`400 limit_reached`).

| Field | Type | Notes |
|---|---|---|
| `name` | string, **required** | min length 1 |
| `url` | string, **required** | min length 1 — *also required; the skill previously listed only `name`* |
| `description` | string | |
| `additionalDomains` | string[] | UI shows a `…15` cap next to this field — treat 15 as a likely max, unconfirmed |
| `brandInfo` | **array** of `{brands[], products[]}` | `BrandInfoInput[]` — **not** the `{names, productNames}` shape the GET returns (quirks §22) |
| `defaultCountry` | string, default `us` | |
| `defaultLanguage` | string, default `en` | |
| `insightsEnabled` | boolean, default `true` | |
| `syncSchedules` | object, nullable | `daily.hour` 0–23 · `weekly.weekday` `mon`…`sun` · `monthly.dayOfMonth` **1–28** (not 31) |

Returns `201` `{id}`.

### PATCH `/v1/metrics/brands/{brandId}` — update a brand

Body (`BrandPatchRequest`): every `BrandCreateRequest` field, all optional (`name`, `url`, `description`, `additionalDomains`, `brandInfo`, `defaultCountry`, `defaultLanguage`, `insightsEnabled`, `syncSchedules`). "Partially updates public brand fields. Internal identifiers and ownership fields cannot be overwritten." Confirm with the user before calling.

### DELETE `/v1/metrics/brands/{brandId}` — delete a brand

No body. Per the docs it "deletes a brand owned by the workspace and **detaches or deactivates related records**" — so topics and search terms are cascaded, not orphaned. Returns `{id, deleted: true}`.

**Destructive — always confirm with user, naming the brand explicitly, and say that its topics and search terms are detached/deactivated too.**

---

## Search terms

### GET `/v1/metrics/search-terms?brandId={brandId}&limit=1000` — list

`brandId` **required** (this endpoint uses `brandId`; the POST/PATCH bodies use `brandRef` — see quirks §7). Returns `data.searchTerms[]`:

```
id, term, aiSearchEngines[], status, executionsAmount
interval, region, websearch
createdAt, lastExecutionTime, nextScheduledExecutionTime    # the two times may be null
searchTermTopicRef: {id, name}
```

### POST `/v1/metrics/search-terms` — create

Body (`SearchTermCreateRequest`). Resolves `myBrand` from `brandRef`, adds the term to the brand's operational search terms, and optionally links a topic.

| Field | Type | Notes |
|---|---|---|
| `brandRef` | string, **required** | **`brandRef`, not `brandId`** (quirks §7) |
| `term` | string, **required** | the query text |
| `status` | enum, **default `inactive`** | `active` \| `inactive` — created paused unless you opt in (quirks §21) |
| `aiSearchEngines` | string[] | engine IDs |
| `interval` | enum | `hourly` \| `daily` \| `weekly` \| `monthly` \| `manual` |
| `intervalEveryN` | integer enum, default 1 | **only `1` or `2`** |
| `executionLimit` | number \| null | |
| `websearch` | boolean, default `false` | web-grounded behavior where the engine supports it |
| `tags` | string[] | |
| `competitors` | array | |
| `description` | string | |
| `language` | string \| null | |
| `region` | string \| null | |
| `region_string` | string \| null | **snake_case** — the one exception in an otherwise camelCase API |

Returns `201` `{id}`. Creating an **active** term on a deprecated engine is blocked with `400 deprecated_engine`.

### PATCH `/v1/metrics/search-terms/{id}` — update

Body (`SearchTermPatchRequest`): all of the above, all optional (including `brandRef`, `term`, `status`). Returns `200`.

### DELETE `/v1/metrics/search-terms/{id}` — delete (confirm first)

Returns `{id, deleted: true}`.

### POST `/v1/metrics/search-terms/{id}/activate` — resume scheduled runs

No body. "Activates a search term and schedules the next run when applicable." Returns `{id, status}`. Errors with `400 deprecated_engine` if any attached engine is retired.

### POST `/v1/metrics/search-terms/{id}/deactivate` — pause

No body. Returns `{id, status}`.

### POST `/v1/metrics/search-terms/{id}/run` — trigger immediate run

**Takes a body — an empty object `{}`** (`--data '{}'`), not a bodyless POST. Runs the term through the shared backend execution pipeline.

```
data: {success, duplicate, totalRequested, successCount, failureCount, skippedCount,
       results[]: {searchTermId, success, executionId, error}}
```

**The envelope lies here.** The docs are explicit: *"The envelope is successful even when the term-level result failed; inspect `data.success` and `data.results`."* A `200` with outer `success: true` can still be a failed run — see quirks §21.

**Costs credits.** Show the user `analysisCredits` balance and confirm.

---

## Topics

### GET `/v1/metrics/topics?brandRef={brandId}&limit=1000` — list topics for a brand

Note the param name is **`brandRef`** here, not `brandId`. Returns `data.topics[]`:

```
id, name, description, keywords          # keywords is a STRING, not an array
brandRef, myBrand                        # myBrand may be null
searchTermIds[], createdBy, createdAt, updatedAt
```

### POST `/v1/metrics/topics` — create

Body (`TopicCreateRequest`). Resolves `myBrand` from `brandRef` and updates the brand's operational topics list.

| Field | Type | Notes |
|---|---|---|
| `brandRef` | string, **required** | min length 1 |
| `name` | string, **required** | min length 1 |
| `description` | string | |
| `keywords` | string | a string, not an array |

Returns `201` `{id}`.

### PATCH `/v1/metrics/topics/{id}` — update or **move to another brand**

Body (`TopicPatchRequest`): `name`, `description`, `keywords`, `brandRef`. Moving a topic between brands is confirmed to be a `brandRef` change — brand operational-topic lists are kept in sync automatically and `myBrand` is refreshed.

**⚠ `brandRef: ""` detaches the topic** from its brand and clears `myBrand`. The docs' own example payload ships `"brandRef": ""` — copying it verbatim silently detaches. Omit the key entirely when you only mean to rename. See quirks §23.

### DELETE `/v1/metrics/topics/{id}` — delete (confirm first)

Returns `{id, deleted: true}`.

---

## Credits

### GET `/v1/metrics/credits` — balances and runway

Returns:
```
data:
  rankCredits, bonusRankCredits, analysisCredits, promptResearchCredits, creditsInFlight
  runway:
    estimatedRunwayHours, creditsPerHourAvg, totalCostForNextExecution
    nextBilling: {_seconds, _nanoseconds}   # may be null
    simulationLimitedByBilling, simulationLimitedByHorizon
    breakdown: [...]
  dashboardRunway:                          # dashboard-style burn-rate runway metrics
```

Convert `estimatedRunwayHours / 24` for days. `nextBilling._seconds` is a Unix epoch timestamp; the field can also come back `null` (no scheduled billing date), so guard before reading into it.

`runway` is the detailed simulation; `dashboardRunway` is the burn-rate view the app's dashboard shows. They can disagree — `runway` is bounded by `simulationLimitedByBilling` / `simulationLimitedByHorizon`, so quote `runway.estimatedRunwayHours` and mention which limit capped it rather than mixing the two.

The endpoint also documents `404 not_found` and `405 method_not_allowed` alongside the usual auth/rate-limit errors. It takes no body and no filters — it's the one plain `GET` in the reporting set.

---

## Error codes

| HTTP | Code | When |
|---|---|---|
| 400 | `invalid_request` | Body missing or not a JSON object |
| 400 | `validation_error` | Service-level validation (e.g. missing `name` or `term` on create) |
| 400 | `limit_reached` | Brand creation would exceed plan's brand cap |
| 400 | `deprecated_engine` | Activating / creating active / updating engines blocked because engine is deprecated |
| 401 | `auth_failed` | Key missing or invalid |
| 403 | `forbidden` | Resource doesn't belong to the effective workspace |
| 404 | `not_found` | Resource missing or path ID missing |
| 405 | `method_not_allowed` | Wrong HTTP method |
| 422 | `validation_error` | Schema validation — check `error.details` |
| 429 | `rate_limited` | Exceeded 200 req/min |
| 500 | `internal_error` | Backend error |

Error envelope:
```json
{"success": false, "error": {
  "code": "validation_error",
  "message": "Request validation failed",
  "details": { "fieldErrors": {"brandId": ["Required"]} }
}}
```

A non-JSON `404` with HTML body almost always means a wrong path — most often `/api/v1/...` instead of `/v1/...`. A non-JSON **`502`** with an HTML body is different: transient gateway failure on a heavy response, not a path error. Retry it. See quirks §6.

---

## Not covered: Share Links API

Rankscale publishes a second REST API — the **Share Links API** — for creating and managing public share links to brand dashboards. It is **not** part of this skill and uses a **different key**, issued from Settings → Sharing rather than Settings → Integrations, so `RANKSCALE_API_KEY` will not authenticate against it.

If the user asks to create, list, or revoke a public dashboard share link, say that it's a separate API this skill doesn't cover and point them at the Share Links docs in the Rankscale help center. Don't guess at its paths.
