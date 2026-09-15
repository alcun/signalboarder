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

Stateless Streamable HTTP with two read-only tools. No account, API key,
session ID or persistent connection is needed.

## MCP setup

Add `https://signalboarder.alcun.dev/mcp` as a remote Streamable HTTP server
in your MCP client. For self-hosting, use your server origin plus `/mcp`.

Try: **“What are the next five trains from King's Cross?”**

| Tool | Arguments | Result |
|---|---|---|
| `find_station` | `query`: name, partial name or CRS; `limit`: 1–20, default 5 | `{query, stations: [{name, crs}]}` and a readable list |
| `get_departures` | `crs`: three letters; `rows`: 1–10, default 2 | The departure JSON above and a readable board |

Search is case/punctuation-insensitive: “Kings Cross” finds KGX, “St Pancras”
finds STP, and “&” matches “and”. Exact codes and names rank first. Ask the
user to choose when results are ambiguous. Empty searches and empty boards
are successful results. Both tools declare output schemas for structured content.

Times are UK local (`Europe/London`), 24h. `expected` is `On time`, `Delayed`
(no estimate), `Cancelled`, an HH:MM estimate, or `No report`. `stale: true`
means an older cached board after a failed refresh or exhausted budget; fresh
cache hits have `stale: false`. `generatedAt` is the response timestamp, not
the provider observation time. Preserve the National Rail attribution.
Calling points may be missing and cover only the first portion of split trains.

### Check the connection

```sh
curl https://signalboarder.alcun.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"example","version":"1.0"}}}'

curl https://signalboarder.alcun.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_station","arguments":{"query":"kings cross"}}}'

curl https://signalboarder.alcun.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_departures","arguments":{"crs":"KGX","rows":5}}}'
```

### Limits and protocol

Each MCP request counts once against the REST API's request limit. Station
search spends no provider budget and emits no per-search analytics. Departures
use the existing route, cache and daily budget: at most one provider fetch per
call. There are no arrivals, time-window or journey-planning tools.

Tool failures return `isError: true` with recovery advice; invalid/unknown codes
include up to three station suggestions where possible. HTTP 429 includes a
retry message and `Retry-After`. Budget errors suggest checking again in five
minutes, but exhaustion may last until the rolling 24-hour budget resets.

The target protocol is `2025-06-18`; `2025-03-26` and `2024-11-05` version
values remain accepted over this POST transport (no legacy SSE endpoint).
Missing version headers use `2025-03-26` compatibility behaviour; unsupported
headers return HTTP 400, per the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
Send one JSON-RPC message per POST; batches are rejected. Notifications receive
HTTP 202 with no body and do not execute tools. `GET /mcp` returns HTTP 405.
Configured origin allow-lists apply to MCP browser requests.

### Bundled station data

`src/stations.json` is a checked-in copy of `web/public/stations.json`, imported
once at startup. It travels with `edge/src` in the root Docker image and works
in an edge-only checkout without `SIGNALBOARDER_WEB_ROOT`. No station network
requests or build-time downloads are needed. After refreshing the web dataset,
copy it to `edge/src/stations.json`; the MCP test suite checks byte-for-byte
agreement. Both copies are derived databases under ODbL, credited to
[Dav Wheat](https://github.com/davwheat/uk-railway-stations) and
[Trainline EU](https://github.com/trainline-eu/stations); see `src/stations.LICENSE.txt`.

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
