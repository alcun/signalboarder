# Architecture

## Clients and API

The browser and device fetch departures from the Signalboarder API. The server
maps provider data into a shared response format and keeps provider credentials
out of both clients. See [edge/README.md](edge/README.md) for the contract.

The browser is a static Astro site. A TypeScript module handles station search,
polling and rendering. The API and built website run in one Bun process.

## State

The server has no database. Departure caches, rate limits and provider budgets
are held in memory. Browser preferences use local storage; device settings use
ESP32 non-volatile storage.

## Assets

Station data and font subsets are committed with their attribution and licence
notices. Builds do not refresh these assets automatically. Dataset updates must
also regenerate the device's station header.

## Tests

Server tests cover provider mapping, API responses, caching and limits. Device
tests cover parsing normalised responses and station lookup. The two suites
use different fixture formats because they test different stages.

## MCP time windows

MCP can query later departures only within the public provider’s next two-hour
horizon. Offsets use elapsed minutes to avoid clock-time/date/DST ambiguity.
Explicit default windows share the ordinary board cache; other windows have
separate cache keys and share one daily budget. REST and device defaults remain
unchanged. A missing future board never falls back to the current-time cache.
