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

### `GET /health`

Returns `{"status": "ok", "service": "signalboarder", "version": "…"}`, with the
version from `edge/package.json`. It never calls the provider.

### `GET /healthz`

Returns `{"ok":true}` without contacting the provider. Exempt from rate limits.

### `POST /mcp`

Stateless Streamable HTTP with two read-only tools. No account, API key,
session ID or persistent connection is needed.

## MCP setup

Add `https://signalboarder.alcun.dev/mcp` as a remote Streamable HTTP server
in your MCP client. For self-hosting, use your server origin plus `/mcp`.

### Claude Code

Run this in the project where you use Claude Code, then start Claude and check `/mcp`:

```sh
claude mcp add --transport http signalboarder https://signalboarder.alcun.dev/mcp
```

[Claude Code instructions](https://code.claude.com/docs/en/mcp).

### Claude Desktop / claude.ai

Open **Customize → Connectors → + → Add custom connector**. Name it
Signalboarder, paste `https://signalboarder.alcun.dev/mcp`, and click **Add**.
Leave OAuth fields empty. Enable it from **+ → Connectors** in the chat.
For Team/Enterprise, an owner first adds it under **Organization settings →
Connectors → Add → Custom → Web**.

These hosted connectors connect from Anthropic's servers, even in Desktop:
they cannot reach your `localhost`. Use a publicly reachable HTTPS address.
[Claude connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Cursor

Merge this into your project's `.cursor/mcp.json` (or `~/.cursor/mcp.json`
for all projects). Enable Signalboarder under Customize and allow its tools
when prompted in Agent chat.

```json
{
  "mcpServers": {
    "signalboarder": { "url": "https://signalboarder.alcun.dev/mcp" }
  }
}
```

[Cursor instructions](https://cursor.com/docs/mcp).

### VS Code (GitHub Copilot)

Merge this into `.vscode/mcp.json`. Use **MCP: List Servers** from the Command
Palette to start Signalboarder and accept the trust prompt, then select its
tools in Agent chat. **MCP: Add Server** also provides a guided setup.

```json
{
  "servers": {
    "signalboarder": {
      "type": "http",
      "url": "https://signalboarder.alcun.dev/mcp"
    }
  }
}
```

[VS Code instructions](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

Client instructions checked against official documentation on 15 September 2026.
Claude Code's HTTP connection was tested locally with fixtures. The Claude
Desktop custom connector was tested hands-on against the live server on
15 September 2026. Cursor and VS Code UI setup has not been tested hands-on. Locally running CLI/IDE
clients can use `http://127.0.0.1:3000/mcp` when the edge runs on the same machine;
cloud-hosted clients need an address reachable from their host.

### Tools

Try: **“What are the next five trains from King's Cross?”**

| Tool | Arguments | Result |
|---|---|---|
| `find_station` | `query`: name, partial name or CRS; `limit`: 1–20, default 5 | `{query, stations: [{name, crs}]}` and a readable list |
| `get_departures` | `crs`: three letters; `rows`: 1–10, default 2; optional `time_offset` and `time_window` in minutes | The departure JSON above and a readable board |

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

### Departures later in the next two hours

For trains starting an hour from now:

```json
{"crs":"KGX","rows":5,"time_offset":60,"time_window":30}
```

`time_offset` is 0–119 elapsed minutes ahead; `time_window` is 1–120 minutes.
Their sum must be at most **120**. If omitted, the window covers the remaining
part of that two-hour horizon. With neither argument, behaviour is unchanged.
These are relative minutes, not a date or UK clock time. A 6pm train cannot be
checked in the morning; ask again within two hours of departure. Future
“On time” is the current report, not a guarantee.

Each distinct window has its own cache entry but uses the same daily provider
budget. An uncached request costs at most one provider call; repeated cached
requests cost none. Cached results describe the window at provider query time,
not a newly shifted window on every request. The result text labels the window;
the structured departure model stays unchanged.

The public RDM endpoint was checked with live requests on 15 September 2026:
60+30, 90+30 and 119+1 minute windows returned correctly shifted departures;
360+30 was rejected. This is the public LDBWS product, not the separate staff
API with different time-query support.

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
search spends no provider budget. Standard
stdout `request` access logs remain enabled for `/mcp`. Departures
use the existing route, cache and daily budget: at most one provider fetch per
call. There are no arrivals or journey-planning tools, and no queries beyond two hours.

Tool failures return `isError: true` with recovery advice; invalid/unknown codes
include up to three station suggestions where possible. A known station rejected
by the provider is reported as temporarily unavailable, without suggesting the
same code again. Queries shorter than three characters match name/code prefixes only. HTTP 429 includes a
retry message and `Retry-After`. Budget errors suggest checking again in five
minutes, but exhaustion may last until the rolling 24-hour budget resets.

The server speaks protocol `2026-07-28` alongside the earlier versions. A
modern client can call `server/discover` and send stateless requests carrying
`io.modelcontextprotocol/protocolVersion` in `_meta`; results then include
`resultType`, the server identity, and cache hints on `tools/list`. An
unsupported `_meta` version gets `-32022` with the supported list, and a header
that contradicts the body gets `-32020`, both with HTTP 400. Missing `Mcp-*`
headers are tolerated. Earlier clients use `initialize`, which echoes
`2025-06-18`, `2025-03-26` or `2024-11-05` when asked and otherwise answers
`2025-11-25`, over this POST transport (no legacy SSE endpoint). A version
header alone is never enforced: a strict check once rejected Claude's connector
when the specification moved on.
Send one JSON-RPC message per POST; batches are rejected. Notifications receive
HTTP 202 with no body and do not execute tools. `GET /mcp` returns HTTP 405.
`/mcp` accepts any origin; `SIGNALBOARDER_ALLOWED_ORIGINS` narrows the REST API only.

### Fixture mode

With `SIGNALBOARDER_PROVIDER=fixture`, `find_station` searches the full station
list, but `get_departures` has demo boards only for `NBN` (New Brighton), `GNW`
(Greenwich) and `ZZZ` (an empty synthetic board). Other codes return an error
that explains fixture mode; retrying them cannot obtain live data. Switch to
`ldbws` with your provider credentials for live departures.

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
| `SIGNALBOARDER_ALLOWED_ORIGINS` | Any | Comma-separated CORS origins for the REST API (`/mcp` allows any) |

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
