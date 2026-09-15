# Changelog

## [1.3.0] - 2026-09-15

### Added

- MCP protocol `2026-07-28` alongside the earlier versions. The server answers
  `server/discover`, which Claude.ai sends before connecting, and serves
  stateless requests that carry their version in `_meta`. Modern results carry
  `resultType`, the server identity and cache hints on `tools/list`. An
  unsupported version or a header that contradicts the body gets the error the
  specification defines. Clients using `initialize` see no change.
- `mcp_connected` is also logged for `server/discover`, and modern tool listings
  and calls record the client name and protocol. Browser clients may send the
  `Mcp-Method` and `Mcp-Name` headers.

### Fixed

- The edge README no longer says station search sends no analytics.

## [1.2.4] - 2026-09-15

### Added

- The MCP server records connections, tool listings, tool calls and rejected
  requests in LoggerLizard, like the other fleet MCP servers. Departures fetched
  over MCP carry `surface: mcp`, and `GET /mcp` probes are recorded. Routine
  probes such as `server/discover`, which Claude.ai sends before connecting,
  are answered but not counted as rejections.

## [1.2.3] - 2026-09-15

### Changed

- The API-only image in `edge/Dockerfile` uses the same Bun 1 on Alpine base as
  the full image and runs tini as PID 1.

## [1.2.2] - 2026-09-15

### Fixed

- `GET /health` returned 404 from the container image, where only listed paths
  reach the API and everything else is served as a static file. It is listed
  now, and a test fails when an API route is missing from that list.

## [1.2.1] - 2026-09-15

### Added

- `GET /health` returns `status`, `service` and `version`. `/healthz` keeps its
  exact `{ "ok": true }` body.

### Changed

- The MCP server reports the version from `edge/package.json` instead of a
  separate hardcoded number, and a test fails when the changelog does not open
  with that version.

- The container runs Bun 1 on Alpine with tini as PID 1, so orphaned child
  processes are reaped.

### Fixed

- Accept MCP protocol version `2025-11-25`. Clients sending that
  `MCP-Protocol-Version` header, including Claude's custom connectors, were
  rejected with HTTP 400, which Claude reported as a sign-in requirement.

- Stop enforcing `MCP-Protocol-Version` and the origin allow-list on `/mcp`, so
  a future protocol version or an unlisted client origin no longer breaks
  connectors. The allow-list still narrows the REST API.

### Added

- Add optional MCP departure offsets and windows within National Rail’s two-hour
  horizon, using separate cache entries and the existing shared provider budget.

- Add MCP station lookup from the bundled station list, with ranked name/CRS
  matching, output schemas and station suggestions for invalid departure codes.

- Cache departure boards in the browser with TanStack Query, sharing one
  ten-train response across both views and restoring recent stations immediately.

- Add public MCP connection instructions, sample arguments and API examples
  to the website and READMEs.

- Add a stateless read-only MCP endpoint at `/mcp` with a `get_departures` tool
  for agents that need the same normalized station data as the board.

### Changed

- Return readable MCP departure boards alongside the unchanged structured model,
  with time, stale-data, attribution and retry guidance.
- Shorten the website MCP section, move it below Common questions, and update
  the tool reference and llms.txt with the station-to-departures workflow.

- Simplify repository documentation to setup, API and development information.
- Remove the agent-specific guide and internal operational narratives.
- Add a railway animation to the README and refresh installation instructions.

### Fixed

- Report known stations without provider boards as unavailable, without suggesting
  the rejected code again; explain fixture mode and its three demo boards.
- Restrict short MCP station queries to name/code prefixes and restore `/mcp`
  operational access logs while keeping station search out of analytics.
- Add client-specific MCP setup for Claude Code, Claude Desktop/claude.ai, Cursor
  and VS Code, and link the website MCP section to `llms.txt`.

- Reject unsupported MCP protocol headers.

- Restore the compact, centred platform board after the layout-stability pass
  spread its header, departures and clock across the entire screen.

- Keep the board header and clock in fixed slots during loading and view
  changes; show only three trains immediately when returning to platform view.

- Route MCP requests correctly when serving the bundled website, count each
  call once against its client's rate limit, and allow browser MCP headers.
- Validate MCP requests and tool arguments, reject disallowed browser origins,
  and acknowledge notifications without executing tools.

- Count simultaneous requests sharing a provider fetch as one budget slot.
- Pass selected server origins into the macOS setup website build.
