import type { APIRoute } from "astro";
import { AUTHOR_URL, PAGES } from "../lib/pages";

export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, "") ?? "";
  const body = `# Signalboarder

> Turn any device into a live UK train departure board, with a matching physical ESP32-S3 board.

## What it is

Signalboarder shows live departure times, expected times, platforms and calling points. The browser fetches a small, normalised departure model from Signalboarder's gateway, which reads National Rail's Darwin data. There is no account and no user database. A chosen station may be remembered only in that browser's local storage.

## Pages

${PAGES.map((page) => `- [${page.h1}](${page.slug ? `${base}/${page.slug}` : base}): ${page.description}`).join("\n")}

## Details

- Search supports station names and three-letter CRS codes.
- Platform view shows the next three trains and calling points; tapping the clock opens the longer concourse view.
- Polling stops when the tab is hidden. A failed refresh leaves the last good board visible and labels it stale.
- Live data is powered by National Rail Enquiries. The station list credits Dav Wheat and Trainline EU under the ODbL.
- Signalboarder stores no journeys or personal data.

## MCP

- Endpoint: https://signalboarder.alcun.dev/mcp (Streamable HTTP, no account or API key).
- find_station: query (station name, partial name or CRS), limit (1–20, default 5). Returns query and stations [{name, crs}]. Search “Kings Cross” to get KGX; ask the user to resolve ambiguous matches.
- get_departures: crs (three letters), rows (1–10, default 2), optional time_offset (0–119 minutes ahead) and time_window (1–120 minutes, default 120 minus offset). Offset plus window must be at most 120; departures beyond two hours are unsupported. Returns a readable board and structured JSON with station, crs, generatedAt, stale, services and attribution.
- Scheduled/estimated times are Europe/London, 24h. expected is “On time”, “Delayed”, “Cancelled”, an HH:MM estimate, or “No report”.
- stale: true means older cached data after refresh failure or budget exhaustion. generatedAt is response time, not the provider observation time. Preserve National Rail attribution.
- Both tools share request limits. Station search uses no provider calls; departures share the board’s cache and daily budget. Follow Retry-After on HTTP 429. Future “On time” is a current report, not a guarantee. No arrivals or journey planning.
- [Connection instructions](https://github.com/alcun/signalboarder/blob/main/edge/README.md#mcp-setup).

## Related

- [alcun.dev](${AUTHOR_URL}): the maker.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
