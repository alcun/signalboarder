# Departure API

A Bun and Hono service that fetches National Rail departures, normalises the
response and serves the browser and device clients.

## Development

From this directory:

```sh
bun install --frozen-lockfile
bun test
SIGNALBOARDER_PROVIDER=fixture bun run src/index.ts
```

The demo provider supports `NBN` (up to ten departures), `GNW` (delayed and
cancelled services), and `ZZZ` (an empty board). Other codes return an error.

## Endpoints

### `GET /v1/departures/:crs`

The station code is three letters, case-insensitive. The optional `rows` query
parameter is clamped to 1–10 and defaults to 2.

```json
{
  "crs": "NBN",
  "station": "New Brighton",
  "generatedAt": "2026-09-11T12:00:00Z",
  "stale": false,
  "services": [
    {
      "scheduled": "13:08",
      "expected": "On time",
      "destination": "Liverpool Central",
      "platform": "2",
      "disrupted": false,
      "callingAt": ["Wallasey Grove Road", "Liverpool Central"]
    }
  ],
  "attribution": "Powered by National Rail Enquiries"
}
```

`callingAt` is optional. `disrupted` covers delays and cancellations.
`generatedAt` is the response time. `stale` indicates cached data served after
an upstream failure or exhausted budget. An empty `services` array is valid.

Text limits are 39 characters for station and destination, 15 for expected,
7 for platform and 5 for scheduled time. JSON property order is not significant.
The device stores up to three services and formats calling points for its
scrolling line.

Errors use `{"ok":false,"code":"..."}`:

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_crs` | Invalid station-code format |
| 404 | `unknown_crs` | Station not recognised by the provider |
| 429 | `rate_limited` | Request limit reached; see `Retry-After` |
| 502 | `provider_unavailable` | Provider request or response failed |
| 503 | `provider_budget` | Local upstream budget exhausted |

### `GET /healthz`

Returns `{"ok":true}` without contacting the provider. Exempt from rate limits.

### `POST /mcp`

Stateless Streamable HTTP MCP endpoint. It exposes one read-only tool,
`get_departures`, with required `crs` and optional `rows` arguments. Tool calls
run through the same departure route as browser and device requests, so they
share its cache, provider budget and error model. Send JSON-RPC `initialize`,
`tools/list` and `tools/call` messages; notifications receive `202` with no
body. `GET /mcp` returns a short `405` explanation.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Listening port |
| `SIGNALBOARDER_PROVIDER` | `ldbws` | `ldbws` or `fixture` |
| `SIGNALBOARDER_LDBWS_KEY` | None | Provider consumer key |
| `SIGNALBOARDER_LDBWS_URL` | None | Provider base URL |
| `SIGNALBOARDER_PROVIDER_TIMEOUT_MS` | 8000 | Provider request timeout |
| `SIGNALBOARDER_WEB_ROOT` | None | Directory of built static pages |
| `SIGNALBOARDER_ALLOWED_ORIGINS` | Any | Comma-separated CORS origins |

The live provider requires both its key and base URL. Clients receive the
normalised response, never the provider credential.

See [SELFHOSTING.md](../SELFHOSTING.md) for cache, budget and rate-limit settings.

## Caching and limits

Responses are cached per station and requested row count. Concurrent requests
for the same cache key share one provider fetch and one budget slot.

Expired cache entries may be served with `stale: true` during the configured
stale window. An unknown station is never replaced by a stale response.

Caches and counters are per process and reset on restart. The provider budget
uses a rolling 24-hour window; it is not durable subscription-quota enforcement.
Replicas do not share counters.

When `SIGNALBOARDER_TRUST_PROXY=false`, requests share one rate-limit bucket.
Per-client limiting requires a controlled reverse proxy that overwrites incoming
`X-Forwarded-For`, and trusted-proxy mode enabled.

The API is unauthenticated and read-only. CORS settings control browser access;
they do not authenticate devices or other HTTP clients.
