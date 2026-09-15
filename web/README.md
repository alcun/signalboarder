# Website

A static Astro site with a TypeScript departure board. The browser polls the
Signalboarder API; Astro does not fetch live departures while building pages.

## Local development

Install dependencies from the repository root:

```sh
(cd edge && bun install --frozen-lockfile)
(cd web && npm ci)
```

Start the demo API in one terminal, from the root:

```sh
SIGNALBOARDER_PROVIDER=fixture bun run edge/src/index.ts
```

Start Astro in another:

```sh
cd web
PUBLIC_SIGNALBOARDER_API=http://localhost:3000 npm run dev
```

Open the address printed by Astro. Choose `NBN` or `GNW` for demo trains.
`ZZZ` is an API-only empty-board fixture and is absent from the station picker.

`PUBLIC_SIGNALBOARDER_API` overrides the API origin. Without it, the browser
uses the page's own origin. To test on another device, bind Astro
with `npm run dev -- --host 0.0.0.0` and set the API URL to the development
computer's reachable address, not `localhost`.

For a production build served alongside the API, follow the root
[README](../README.md). Build-time settings and HTTPS deployment are in
[SELFHOSTING.md](../SELFHOSTING.md).

## Board behaviour

`src/scripts/board.ts` owns the fetch loop, station selection and rendering.

- **Platform view** shows three departures, the first train's calling points
  and a large clock. **Concourse view** shows up to ten services, with scrolling.
  Tap the clock to switch; the choice is saved and can be linked with `?view=all`.
- Station selection accepts names and CRS codes. A `?s=NBN` link opens a
  particular station; otherwise the browser restores the last selection.
- Polling stops in a hidden tab and resumes when it becomes visible. Failed
  requests back off to a four-minute maximum.
- TanStack Query Core caches each station's ten-train response for both views.
  Data stays fresh for 30 seconds and unused entries expire after five minutes.
  The cache is memory-only. Returning to a station shows cached data immediately;
  old data is marked stale while refreshing. View changes do not fetch.
- The platform board centres its header, departures and clock as one compact
  group. The concourse list starts at the top and scrolls within its departure
  region. Cached data makes view changes immediate, without a second layout
  change when another response arrives.
- Failed refreshes preserve the last good board, marked stale. An unknown
  station clears the old board and opens the picker.
- Full screen requests a screen wake lock. Browsers without the Fullscreen API
  can use their home-screen installation option where available.

Type sizes and spacing are controlled by CSS. Numeric characters occupy fixed
width cells because the typeface's digits have different widths. The board
occupies the first viewport, with explanatory content and the railway footer
below it.

`src/components/TrainFooter.astro` animates the existing train artwork after
scrolling settles. Reduced-motion visitors see a parked train.

## Pages and station data

`src/lib/pages.ts` lists the home page, about page and eight curated station
pages. Routes, page copy, sitemap and `llms.txt` use this registry. Adding a
station to the search dataset does not create a page for it.

`public/stations.json` contains the station search data. It is generated from
the checked-in CSV, with provenance in [data/README.txt](data/README.txt):

```sh
npm run stations
```

Builds use the committed data and fonts without fetching replacements. After
changing the station dataset, regenerate the firmware's station header too;
see its [design notes](https://github.com/alcun/signalboarder-device/blob/main/DESIGN.md).

The search functions in `src/scripts/stations.ts` are tested against the real
shipped dataset by `bun test`. Keep the dataset and National Rail attribution
visible in the site, and retain the [font notices](public/fonts/README.txt).
