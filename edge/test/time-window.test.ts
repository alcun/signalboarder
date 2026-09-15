import { describe, expect, test } from "bun:test";

import { createBoardCache } from "../src/cache";
import { createLdbwsProvider, type Provider, type ProviderResult } from "../src/providers";

const board = (station = "New Brighton"): ProviderResult => ({
  kind: "ok",
  board: { crs: "NBN", station, services: [] },
});

describe("departure windows", () => {
  test("keeps the default provider URL unchanged and adds temporal parameters when requested", async () => {
    const urls: string[] = [];
    const provider = createLdbwsProvider({
      baseUrl: "https://example.test/departures",
      apiKey: "secret",
      timeoutMs: 1000,
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ locationName: "New Brighton", trainServices: [] }), { status: 200 });
      },
    });

    await provider.fetchBoard("nbn", 2);
    await provider.fetchBoard("nbn", 2, { offset: 90, window: 30 });
    await provider.fetchBoard("nbn", 2, { offset: 0, window: 120 });

    expect(urls[0]).toBe("https://example.test/departures/NBN");
    expect(urls[1]).toBe("https://example.test/departures/NBN?timeOffset=90&timeWindow=30");
    expect(urls[2]).toBe("https://example.test/departures/NBN");
  });

  test("distinguishes temporal 400s from legacy unknown station 400s", async () => {
    const provider = createLdbwsProvider({
      baseUrl: "https://example.test/departures",
      apiKey: "secret",
      timeoutMs: 1000,
      fetchImpl: async () => new Response("{}", { status: 400 }),
    });

    expect((await provider.fetchBoard("NBN", 2)).kind).toBe("unknown_crs");
    expect((await provider.fetchBoard("NBN", 2, { offset: 90, window: 30 }))).toEqual({ kind: "unavailable", reason: "invalid_time_window" });
    expect((await provider.fetchBoard("NBN", 2, { offset: 0, window: 120 })).kind).toBe("unknown_crs");
  });

  test("isolates future cache entries and shares one budget slot for identical flights", async () => {
    const queries: unknown[] = [];
    let release: ((result: ProviderResult) => void) | undefined;
    const pending = new Promise<ProviderResult>((resolve) => { release = resolve; });
    const provider: Provider = {
      name: "test",
      fetchBoard: async (_crs, _rows, query) => {
        queries.push(query);
        if (query?.offset === 90) return pending;
        return board();
      },
    };
    const cache = createBoardCache({ provider, ttlMs: 20_000, staleMs: 600_000, dailyBudget: 2, now: () => 1_000 });

    await cache.get("NBN", 2);
    const futureA = cache.get("NBN", 2, { offset: 90, window: 30 });
    const futureB = cache.get("NBN", 2, { offset: 90, window: 30 });
    expect(queries).toHaveLength(2);
    release!(board("Future board"));
    expect((await futureA).kind).toBe("ok");
    expect((await futureB).kind).toBe("ok");

    // The future board has its own key; the ordinary board remains available.
    expect((await cache.get("NBN", 2)).kind).toBe("ok");
    expect(queries).toHaveLength(2);
  });
});

test("a future query never uses a current board as its stale fallback", async () => {
  let now = 1000;
  let calls = 0;
  const cache = createBoardCache({ provider: { name: "test", fetchBoard: async () => { calls++; return board(); } }, ttlMs: 100, staleMs: 10_000, dailyBudget: 1, now: () => now });
  await cache.get("NBN", 2);
  now += 500;
  expect(await cache.get("NBN", 2, { offset: 60, window: 30 })).toEqual({ kind: "budget_spent" });
  expect(await cache.get("NBN", 2)).toMatchObject({ kind: "ok", stale: true });
  expect(calls).toBe(1);
});
