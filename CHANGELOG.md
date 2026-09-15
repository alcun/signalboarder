# Changelog

## Unreleased

### Added

- Add a stateless read-only MCP endpoint at `/mcp` with a `get_departures` tool
  for agents that need the same normalized station data as the board.

### Changed

- Simplify repository documentation to setup, API and development information.
- Remove the agent-specific guide and internal operational narratives.
- Add a railway animation to the README and refresh installation instructions.

### Fixed

- Count simultaneous requests sharing a provider fetch as one budget slot.
- Pass selected server origins into the macOS setup website build.
