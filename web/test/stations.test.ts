import { describe, expect, test } from "bun:test";

import { fold, foldAll, isKnownCrs, search, stationName, type Station } from "../src/scripts/stations";

/** The real generated list, so these assert against the data we actually ship. */
const stations = (await Bun.file(new URL("../public/stations.json", import.meta.url)).json()) as Station[];
const keys = foldAll(stations);

const find = (query: string, limit = 10) => search(stations, keys, query, limit);
const names = (query: string) => find(query).map(([name]) => name);
const codes = (query: string) => find(query).map(([, crs]) => crs);

describe("the shipped dataset", () => {
  test("is a plausible list of UK stations", () => {
    expect(stations.length).toBeGreaterThan(2500);
    expect(stations.every(([name, crs]) => name.length > 0 && /^[A-Z]{3}$/.test(crs))).toBe(true);
  });

  test("has no duplicate codes", () => {
    expect(new Set(stations.map(([, crs]) => crs)).size).toBe(stations.length);
  });

  test("contains the stations this product was built around", () => {
    expect(stationName(stations, "NBN")).toBe("New Brighton");
    expect(stationName(stations, "GNW")).toBe("Greenwich");
    expect(stationName(stations, "LIV")).toBe("Liverpool Lime Street");
  });
});

describe("fold", () => {
  test("removes case, punctuation and accents", () => {
    expect(fold("St. Albans")).toBe("st albans");
    expect(fold("Abergele & Pensarn")).toBe("abergele pensarn");
    expect(fold("  Ynyswen  ")).toBe("ynyswen");
  });
});

describe("search", () => {
  test("finds a station by the name someone would actually type", () => {
    expect(names("new brighton")[0]).toBe("New Brighton");
    expect(names("greenwich")[0]).toBe("Greenwich");
  });

  test("finds it from a partial name", () => {
    expect(names("new brigh")[0]).toBe("New Brighton");
  });

  test("an exact code outranks every name match", () => {
    // "LIV" is Liverpool Lime Street. Nothing else may come first.
    expect(codes("LIV")[0]).toBe("LIV");
    expect(codes("liv")[0]).toBe("LIV");
  });

  test("ignores punctuation the user types but the data does not have", () => {
    // Upstream spells it "St Albans". Someone will type the full stop.
    expect(names("st. albans")[0]).toBe("St Albans");
    expect(names("st albans")[0]).toBe("St Albans");
  });

  test("matches on a later word, not just the start", () => {
    // Nobody remembers which "Lime Street" prefix they need.
    expect(names("lime street")).toContain("Liverpool Lime Street");
  });

  test("returns nothing for nonsense, and nothing for empty", () => {
    expect(find("zzzzzzq")).toEqual([]);
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
  });

  test("respects the limit", () => {
    expect(find("a", 5).length).toBe(5);
  });
});

describe("isKnownCrs", () => {
  test("accepts a real code and rejects a well-formed fake one", () => {
    expect(isKnownCrs(stations, "NBN")).toBe(true);
    expect(isKnownCrs(stations, "nbn")).toBe(true);
    // This is the check that saves an API request and reports the truth
    // immediately instead of after a round trip.
    expect(isKnownCrs(stations, "QQZ")).toBe(false);
  });

  test("accepts anything when the list failed to load", () => {
    // Degraded mode must never block a perfectly good station.
    expect(isKnownCrs(null, "QQZ")).toBe(true);
  });
});
