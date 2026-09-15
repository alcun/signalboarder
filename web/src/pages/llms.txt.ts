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
- Read-only tool: get_departures. Arguments: crs (three-letter station code), rows (integer 1 to 10, default 2).
- Returns the same departure model as the board, including stale and National Rail attribution. Shared request limits apply.
- [Connection instructions](https://github.com/alcun/signalboarder/blob/main/edge/README.md#mcp-setup).

## Related

- [alcun.dev](${AUTHOR_URL}): the maker.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
