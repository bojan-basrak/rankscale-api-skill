# Rankscale Metrics API — endpoint reference

Server: `https://rankscale.ai`. All endpoints sit under `/v1/`. Authentication: `Authorization: Bearer <RANKSCALE_API_KEY>`. POST endpoints require `Content-Type: application/json`. All responses follow the `{success, data}` / `{success, error}` envelope.

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

### POST `/v1/metrics/sentiment` — brand sentiment

Returns aggregate sentiment for the tracked brand and competitors, plus keyword clouds. Same shared filters.

### POST `/v1/metrics/citations` — citation analytics

URL- and domain-level citation aggregations with breakdowns by engine, query, own brand, and competitors. Same shared filters.

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
| Google Gemini 3 Pro | `google_gemini_30_Pro` | active |
| Anthropic Claude 3.5 Sonnet | `anthropic_claude_3_5_sonnet` | active |
| Anthropic Claude 3.5 Haiku | `anthropic_claude_3_5_haiku` | deprecated 2026-02-19 |
| Anthropic Claude 4.5 Haiku | `anthropic_claude_4_5_haiku` | active |
| DeepSeek V3 | `deepseek_chat` | active |
| Mistral Large | `mistral_large` | active |

Some endpoints accept friendly names (`ChatGPT`, `Perplexity`, `Gemini 2.5`, `Claude Haiku`, `Grok`, `Bing Copilot`) but **prefer IDs for integrations** — they're stable across naming changes.

---

## Brands

### GET `/v1/metrics/brands` — list brands

Returns `data.brands[]`:
```
{id, name, brandInfo: {names[], productNames[], description}, description, url,
 additionalDomains[], createdAt, operationalTopics[], operationalSearchTerms[], ...}
```

### POST `/v1/metrics/brands` — create a brand

Service-level validation requires at least `name`. Probe for additional required/optional fields by sending a minimal body and reading the 400/422 response.

### PATCH `/v1/metrics/brands/{brandId}` — update a brand

Body: partial brand object. Confirm with user before calling.

### DELETE `/v1/metrics/brands/{brandId}` — delete a brand

No body. **Destructive — always confirm with user, naming the brand explicitly.**

---

## Search terms

### GET `/v1/metrics/search-terms?brandId={brandId}` — list

Returns `data.searchTerms[]` with `{id, term, aiSearchEngines[], status, ...}`.

### POST `/v1/metrics/search-terms` — create
### PATCH `/v1/metrics/search-terms/{id}` — update
### DELETE `/v1/metrics/search-terms/{id}` — delete (confirm first)

### POST `/v1/metrics/search-terms/{id}/activate` — resume scheduled runs

No body. Errors with `400 deprecated_engine` if any attached engine is retired.

### POST `/v1/metrics/search-terms/{id}/deactivate` — pause

### POST `/v1/metrics/search-terms/{id}/run` — trigger immediate run

**Costs credits.** Show the user `analysisCredits` balance and confirm.

---

## Topics

### GET `/v1/metrics/topics?brandRef={brandId}` — list topics for a brand

Note the param name is **`brandRef`** here, not `brandId`. Returns `data.topics[]` with `{id, name, description, brandRef, myBrand, keywords, searchTermIds[], createdAt, createdBy, ...}`.

### POST `/v1/metrics/topics` — create

### PATCH `/v1/metrics/topics/{id}` — update or **move to another brand**

The docs note that topics can be moved between brands via PATCH — pass a different `brandRef` (or equivalent field) in the body. The exact field name isn't quoted in the docs we have; probe with a small payload first.

### DELETE `/v1/metrics/topics/{id}` — delete (confirm first)

---

## Credits

### GET `/v1/metrics/credits` — balances and runway

Returns:
```
data:
  rankCredits, bonusRankCredits, analysisCredits, promptResearchCredits, creditsInFlight
  runway:
    estimatedRunwayHours, creditsPerHourAvg, totalCostForNextExecution
    nextBilling: {_seconds, _nanoseconds}
    simulationLimitedByBilling, simulationLimitedByHorizon
    breakdown: {hourly, ...}
```

Convert `estimatedRunwayHours / 24` for days. `nextBilling._seconds` is a Unix epoch timestamp.

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

A non-JSON `404` with HTML body almost always means a wrong path — most often `/api/v1/...` instead of `/v1/...`.
