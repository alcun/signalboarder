/**
 * Station search, kept pure and free of the DOM so it can be tested.
 *
 * The list is `[name, crs]` pairs, generated from the upstream CSV by
 * `scripts/build-stations.mjs`. It contains only stations the Darwin API can
 * answer for, which is why `isKnownCrs` is a real validity check and not just a
 * convenience.
 */

export type Station = [name: string, crs: string];

/** Fold case, accents and punctuation so "st albans" finds "St. Albans City". */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function foldAll(stations: Station[]): string[] {
  return stations.map(([name]) => fold(name));
}

/**
 * Best matches, most useful first: an exact code, then names starting with the
 * query, then names with a WORD starting with it, then anything containing it.
 *
 * Ten is enough to choose from without becoming a list to read.
 */
export function search(
  stations: Station[],
  keys: string[],
  query: string,
  limit = 10,
): Station[] {
  const needle = fold(query);
  if (!needle) return [];

  const exact: Station[] = [];
  const starts: Station[] = [];
  const word: Station[] = [];
  const contains: Station[] = [];

  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i]!;
    const key = keys[i]!;

    if (station[1].toLowerCase() === needle) exact.push(station);
    else if (key.startsWith(needle)) starts.push(station);
    else if (key.includes(` ${needle}`)) word.push(station);
    else if (key.includes(needle)) contains.push(station);
  }

  return [...exact, ...starts, ...word, ...contains].slice(0, limit);
}

/**
 * Is this a code the Darwin API can actually answer for?
 *
 * With no list loaded this returns true: the edge then decides, which keeps a
 * failed dataset fetch from blocking a perfectly good station.
 */
export function isKnownCrs(stations: Station[] | null, code: string): boolean {
  if (!stations) return true;
  const upper = code.toUpperCase();
  return stations.some(([, c]) => c === upper);
}

export function stationName(stations: Station[] | null, code: string): string | null {
  if (!stations) return null;
  const upper = code.toUpperCase();
  return stations.find(([, c]) => c === upper)?.[0] ?? null;
}
