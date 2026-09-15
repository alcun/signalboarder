/**
 * Departure providers.
 *
 * One interface, one implementation selected at boot. The rest of the service
 * never learns who National Rail are, which is what makes a provider swap a
 * single-file change.
 */

import { normaliseBoard, type Board } from "./departures";

export interface DepartureWindow {
  offset: number;
  window: number;
}

export function normaliseDepartureWindow(query?: DepartureWindow): DepartureWindow | undefined {
  return query && !(query.offset === 0 && query.window === 120) ? query : undefined;
}

/**
 * A provider answers with exactly one of these. The distinction between
 * `unknown_crs` and `unavailable` is the whole reason this is a discriminated
 * union rather than a thrown error: Signalboarder must show `NO STATION FOUND` for the
 * first and `DATA ERROR` for the second, and today it cannot tell them apart.
 */
export type ProviderResult =
  | { kind: "ok"; board: Board }
  | { kind: "unknown_crs" }
  | { kind: "unavailable"; reason: string };

export interface Provider {
  readonly name: string;
  fetchBoard(crs: string, rows: number, query?: DepartureWindow): Promise<ProviderResult>;
}

export interface LdbwsOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
}

/**
 * National Rail Live Departure Board through Rail Data Marketplace.
 *
 * The consumer key travels in `x-apikey` and appears nowhere else: not in the
 * URL, not in a log line, not in an error returned to a client.
 */
export function createLdbwsProvider(options: LdbwsOptions): Provider {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: "ldbws",
    async fetchBoard(crs, rows, query) {
      query = normaliseDepartureWindow(query);
      const url = new URL(`${options.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(crs.toUpperCase())}`);
      if (query) {
        url.searchParams.set("timeOffset", String(query.offset));
        url.searchParams.set("timeWindow", String(query.window));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "GET",
          headers: { "x-apikey": options.apiKey, accept: "application/json" },
          signal: controller.signal,
        });
      } catch (error) {
        // Includes the abort. The reason is for our log, never for the client.
        return { kind: "unavailable", reason: error instanceof Error ? error.name : "fetch_failed" };
      } finally {
        clearTimeout(timer);
      }

      // VERIFIED against the live API on 2026-08-17: a well-formed but
      // unknown CRS returns 400 with {"Message":"Invalid crs code supplied"},
      // NOT the 404 this originally assumed. 404 is kept alongside it because
      // it costs nothing and is the other plausible answer if the gateway ever
      // changes; both mean the same thing to a client.
      //
      // This distinction matters: `unknown_crs` renders NO STATION FOUND with
      // the editing actions still visible, while `unavailable` renders a
      // network error. Getting it wrong tells someone who typed a bad code
      // that the service is broken.
      if (response.status === 400) {
        return query ? { kind: "unavailable", reason: "invalid_time_window" } : { kind: "unknown_crs" };
      }
      if (response.status === 404) {
        return { kind: "unknown_crs" };
      }

      if (!response.ok) {
        return { kind: "unavailable", reason: `status_${response.status}` };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { kind: "unavailable", reason: "bad_json" };
      }

      const board = normaliseBoard(crs, payload, rows);
      if (!board) return { kind: "unavailable", reason: "unexpected_shape" };
      return { kind: "ok", board };
    },
  };
}

/**
 * Development provider. Serves the same Darwin-shaped payloads as the firmware
 * host fixtures in `firmware/signalboarder/test/fixtures/`, through the same
 * normaliser, so the web board can be built and styled before the consumer key
 * exists.
 *
 * They are inline rather than read from disk because the Docker build context
 * is this directory alone. `test/departures.test.ts` runs the real fixture
 * files through the normaliser, so the two cannot silently diverge.
 */
/**
 * Development boards, generated from the current time.
 *
 * Fixed times were actively misleading: the clock said 14:22 while the board
 * showed departures from 13:08, which reads as stale live data rather than as
 * development data. These roll forward with the clock so the board always looks
 * like a board.
 */
function at(minutesFromNow: number): string {
  const t = new Date(Date.now() + minutesFromNow * 60_000);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(t);
}

function service(
  minutesFromNow: number,
  destination: string,
  platform: string,
  etd: string,
  callingAt: string[] = [],
) {
  return {
    std: at(minutesFromNow),
    etd: etd === "late" ? at(minutesFromNow + 3) : etd,
    platform,
    isCancelled: etd === "Cancelled",
    destination: [{ locationName: destination }],
    ...(callingAt.length
      ? { subsequentCallingPoints: [{ callingPoint: callingAt.map((n) => ({ locationName: n })) }] }
      : {}),
    minutesFromNow,
  };
}

const WIRRAL_LINE = [
  "Wallasey Grove Road",
  "Wallasey Village",
  "Birkenhead North",
  "Birkenhead Park",
  "Conway Park",
  "Hamilton Square",
  "James Street",
  "Moorfields",
  "Lime Street",
  "Liverpool Central",
];

const NORTH_KENT = [
  "Maze Hill",
  "Westcombe Park",
  "Charlton",
  "Woolwich Dockyard",
  "London Bridge",
  "London Cannon Street",
];

function fixtures(): Record<string, unknown> {
  return {
    NBN: {
      locationName: "New Brighton",
      // Quarter-hourly to Liverpool Central, which is what New Brighton runs,
      // with one delay and one cancellation in it.
      trainServices: [
        service(4, "Liverpool Central", "2", "On time", WIRRAL_LINE),
        service(19, "Liverpool Central", "2", "On time"),
        service(34, "Liverpool Central", "2", "late"),
        service(49, "Liverpool Central", "2", "On time"),
        service(64, "Liverpool Central", "2", "Cancelled"),
        service(79, "Liverpool Central", "1", "On time"),
        service(94, "Liverpool Central", "2", "late"),
        service(109, "Liverpool Central", "2", "On time"),
        service(124, "Liverpool Central", "2", "On time"),
        service(139, "Liverpool Central", "2", "On time"),
      ],
    },
    GNW: {
      locationName: "Greenwich",
      trainServices: [
        service(6, "London Cannon Street", "1", "late", NORTH_KENT),
        service(17, "Dartford", "2", "Cancelled"),
      ],
    },
    // A real board with nothing left to show. Clients must render this as "no
    // services", not as an error.
    ZZZ: { locationName: "Quiet Halt", trainServices: [] },
  };
}

export function createFixtureProvider(): Provider {
  return {
    name: "fixture",
    async fetchBoard(crs, rows, query) {
      query = normaliseDepartureWindow(query);
      const payload = fixtures()[crs.toUpperCase()] as { locationName?: unknown; trainServices?: unknown[] } | undefined;
      if (!payload) return { kind: "unknown_crs" };
      const filtered = query && payload.trainServices
        ? { ...payload, trainServices: payload.trainServices.filter((entry) => {
          const minutes = (entry as { minutesFromNow?: unknown }).minutesFromNow;
          return typeof minutes === "number" && minutes >= query.offset && minutes <= query.offset + query.window;
        }) }
        : payload;
      const board = normaliseBoard(crs, filtered, rows);
      if (!board) return { kind: "unavailable", reason: "unexpected_shape" };
      return { kind: "ok", board };
    },
  };
}
