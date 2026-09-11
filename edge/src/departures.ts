/**
 * Signalboarder's departure model, and the Darwin mapping that produces it.
 *
 * This is the TypeScript side of `firmware/signalboarder/src/departures.h`. The field
 * names, the order and the widths are that struct's, deliberately, so the
 * browser board and the AMOLED consume one contract and there is no second
 * mapping to drift out of step.
 *
 * The rules below are ported from the physically proven
 * `parseHuxleyDepartureBoard` in `firmware/signalboarder/src/departures.cpp`. Huxley 2
 * is a thin JSON wrapper over OpenLDBWS, so these field names are Darwin's own
 * and the Rail Data Marketplace JSON product is expected to use the same
 * shape. VERIFY that against one real response before trusting it; the
 * consumer key does not exist yet.
 */

/**
 * Field widths from `departures.h`, as usable characters. The header declares
 * `char scheduled[6]` and so on, which is five characters plus a terminator.
 *
 * Bounding here rather than on the device means the browser and the board show
 * the same truncated text, and the firmware keeps no truncation logic of its
 * own.
 */
export const WIDTHS = {
  scheduled: 5,
  expected: 15,
  destination: 39,
  platform: 7,
  station: 39,
} as const;

export interface Departure {
  scheduled: string;
  expected: string;
  destination: string;
  platform: string;
  disrupted: boolean;
  /**
   * Stations this service calls at, in order, when the provider supplied them.
   *
   * ADDITIVE ONLY. `firmware/signalboarder/src/departures.h` has no such field and is
   * not changing: ArduinoJson reads the fields it asks for and ignores the rest,
   * so the board is unaffected. The web board scrolls these under the first
   * departure, which is the signature line of a real platform board.
   */
  callingAt?: string[];
}

export interface Board {
  crs: string;
  station: string;
  services: Departure[];
}

/**
 * Text is returned in natural case, not upper case.
 *
 * The firmware uppercases on the way into its struct and the web board does it
 * in CSS. Presentation belongs to the client: uppercasing here would throw
 * information away for every future surface, and would gain the device nothing
 * because `copyUpper` already runs.
 */
function bound(value: unknown, limit: number, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length === 0) return fallback;
  // Trim to the firmware's field width. Slicing by code unit matches the C
  // side's byte-wise copy for the ASCII that station names and times are.
  return raw.length > limit ? raw.slice(0, limit) : raw;
}

/**
 * A service is disrupted when it is cancelled, or when the expected time is
 * neither "On time" nor exactly the scheduled time.
 *
 * Ported verbatim from `departures.cpp`. Keep the two in agreement: the board
 * paints this red and the web board paints it amber, so a disagreement is
 * visible to the user rather than merely wrong.
 */
function isDisrupted(cancelled: boolean, expected: string, scheduled: string): boolean {
  if (cancelled) return true;
  const normalised = expected.trim().toLowerCase();
  if (normalised === "on time") return false;
  return expected.trim() !== scheduled.trim();
}

interface DarwinService {
  std?: unknown;
  etd?: unknown;
  platform?: unknown;
  isCancelled?: unknown;
  destination?: unknown;
  subsequentCallingPoints?: unknown;
}

/**
 * Subsequent calling points, in order.
 *
 * Darwin nests these as an array of lists, one per portion of a service that
 * splits. Only the first portion is taken: a board announces one route, and the
 * alternative is a line that contradicts itself halfway along.
 */
function callingPoints(service: DarwinService): string[] | undefined {
  const raw = (service as { subsequentCallingPoints?: unknown }).subsequentCallingPoints;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const first = raw[0] as { callingPoint?: unknown } | undefined;
  const points = Array.isArray(first?.callingPoint) ? first!.callingPoint : first;
  if (!Array.isArray(points)) return undefined;

  const names = points
    .map((p) => (p as { locationName?: unknown } | undefined)?.locationName)
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => n.trim());

  return names.length > 0 ? names : undefined;
}

/** First destination's location name, which is what the board has room for. */
function destinationName(service: DarwinService): unknown {
  const destinations = service.destination;
  if (!Array.isArray(destinations) || destinations.length === 0) return undefined;
  const first = destinations[0] as { locationName?: unknown } | undefined;
  return first?.locationName;
}

/**
 * Map one Darwin departure board into Signalboarder's model.
 *
 * Returns null only when the response is not a usable board at all. An empty
 * `trainServices` is NOT null: a station with no more trains tonight is a
 * correct board, and reporting it as a parse failure is what currently makes
 * Signalboarder show `DATA ERROR` for a quiet platform. Clients render an empty
 * `services` as "no services", never as a fault.
 */
export function normaliseBoard(crs: string, payload: unknown, rows: number): Board | null {
  if (typeof payload !== "object" || payload === null) return null;
  const response = payload as { locationName?: unknown; trainServices?: unknown };

  const services = Array.isArray(response.trainServices) ? response.trainServices : [];
  // A response with neither a station name nor a services array is not a board,
  // it is something else that happened to be JSON.
  if (typeof response.locationName !== "string" && !Array.isArray(response.trainServices)) {
    return null;
  }

  return {
    crs: crs.toUpperCase(),
    station: bound(response.locationName, WIDTHS.station, "Unknown"),
    services: services.slice(0, rows).map((entry): Departure => {
      const service = (entry ?? {}) as DarwinService;
      const scheduled = bound(service.std, WIDTHS.scheduled, "--:--");
      const expected = bound(service.etd, WIDTHS.expected, "No report");
      const calling = callingPoints(service);
      return {
        scheduled,
        expected,
        destination: bound(destinationName(service), WIDTHS.destination, "Unknown"),
        platform: bound(service.platform, WIDTHS.platform, ""),
        disrupted: isDisrupted(service.isCancelled === true, expected, scheduled),
        ...(calling ? { callingAt: calling } : {}),
      };
    }),
  };
}
