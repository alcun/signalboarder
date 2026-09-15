# Changelog

## Unreleased

### Added

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

- Reject unsupported MCP protocol headers and omit per-request MCP access logs
  so local station search produces no per-call logging.

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
