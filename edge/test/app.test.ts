import pkg from "../package.json";
import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app";
import { createFixtureProvider, type Provider, type ProviderResult } from "../src/providers";

const silent = () => {};

function get(app: ReturnType<typeof createApp>, path: string, headers: Record<string, string> = {}) {
  return app.fetch(new Request(`http://edge${path}`, { headers }));
}

async function body(response: Response): Promise<any> {
  return response.json();
}

/** A provider whose answers and call count the test controls. */
function stubProvider(answers: ProviderResult[]): Provider & { calls: number } {
  let index = 0;
  return {
    name: "stub",
    calls: 0,
    async fetchBoard() {
      this.calls += 1;
      return answers[Math.min(index++, answers.length - 1)]!;
    },
  };
}

const board = (station: string): ProviderResult => ({
  kind: "ok",
  board: { crs: "NBN", station, services: [] },
});

describe("routes", () => {
  test("healthz is unauthenticated and touches no provider", async () => {
    const provider = stubProvider([]);
    const app = createApp({ provider, log: silent });

    const response = await get(app, "/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(provider.calls).toBe(0);
  });

  test("health reports status, service and version and touches no provider", async () => {
    const provider = stubProvider([]);
    const app = createApp({ provider, log: silent });

    const response = await get(app, "/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "signalboarder", version: pkg.version });
    expect(provider.calls).toBe(0);
  });

  test("returns a board in Signalboarder's model", async () => {
    const app = createApp({ provider: createFixtureProvider(), log: silent });

    const response = await get(app, "/v1/departures/nbn");
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.crs).toBe("NBN");
    expect(body.station).toBe("New Brighton");
    expect(body.stale).toBe(false);
    expect(body.services).toHaveLength(2);
    expect(body.attribution).toBe("Powered by National Rail Enquiries");
    // The firmware's five fields come first and in the struct's order.
    // `callingAt` is additive and optional: the board never reads it.
    expect(Object.keys(body.services[0]).slice(0, 5)).toEqual([
      "scheduled",
      "expected",
      "destination",
      "platform",
      "disrupted",
    ]);
    expect(body.services[0].callingAt).toContain("Hamilton Square");
    // A service with no calling points does not carry an empty array.
    expect(body.services[1].callingAt).toBeUndefined();
  });

  test("rows is clamped rather than trusted", async () => {
    const app = createApp({ provider: createFixtureProvider(), log: silent });

    expect(((await (await get(app, "/v1/departures/NBN?rows=1")).json()) as any).services).toHaveLength(1);
    // The NBN fixture has more services than maxRows, so this asserts the
    // ceiling rather than just running out of data.
    expect(((await (await get(app, "/v1/departures/NBN?rows=999")).json()) as any).services).toHaveLength(10);
    expect(((await (await get(app, "/v1/departures/NBN?rows=nonsense")).json()) as any).services).toHaveLength(2);
  });

  test("a malformed code and an unknown station are different answers", async () => {
    const app = createApp({ provider: createFixtureProvider(), log: silent });

    const malformed = await get(app, "/v1/departures/NB1");
    expect(malformed.status).toBe(400);
    expect((await body(malformed)).code).toBe("bad_crs");

    // This is the distinction Signalboarder needs to show NO STATION FOUND instead of
    // DATA ERROR, which is what currently traps it with no visible escape.
    const unknown = await get(app, "/v1/departures/QQQ");
    expect(unknown.status).toBe(404);
    expect((await body(unknown)).code).toBe("unknown_crs");
  });

  test("an empty board is served as a board", async () => {
    const app = createApp({ provider: createFixtureProvider(), log: silent });

    const response = await get(app, "/v1/departures/ZZZ");

    expect(response.status).toBe(200);
    expect((await body(response)).services).toEqual([]);
  });

  test("a provider failure is 502 and never leaks the reason", async () => {
    const provider = stubProvider([{ kind: "unavailable", reason: "status_500" }]);
    const app = createApp({ provider, log: silent });

    const response = await get(app, "/v1/departures/NBN");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, code: "provider_unavailable" });
  });

  test("any origin may read it, and credentials are never allowed", async () => {
    const app = createApp({ provider: createFixtureProvider(), log: silent });

    const response = await get(app, "/v1/departures/NBN", { origin: "https://example.com" });

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("rate limiting bites, and never on healthz", async () => {
    const app = createApp({ provider: createFixtureProvider(), rateLimit: 2, log: silent });

    expect((await get(app, "/v1/departures/NBN")).status).toBe(200);
    expect((await get(app, "/v1/departures/NBN")).status).toBe(200);

    const limited = await get(app, "/v1/departures/NBN");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();

    // The orchestrator must never be locked out of the liveness probe.
    expect((await get(app, "/healthz")).status).toBe(200);
  });
});

describe("cache and budget", () => {
  test("repeat requests inside the TTL cost one upstream call", async () => {
    const provider = stubProvider([board("New Brighton")]);
    let clock = 1_000;
    const app = createApp({ provider, ttlMs: 20_000, now: () => clock, log: silent });

    await get(app, "/v1/departures/NBN");
    await get(app, "/v1/departures/NBN");
    clock += 19_000;
    await get(app, "/v1/departures/NBN");

    expect(provider.calls).toBe(1);

    clock += 2_000;
    await get(app, "/v1/departures/NBN");
    expect(provider.calls).toBe(2);
  });

  test("a failed refresh serves the last good board, marked stale", async () => {
    const provider = stubProvider([board("New Brighton"), { kind: "unavailable", reason: "timeout" }]);
    let clock = 1_000;
    const app = createApp({ provider, ttlMs: 1_000, staleMs: 600_000, now: () => clock, log: silent });

    expect(((await (await get(app, "/v1/departures/NBN")).json()) as any).stale).toBe(false);

    clock += 5_000;
    const response = await get(app, "/v1/departures/NBN");
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.station).toBe("New Brighton");
  });

  test("an unknown station is never papered over with a stale board", async () => {
    // Otherwise a mistyped code would keep showing the previous station.
    const provider = stubProvider([board("New Brighton"), { kind: "unknown_crs" }]);
    let clock = 1_000;
    const app = createApp({ provider, ttlMs: 1_000, now: () => clock, log: silent });

    await get(app, "/v1/departures/NBN");
    clock += 5_000;

    expect((await get(app, "/v1/departures/NBN")).status).toBe(404);
  });

  test("the daily budget degrades to stale, then refuses", async () => {
    const provider = stubProvider([board("New Brighton")]);
    let clock = 1_000;
    const app = createApp({
      provider,
      ttlMs: 1_000,
      staleMs: 10_000,
      dailyBudget: 1,
      now: () => clock,
      log: silent,
    });

    expect((await get(app, "/v1/departures/NBN")).status).toBe(200);

    // Budget spent, but the cached board is still within its stale window.
    clock += 2_000;
    const degraded = await get(app, "/v1/departures/NBN");
    expect(degraded.status).toBe(200);
    expect(((await degraded.json()) as any).stale).toBe(true);

    // Past the stale window there is nothing honest left to serve.
    clock += 20_000;
    const refused = await get(app, "/v1/departures/NBN");
    expect(refused.status).toBe(503);
    expect((await body(refused)).code).toBe("provider_budget");

    expect(provider.calls).toBe(1);
  });

  test("a burst shares the last available upstream budget slot", async () => {
    let release: (value: ProviderResult) => void = () => {};
    const pending = new Promise<ProviderResult>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const provider: Provider = {
      name: "slow",
      fetchBoard() {
        calls += 1;
        return pending;
      },
    };
    const app = createApp({ provider, dailyBudget: 1, log: silent });

    const responses = Promise.all([
      get(app, "/v1/departures/NBN"),
      get(app, "/v1/departures/NBN"),
      get(app, "/v1/departures/NBN"),
    ]);
    release(board("New Brighton"));

    for (const response of await responses) expect(response.status).toBe(200);
    expect(calls).toBe(1);
  });
});
