/**
 * The board's whole client. One fetch loop, one render, no framework.
 *
 * Rules this file exists to honour, from edge/README.md:
 *  - fetch from the visitor's browser, never from an SSR render, or every
 *    visitor arrives at the edge as the server's single IP and shares one
 *    rate-limit bucket
 *  - stop polling on a hidden tab, because this is a page people leave open
 *  - keep the last good board on screen when a refresh fails, marked stale
 */

import { createDepartureQueries, type BoardResponse, type Service } from "./departure-query";
import {
  foldAll,
  isKnownCrs as isKnownCrsIn,
  search as searchIn,
  stationName as stationNameIn,
  type Station,
} from "./stations";

/**
 * How many services to show, and how big.
 *
 * A board is furniture: propped in landscape on a tablet it should fill the
 * screen and read from across a room, and on a phone it should still be a
 * board rather than a list. So the row count comes from the space available
 * and the type is sized to that row, rather than both being guessed in CSS.
 */
/**
 * Two views of one board.
 *
 * `platform` is the authentic object: the next three departures, the first with
 * its calling points rolling underneath, and a large clock with seconds at the
 * bottom. That is what a real platform sign shows, and it is the default.
 *
 * `concourse` is the station-hall answer to "show me everything": as many
 * services as fit, no calling points, no oversized clock. Tapping the clock
 * swaps between them, because the clock is the largest target on the board and
 * the only part of it that is not data.
 */
type View = "platform" | "concourse";

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const VIEW_KEY = "signalboarder:view";

let view: View = "platform";

/**
 * How many services to ask for. Not a measurement any more.
 *
 * The platform board shows three because that is what the object shows. The
 * concourse view asks for the edge's maximum and scrolls, so nothing has to be
 * measured, nothing is written to the DOM's styling, and rotating the device
 * changes nothing at all. Every previous version of this recomputed a pixel
 * type size on resize, which is what made it feel unsettled.
 */
const PLATFORM_ROWS = 3;
const CONCOURSE_ROWS = 10;

function wantedRows(): number {
  return view === "platform" ? PLATFORM_ROWS : CONCOURSE_ROWS;
}

const POLL_MS = 30_000;
const MAX_BACKOFF_MS = 240_000;
const STORAGE_KEY = "signalboarder:crs";

/** Set in the page head so a tailnet or localhost board can reach a local edge. */
const API: string = (window as unknown as { SIGNALBOARDER_API?: string }).SIGNALBOARDER_API ?? "";
const departureQueries = createDepartureQueries(API);
const INITIAL_CRS: string =
  (window as unknown as { SIGNALBOARDER_INITIAL_CRS?: string }).SIGNALBOARDER_INITIAL_CRS ?? "";

const el = {
  board: document.querySelector<HTMLElement>(".board")!,
  stationButton: document.querySelector<HTMLButtonElement>("#station-button")!,
  stationName: document.querySelector<HTMLElement>("#station-name")!,
  clock: document.querySelector<HTMLElement>("#clock")!,
  date: document.querySelector<HTMLTimeElement>("#board-date")!,
  services: document.querySelector<HTMLOListElement>("#services")!,
  alert: document.querySelector<HTMLElement>("#alert")!,
  meta: document.querySelector<HTMLElement>("#meta")!,
  full: document.querySelector<HTMLButtonElement>("#fullscreen")!,
  picker: document.querySelector<HTMLFormElement>("#picker")!,
  input: document.querySelector<HTMLInputElement>("#crs")!,
  results: document.querySelector<HTMLUListElement>("#results")!,
  attribution: document.querySelector<HTMLElement>("#attribution")!,
  loading: document.querySelector<HTMLElement>("#loading")!,
  welcome: document.querySelector<HTMLElement>("#welcome")!,
  empty: document.querySelector<HTMLElement>("#empty")!,
  chooseStation: document.querySelector<HTMLButtonElement>("#choose-station")!,
};

/**
 * Pad the list with hidden rows so the block holds its height.
 *
 * The board is vertically centred, so a services list that grows from nothing
 * to three rows moves everything on screen. Ghost rows are real rows, which
 * makes the reserved height exactly right by construction - deriving it from
 * --row and the gap instead would be a second source of truth that drifts the
 * first time a row gains a line.
 */
function padWithGhosts(count: number): void {
  // Platform view only. The concourse view starts at the top and scrolls, so
  // its height changing does not re-centre anything - and padding twelve rows
  // for a station with three services would just be a screen of blank.
  if (view !== "platform") return;
  const target = wantedRows();
  for (let i = count; i < target; i += 1) {
    const ghost = document.createElement("li");
    ghost.className = "service service--ghost";
    ghost.setAttribute("aria-hidden", "true");
    // Same internal structure as a real row, so it measures the same.
    for (const cls of [
      "service__ordinal",
      "service__scheduled",
      "service__platform",
      "service__destination",
      "service__expected",
    ]) {
      const span = document.createElement("span");
      span.className = cls;
      // A non-breaking space, so the row has a line box and therefore a height.
      span.textContent = "\u00a0";
      ghost.append(span);
    }
    // The first row in platform view carries a calling slot, so the first
    // GHOST must carry one too. Without it the empty board is one calling
    // line shorter than the full one, and because the board is centred that
    // difference lands as a jump the moment the first departures arrive.
    if (i === 0) ghost.append(emptyCallingLine());
    el.services.append(ghost);
  }
}

/** True while a fetch is in flight with nothing on the board to show yet. */
function setLoading(on: boolean): void {
  el.loading.hidden = !on;
}

const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/**
 * The station list, name to CRS.
 *
 * Loaded on first use rather than at startup, because the board must paint
 * before anyone opens the picker, and it is 56KB of JSON that a returning
 * visitor with a saved station never needs at all.
 *
 * The upstream dataset contains only stations the Darwin API can answer for, so
 * it doubles as a validity check: a well-formed code that is not in here cannot
 * return a board, and the picker can say so without spending a request.
 */
let stations: Station[] | null = null;
let stationsFailed = false;
let loading: Promise<void> | null = null;
/** Folded names, kept parallel to `stations` so search does no work twice. */
let searchKeys: string[] = [];
let highlighted = -1;

async function loadStations(): Promise<void> {
  if (stations || stationsFailed) return;
  if (loading) return loading;

  loading = (async () => {
    try {
      const response = await fetch("/stations.json", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      stations = (await response.json()) as Station[];
      searchKeys = foldAll(stations);
    } catch {
      // Degrade to code-only entry rather than blocking the picker. Every
      // three-letter code is then accepted and the edge decides.
      stationsFailed = true;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

let crs = "";
let lastGood: BoardResponse | null = null;
let failures = 0;
let timer: number | undefined;
let requestVersion = 0;

/**
 * Error copy. `unknown_crs` reads differently from every other failure on
 * purpose: a mistyped station is the user's to fix and must never look like an
 * outage, which is the trap the physical board is currently in.
 */
function message(code: string): string {
  switch (code) {
    case "unknown_crs":
      return "No station found";
    case "bad_crs":
      return "Enter three letters";
    case "rate_limited":
      return "Too many requests, waiting";
    case "provider_budget":
    case "provider_unavailable":
      return "Data error, retrying";
    default:
      return "Data error, retrying";
  }
}

/**
 * A problem belongs on the board; a timestamp belongs under it.
 *
 * `alert` is anything the reader might need to act on, and it stays above the
 * fold beside the picker. Everything else is metadata.
 */
function setStatus(text: string, alert = false): void {
  if (alert) {
    el.alert.textContent = text;
    el.alert.classList.add("board__alert--bad");
    el.meta.textContent = "";
    return;
  }
  el.alert.textContent = "";
  el.alert.classList.remove("board__alert--bad");
  el.meta.textContent = text;
}

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
});

const withSeconds = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/London",
});

/**
 * Two stable nodes, written to by text only.
 *
 * Rebuilding elements once a second is what makes a board feel like a web page
 * rather than a sign: it churns the DOM, and any animation or selection inside
 * is thrown away on every tick.
 */
const clockMinutes = Object.assign(document.createElement("span"), { className: "clock__hm" });
const clockSeconds = Object.assign(document.createElement("span"), { className: "clock__seconds" });
el.clock.replaceChildren(clockMinutes, clockSeconds);

function renderClock(): void {
  const now = new Date();
  setNumeric(el.date, dateLabel.format(now).replace(/,/g, ""));

  // Seconds are set smaller, as on the real sign, so the minute stays the thing
  // you read.
  const [hm, seconds] = withSeconds.format(now).split(/:(?=\d\d$)/);
  setNumeric(clockMinutes, hm ?? "--:--");
  setNumeric(clockSeconds, `:${seconds ?? "--"}`);
}

function renderBoard(board: BoardResponse): void {
  // Switching back from concourse must immediately show only three rows,
  // including while the next request is still in flight.
  board = { ...board, services: board.services.slice(0, wantedRows()) };
  el.stationName.textContent = board.station;
  document.title = `${board.station} departures`;
  el.attribution.textContent = board.attribution;
  el.board.classList.toggle("board--stale", board.stale);

  // Reuse the existing rows when the board has the same shape. A full rebuild
  // every thirty seconds flickers, drops the rolling calling line back to its
  // start, and reads as a page refreshing rather than a sign updating.
  // Ghosts are padding, not content: counting them here would make every
  // board look like a shape change and force a full rebuild each poll.
  const existing = [...el.services.children].filter(
    (node) => !(node as HTMLElement).classList.contains("service--ghost"),
  ) as HTMLElement[];
  const sameShape =
    existing.length === board.services.length &&
    existing.every((row, i) => {
      // The calling slot is always present on the first platform row now, so
      // its presence no longer varies with the data.
      const wantsCalling = view === "platform" && i === 0;
      return row.querySelector(".calling") !== null === wantsCalling;
    });

  if (sameShape) {
    board.services.forEach((service, i) => {
      const row = existing[i]!;
      row.classList.toggle("service--disrupted", service.disrupted);
      setNumeric(row.querySelector(".service__scheduled"), service.scheduled);
      setText(row, ".service__platform", service.platform);
      setText(row, ".service__destination", service.destination);
      setNumeric(row.querySelector(".service__expected"), expectedLabel(service));
      const run = row.querySelector<HTMLElement>(".calling__run");
      if (run) {
        const next = callingText(service);
        // Only touch it when the route itself changed, or the roll restarts.
        if (next && run.textContent !== next) run.textContent = next;
      }
    });
  } else {
  el.services.replaceChildren(
    ...board.services.map((service, index) => {
      const row = document.createElement("li");
      row.className = service.disrupted ? "service service--disrupted" : "service";

      // "2nd", "3rd". The first departure carries none: it is the one the board
      // is about, and its detail line sits directly beneath it.
      const ordinal = document.createElement("span");
      ordinal.className = "service__ordinal";
      ordinal.textContent = view === "platform" && index > 0 ? ORDINALS[index] ?? "" : "";

      const scheduled = document.createElement("span");
      scheduled.className = "service__scheduled";
      scheduled.replaceChildren(...numeric(service.scheduled));
      scheduled.setAttribute("data-v", service.scheduled);

      // A bare number beside the time, as the sign prints it. Blank rather than
      // absent so the column holds its width down the board.
      const platform = document.createElement("span");
      platform.className = "service__platform";
      platform.textContent = service.platform;

      const destination = document.createElement("span");
      destination.className = "service__destination";
      destination.textContent = service.destination;

      const expected = document.createElement("span");
      expected.className = "service__expected";
      // "On time" stands alone; a real time is prefixed, so the two never read
      // as the same kind of thing at a glance.
      expected.replaceChildren(...numeric(expectedLabel(service)));
      expected.setAttribute("data-v", expectedLabel(service));

      row.append(ordinal, scheduled, platform, destination, expected);

      if (view === "platform" && index === 0) {
        row.classList.add("service--first");
        // Always append the slot, even with no route to show. `.calling:empty`
        // holds its line, so a service without calling points does not make
        // the first row shorter and shove the centred board upwards.
        row.append(callingLine(service) ?? emptyCallingLine());
      }

      return row;
    }),
  );
  padWithGhosts(board.services.length);
  }

  setLoading(false);

  // An empty board is a correct answer, not a fault, and it is said ON the
  // board, where the trains would be, rather than in the alert line beneath it.
  // Said once: the alert stays quiet so the same words are not in two places.
  el.empty.hidden = board.services.length !== 0;

  if (board.services.length === 0) {
    el.alert.textContent = "";
    el.alert.classList.remove("board__alert--bad");
    el.meta.textContent = `Updated ${time.format(new Date(board.generatedAt))}`;
  } else if (board.stale) {
    setStatus(`Stale, last updated ${time.format(new Date(board.generatedAt))}`, true);
  } else {
    setStatus(`Updated ${time.format(new Date(board.generatedAt))}`);
  }
}

function renderResults(matches: Station[]): void {
  highlighted = -1;
  el.results.replaceChildren(
    ...matches.map(([name, code], index) => {
      const item = document.createElement("li");
      item.className = "result";
      item.id = `result-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.dataset.crs = code;

      const label = document.createElement("span");
      label.className = "result__name";
      label.textContent = name;

      const badge = document.createElement("span");
      badge.className = "result__crs";
      badge.textContent = code;

      item.append(label, badge);
      // pointerdown, not click: the input's blur would otherwise close the list
      // before a click could land on it.
      item.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        setStation(code);
      });
      return item;
    }),
  );
  el.results.hidden = matches.length === 0;
  el.input.setAttribute("aria-expanded", String(matches.length > 0));
}

function highlight(next: number): void {
  const items = [...el.results.children] as HTMLElement[];
  if (items.length === 0) return;
  if (highlighted >= 0) items[highlighted]?.setAttribute("aria-selected", "false");
  highlighted = (next + items.length) % items.length;
  const item = items[highlighted]!;
  item.setAttribute("aria-selected", "true");
  el.input.setAttribute("aria-activedescendant", item.id);
  item.scrollIntoView({ block: "nearest" });
}

function closeResults(): void {
  el.results.replaceChildren();
  el.results.hidden = true;
  highlighted = -1;
  el.input.setAttribute("aria-expanded", "false");
  el.input.removeAttribute("aria-activedescendant");
}

/**
 * The rolling calling-points line.
 *
 * Duplicated once so the text re-enters as it leaves, which is what makes it
 * read as a continuous marquee rather than a line that vanishes and restarts.
 * The duration scales with the length so a long route does not crawl.
 */
/**
 * Digits in fixed cells.
 *
 * Neither face has tabular figures: measured, "1" is 53 units against 93 for
 * most digits in the tall face. So every time is a different width, the centred
 * clock shuffles sideways as the minutes change, and the destination column
 * starts at a different place on every row. A real dot-matrix board gives every
 * character an identical cell, and so does this.
 */
function numeric(text: string): Node[] {
  return [...text].map((ch) => {
    if (ch < "0" || ch > "9") return document.createTextNode(ch);
    const cell = document.createElement("span");
    cell.className = "dig";
    cell.textContent = ch;
    return cell;
  });
}

function setNumeric(node: Element | null, text: string): void {
  if (!node || node.getAttribute("data-v") === text) return;
  node.setAttribute("data-v", text);
  node.replaceChildren(...numeric(text));
}

/** One place decides the wording, so the build and update paths agree. */
function expectedLabel(service: Service): string {
  return /^\d{1,2}:\d{2}$/.test(service.expected) ? `Exp ${service.expected}` : service.expected;
}

function callingText(service: Service): string | null {
  const stops = service.callingAt;
  return stops && stops.length > 0 ? `Calling at: ${stops.join(", ")}` : null;
}

function setText(row: HTMLElement, selector: string, value: string): void {
  const node = row.querySelector(selector);
  if (node && node.textContent !== value) node.textContent = value;
}

/**
 * The calling slot with nothing in it.
 *
 * Rendered when a service has no calling points, so the first platform row is
 * the same height either way. `.calling:empty` gives it its line. Without this
 * the row shrinks, and because the board is vertically centred that moves
 * every element on screen rather than just this one.
 */
function emptyCallingLine(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "calling";
  wrap.setAttribute("aria-hidden", "true");
  return wrap;
}

function callingLine(service: Service): HTMLElement | null {
  const text = callingText(service);
  if (!text) return null;

  const wrap = document.createElement("span");
  wrap.className = "calling";

  const run = document.createElement("span");
  run.className = "calling__run";
  run.textContent = text;
  wrap.style.setProperty("--roll", `${Math.max(18, text.length * 0.34).toFixed(0)}s`);

  wrap.append(run);
  return wrap;
}

function applyView(): void {
  el.board.classList.toggle("board--all", view === "concourse");
  el.clock.setAttribute(
    "aria-label",
    view === "platform"
      ? "Current time. Tap to show every departure."
      : "Current time. Tap to show the next three.",
  );
  el.clock.title = view === "platform" ? "Tap for every departure" : "Tap for the next three";
}

function showPicker(show: boolean): void {
  el.picker.hidden = !show;
  if (show) el.welcome.hidden = true;
  if (show) el.empty.hidden = true;
  if (show) {
    // Kick off the fetch as the picker opens, so the list is usually ready by
    // the time a second character has been typed.
    void loadStations();
    el.input.value = crs;
    el.input.focus();
    el.input.select();
  } else {
    closeResults();
  }
}

function schedule(delay: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(refresh, delay);
}

async function refresh(): Promise<void> {
  if (!crs) return;
  if (document.hidden) return; // Resumed by the visibility listener.
  const version = ++requestVersion;

  // Only while there is nothing to show. On a poll the board already holds a
  // full set of departures, and flashing dots over them every thirty seconds
  // would be the opposite of solid.
  if (!lastGood) setLoading(true);

  try {
    const payload = await departureQueries.fetch(crs);
    if (version !== requestVersion) return;

    failures = 0;
    lastGood = payload as BoardResponse;
    renderBoard(lastGood);
    schedule(POLL_MS);
  } catch (error) {
    if (version !== requestVersion) return;
    failures += 1;
    const code = error instanceof Error ? error.message : "unknown";
    setLoading(false);
    if (code === "unknown_crs" || code === "bad_crs") {
      lastGood = null;
      el.services.replaceChildren();
      padWithGhosts(0);
      el.stationName.textContent = "Signalboarder";
      setStatus(message(code), true);
      showPicker(true);
      return;
    }
    const delay = Math.min(POLL_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);

    if (lastGood) {
      // Keep the last good board readable rather than blanking it. The board
      // dims and says so, which is what the physical Signalboarder does.
      renderBoard({ ...lastGood, stale: true });
      setStatus(`${message(code)}, last updated ${time.format(new Date(lastGood.generatedAt))}`, true);
    } else {
      setStatus(message(code), true);
    }

    schedule(delay);
  }
}

function setStation(next: string): void {
  requestVersion += 1;
  crs = next.trim().toUpperCase();
  failures = 0;
  lastGood = null;
  el.services.replaceChildren();
  // Re-reserve immediately. Clearing the list without this collapses the block
  // to nothing, and on a centred board that throws every element up the screen
  // for as long as the request takes.
  padWithGhosts(0);
  // And turn the dots on HERE rather than waiting for refresh(), so the gap
  // between pressing Show and the first byte is never a silent blank board.
  setLoading(true);
  el.welcome.hidden = true;
  el.empty.hidden = true;

  try {
    localStorage.setItem(STORAGE_KEY, crs);
  } catch {
    // Private browsing. The station still works for this visit.
  }

  // A board is a bookmark: the station lives in the URL, without adding a
  // history entry for every change.
  const url = new URL(location.href);
  url.searchParams.set("s", crs);
  history.replaceState(null, "", url);

  const known = stationNameIn(stations, crs);
  if (known) el.stationName.textContent = known;

  setStatus("Loading");
  const cached = departureQueries.cached(crs);
  if (cached) {
    lastGood = cached;
    renderBoard(cached);
  }
  showPicker(false);
  schedule(0);
}

function initialStation(): string {
  const fromUrl = new URLSearchParams(location.search).get("s");
  if (fromUrl && /^[A-Za-z]{3}$/.test(fromUrl)) return fromUrl.toUpperCase();
  if (/^[A-Z]{3}$/.test(INITIAL_CRS)) return INITIAL_CRS;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

el.input.addEventListener("input", async () => {
  const value = el.input.value.trim();
  if (!value) {
    closeResults();
    return;
  }
  await loadStations();
  if (stationsFailed) return; // Code-only entry, no suggestions to offer.
  renderResults(searchIn(stations!, searchKeys, value));
});

el.input.addEventListener("keydown", (event) => {
  if (el.results.hidden) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlight(highlighted + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    highlight(highlighted - 1);
  } else if (event.key === "Escape") {
    closeResults();
  }
});

el.picker.addEventListener("submit", async (event) => {
  event.preventDefault();

  // Enter takes the highlighted suggestion if there is one, so arrow-then-enter
  // works the way every other search field does.
  const items = [...el.results.children] as HTMLElement[];
  if (highlighted >= 0 && items[highlighted]?.dataset.crs) {
    setStation(items[highlighted]!.dataset.crs!);
    return;
  }

  const value = el.input.value.trim();
  await loadStations();

  if (/^[A-Za-z]{3}$/.test(value)) {
    // Reject a code the Darwin API cannot answer for without spending a
    // request, and without the round trip that would make it feel like a fault.
    if (!isKnownCrsIn(stations, value)) {
      setStatus("No station found", true);
      closeResults();
      return;
    }
    setStation(value);
    return;
  }

  // Not a code, so treat it as a name. One match is unambiguous: take it.
  const matches = stations ? searchIn(stations, searchKeys, value) : [];
  if (matches.length === 1) {
    setStation(matches[0]![1]);
    return;
  }
  if (matches.length > 1) {
    renderResults(matches);
    setStatus("Choose a station");
    return;
  }
  setStatus(stationsFailed ? "Enter three letters" : "No station found", true);
});

el.stationButton.addEventListener("click", () => showPicker(el.picker.hidden));
el.chooseStation.addEventListener("click", () => showPicker(true));

/**
 * Full screen, and keeping the screen awake while it is.
 *
 * The two belong together: the only reason to put this board full screen is to
 * leave it somewhere as a board, and a device that dims after thirty seconds
 * fails at that.
 *
 * iPhone does not implement the Fullscreen API for anything but video, so the
 * control hides itself there rather than offering something that will not work.
 * The Add to Home Screen route does give a genuine chromeless board, which is
 * what the apple-mobile-web-app meta tags are for.
 */
let wakeLock: { release: () => Promise<void> } | null = null;

async function holdScreenAwake(want: boolean): Promise<void> {
  const api = (navigator as { wakeLock?: { request: (t: "screen") => Promise<any> } }).wakeLock;
  try {
    if (want && api && !wakeLock) {
      wakeLock = await api.request("screen");
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    // Denied or unsupported. The board still works, the screen may just sleep.
    wakeLock = null;
  }
}

if (document.fullscreenEnabled) {
  el.full.hidden = false;
  el.full.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // A refused request is not worth reporting on a departure board.
    }
  });

  document.addEventListener("fullscreenchange", () => {
    const on = Boolean(document.fullscreenElement);
    el.full.textContent = on ? "Exit" : "Full screen";
    void holdScreenAwake(on);
  });
}

// A wake lock is dropped when the tab is hidden and has to be retaken.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && document.fullscreenElement) void holdScreenAwake(true);
});

el.clock.addEventListener("click", () => {
  view = view === "platform" ? "concourse" : "platform";
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private browsing. The choice still holds for this visit.
  }
  const url = new URL(location.href);
  if (view === "concourse") url.searchParams.set("view", "all");
  else url.searchParams.delete("view");
  history.replaceState(null, "", url);

  applyView();
  if (lastGood) renderBoard(lastGood);
});

// Polling stops entirely on a hidden tab and catches up on return, so a board
// left open in a background window costs the edge nothing.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.clearTimeout(timer);
    return;
  }
  renderClock();
  schedule(0);
});

// Restore the view before rendering departure rows. The grid's control slots
// have the same dimensions in both views, including before this script runs.
if (new URLSearchParams(location.search).get("view") === "all") {
  view = "concourse";
} else {
  try {
    if (localStorage.getItem(VIEW_KEY) === "concourse") view = "concourse";
  } catch {
    // No storage, platform view it is.
  }
}
applyView();

renderClock();
window.setInterval(renderClock, 1000);

// Nothing to do on resize or rotation: the type scale is CSS and the row count
// does not depend on the space. That is the point.

const start = initialStation();
if (start) {
  // Reserve the rows before the first response arrives, so the board is
  // already its final height while the loading dots are running.
  padWithGhosts(0);
  setStation(start);
} else {
  // The empty state reserves the same space as a full board. Otherwise
  // choosing a station makes the whole centred board jump as it fills.
  padWithGhosts(0);
  setStatus("");
  el.empty.hidden = true;
  el.welcome.hidden = false;
}
