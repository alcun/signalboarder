import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createFixtureProvider } from "../src/providers";

const app = createApp({ provider: createFixtureProvider(), log: () => {} });

async function post(message: unknown): Promise<Response> {
  return app.fetch(new Request("http://edge/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  }));
}

describe("MCP", () => {
  test("counts one request per call and preserves separate proxy clients", async () => {
    const limited = createApp({ provider: createFixtureProvider(), rateLimit: 1, trustProxy: true, log: () => {} });
    const call = (ip: string) => limited.fetch(new Request("http://edge/mcp", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_departures", arguments: { crs: "NBN" } } }),
    }));
    for (const ip of ["192.0.2.1", "192.0.2.2"]) {
      const response = await call(ip);
      expect(response.status).toBe(200);
      expect((await response.json() as any).result.isError).toBe(false);
    }
    expect((await call("192.0.2.1")).status).toBe(429);
  });

  test("rejects invalid arguments before fetching departures", async () => {
    for (const rows of [0, 11, 1.5, "3", null]) {
      const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_departures", arguments: { crs: "NBN", rows } } });
      expect((await response.json() as any).result.isError).toBe(true);
    }
  });

  test("validates envelopes and never runs a notification as a tool", async () => {
    expect((await (await post({ id: 1, method: "ping" })).json() as any).error.code).toBe(-32600);
    const response = await post({ jsonrpc: "2.0", method: "tools/call", params: { name: "get_departures", arguments: { crs: "NBN" } } });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  test("supports browser preflight and enforces configured origins", async () => {
    const restricted = createApp({ provider: createFixtureProvider(), allowedOrigins: ["https://client.example"], log: () => {} });
    const allowed = await restricted.fetch(new Request("http://edge/mcp", { method: "OPTIONS", headers: { origin: "https://client.example", "access-control-request-headers": "content-type,mcp-protocol-version" } }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-headers")).toContain("MCP-Protocol-Version");
    const denied = await restricted.fetch(new Request("http://edge/mcp", { headers: { origin: "https://other.example" } }));
    expect(denied.status).toBe(403);
  });
  test("initializes and lists the read-only departure tool", async () => {
    const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(initialized.status).toBe(200);
    expect((await initialized.json() as any).result.serverInfo.name).toBe("signalboarder");

    const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = (await listed.json() as any);
    expect(body.result.tools[0].name).toBe("get_departures");
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  test("gets fixture departures through the public route", async () => {
    const response = await post({ jsonrpc: "2.0", id: "board", method: "tools/call", params: { name: "get_departures", arguments: { crs: "NBN", rows: 3 } } });
    const body = (await response.json() as any);
    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.station).toBe("New Brighton");
    expect(body.result.structuredContent.services).toHaveLength(3);
  });

  test("turns an unknown station into a model-readable tool error", async () => {
    const response = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_departures", arguments: { crs: "QQQ" } } });
    const body = (await response.json() as any);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("No station");
  });

  test("GET explains that the endpoint is POST-only", async () => {
    const response = await app.fetch(new Request("http://edge/mcp"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
  });
});

function client(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  const fixture = createFixtureProvider();
  let fetches = 0;
  const logs: unknown[] = [];
  const server = createApp({ provider: { name: "fixture", fetchBoard: (crs, rows, query) => {
    fetches++; return fixture.fetchBoard(crs, rows, query);
  } }, log: (line) => logs.push(line), ...options });
  const request = (message: unknown, headers: Record<string, string> = {}) => server.fetch(new Request("http://edge/mcp", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(message),
  }));
  const call = async (name: string, args: unknown) => (await (await request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json() as any).result;
  return { server, request, call, logs, fetches: () => fetches };
}

// Validate the JSON Schema vocabulary used by the advertised output schemas.
function conforms(value: unknown, schema: any): void {
  if (schema.type === "object") {
    expect(value !== null && typeof value === "object" && !Array.isArray(value)).toBe(true);
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) expect(Object.hasOwn(object, key)).toBe(true);
    for (const [key, child] of Object.entries(object)) {
      if (schema.additionalProperties === false) expect(Object.hasOwn(schema.properties, key)).toBe(true);
      conforms(child, schema.properties[key]);
    }
  } else if (schema.type === "array") {
    expect(Array.isArray(value)).toBe(true);
    if (schema.maxItems) expect((value as unknown[]).length).toBeLessThanOrEqual(schema.maxItems);
    for (const item of value as unknown[]) conforms(item, schema.items);
  } else expect(typeof value).toBe(schema.type);
}

describe("MCP discovery and regressions", () => {
  test("bundled dataset matches the website byte for byte", async () => {
    expect(await Bun.file(new URL("../src/stations.json", import.meta.url)).text()).toBe(await Bun.file(new URL("../../web/public/stations.json", import.meta.url)).text());
  });
  test("search handles names, punctuation, CRS and ranking without provider fetches; access logging stays enabled", async () => {
    const c = client();
    for (const query of ["kgx", "K.G.X.", "Kings Cross", "King’s Cross", "London King's Cross"]) {
      expect((await c.call("find_station", { query })).structuredContent.stations[0].crs).toBe("KGX");
    }
    for (const [query, crs] of [["St Pancras", "STP"], ["Abergele and Pensarn", "AGL"], ["Abergele & Pensarn", "AGL"], ["York", "YRK"]]) {
      expect((await c.call("find_station", { query })).structuredContent.stations[0].crs).toBe(crs);
    }
    const stations = (await c.call("find_station", { query: "cross", limit: 20 })).structuredContent.stations;
    expect(stations[0].name.toLowerCase().startsWith("cross")).toBe(true);
    expect(stations.findIndex((s: any) => s.name.toLowerCase().includes(" cross"))).toBeGreaterThan(0);
    expect(c.fetches()).toBe(0);
    expect(c.logs).toHaveLength(10);
    expect(c.logs.every((line: any) => line.event === "request" && line.path === "/mcp" && line.status === 200)).toBe(true);
  });
  test("empty matches are successful and search arguments are validated", async () => {
    const c = client();
    for (const query of ["", "   ", "...", "no such railway station xyz"]) {
      const result = await c.call("find_station", { query });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual({ query, stations: [] });
      expect(result.content[0].text).toContain("shorter query");
    }
    expect((await c.call("find_station", { query: "London" })).structuredContent.stations).toHaveLength(5);
    expect((await c.call("find_station", { query: "London", limit: 1 })).structuredContent.stations).toHaveLength(1);
    for (const args of [{}, { query: null }, { query: 2 }, { query: [] }, { query: "London", rows: 2 }, ...[0, 21, 1.5, "2", null].map((limit) => ({ query: "London", limit }))]) {
      expect((await c.call("find_station", args)).isError).toBe(true);
    }
    expect(c.fetches()).toBe(0);
  });
  test("suggests close stations and spends at most one fetch per departure call", async () => {
    const c = client();
    const bad = await c.call("get_departures", { crs: "Kings Cross" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("KGX");
    expect(c.fetches()).toBe(0);
    const unknown = await c.call("get_departures", { crs: "NBQ" });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain("Narborough (NBR)");
    expect(unknown.content[0].text.match(/\([A-Z]{3}\)/g)).toHaveLength(3);
    expect(c.fetches()).toBe(1);
    await c.call("get_departures", { crs: "NBN", rows: 10 });
    expect(c.fetches()).toBe(2);
    await c.call("get_departures", { crs: "NBN", rows: 10 });
    expect(c.fetches()).toBe(2);
  });
  test("output schemas conform; REST and MCP share data, cache and budget", async () => {
    const c = client({ now: () => 1_800_000_000_000, dailyBudget: 1 });
    const listing = await (await c.request({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json() as any;
    const [departures, stations] = listing.result.tools;
    expect(stations.annotations.openWorldHint).toBe(false);
    expect(departures.annotations.openWorldHint).toBe(true);
    expect(stations.title).toBeTruthy();
    conforms((await c.call("find_station", { query: "kings cross" })).structuredContent, stations.outputSchema);
    conforms((await c.call("find_station", { query: "..." })).structuredContent, stations.outputSchema);
    const board = await c.call("get_departures", { crs: "NBN", rows: 3 });
    conforms(board.structuredContent, departures.outputSchema);
    const rest = await (await c.server.fetch(new Request("http://edge/v1/departures/NBN?rows=3"))).json();
    expect(board.structuredContent).toEqual(rest);
    expect(c.fetches()).toBe(1);
    expect(board.content[0].text).toContain("Liverpool Central | Platform 2");
    expect(board.content[0].text).toContain("Wallasey Grove Road");
    expect(board.content[0].text).toContain("Powered by National Rail Enquiries");
    const budget = await c.call("get_departures", { crs: "GNW" });
    expect(budget.isError).toBe(true);
    expect(budget.content[0].text).toContain("300 seconds");
    expect(c.fetches()).toBe(1);
  });
  test("empty and stale boards remain successful", async () => {
    let now = 1_800_000_000_000;
    const c = client({ now: () => now, dailyBudget: 2, ttlMs: 1000 });
    const quiet = await c.call("get_departures", { crs: "ZZZ" });
    expect(quiet.isError).toBe(false);
    expect(quiet.content[0].text).toContain("No departures currently listed");
    await c.call("get_departures", { crs: "NBN" });
    now += 2000;
    const stale = await c.call("get_departures", { crs: "NBN" });
    expect(stale.isError).toBe(false);
    expect(stale.structuredContent.stale).toBe(true);
    expect(stale.content[0].text).toContain("stale: true");
    expect(c.fetches()).toBe(2);
  });
  test("search uses the shared rate limit and gives a retry time", async () => {
    const c = client({ rateLimit: 1, rateWindowMs: 60_000 });
    expect((await c.call("find_station", { query: "NBN" })).isError).toBe(false);
    const blocked = await c.request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_station", arguments: { query: "NBN" } } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(((await blocked.json() as any)).message).toContain("60 seconds");
    expect(c.fetches()).toBe(0);
  });
  test("invalid messages, tools, arguments and notifications never fetch", async () => {
    const c = client();
    for (const message of [[], [{ jsonrpc: "2.0", id: 1, method: "ping" }], null, { jsonrpc: "2.0", id: null, method: "ping" }, { jsonrpc: "2.0", id: 1.5, method: "ping" }, { jsonrpc: "2.0", id: 1, method: "ping", params: [] }]) {
      expect((await (await c.request(message)).json() as any).error.code).toBe(-32600);
    }
    expect((await (await c.request({ jsonrpc: "2.0", id: 1, method: "unknown" })).json() as any).error.code).toBe(-32601);
    expect((await (await c.request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "unknown" } })).json() as any).error.code).toBe(-32602);
    for (const args of [null, [], "NBN", {}, { crs: 2 }, { crs: "NBN", extra: true }]) expect((await c.call("get_departures", args)).isError).toBe(true);
    const notification = await c.request({ jsonrpc: "2.0", method: "tools/call", params: { name: "get_departures", arguments: { crs: "NBN" } } });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
    const invalidJson = await c.server.fetch(new Request("http://edge/mcp", { method: "POST", body: "{" }));
    expect(((await invalidJson.json() as any)).error.code).toBe(-32700);
    expect(c.fetches()).toBe(0);
  });
  test("accepts older/missing protocol headers; rejects unsupported headers before dispatch", async () => {
    const c = client();
    for (const version of [undefined, "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
      const response = await c.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version ?? "future" } }, version ? { "MCP-Protocol-Version": version } : {});
      const result = (await response.json() as any).result;
      expect(result.protocolVersion).toBe(version ?? "2025-11-25");
      expect(result.instructions).toContain("find_station");
      expect(result.serverInfo.version).toBe("1.2.0");
    }
    for (const version of ["", "garbage", "2020-01-01"]) {
      const response = await c.request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_departures", arguments: { crs: "NBN" } } }, { "MCP-Protocol-Version": version });
      expect(response.status).toBe(400);
      expect((await response.json() as any).error.message).toContain("MCP-Protocol-Version");
    }
    expect(c.fetches()).toBe(0);
  });
});

describe("MCP review fixes", () => {
  test("validates the bounded future departure window", async () => {
    const c = client();
    const invalid = [
      { time_offset: -1 }, { time_offset: 120 }, { time_offset: 1.5 }, { time_offset: "30" }, { time_offset: null },
      { time_window: 0 }, { time_window: 121 }, { time_window: 1.5 }, { time_window: "30" }, { time_window: null },
      { time_offset: 90, time_window: 31 }, { time_offset: 119, time_window: 2 },
    ];
    for (const extra of invalid) {
      const result = await c.call("get_departures", { crs: "NBN", ...extra });
      expect(result.isError).toBe(true);
    }
    expect(c.fetches()).toBe(0);
  });

  test("normalizes explicit default window values onto the ordinary REST cache", async () => {
    const c = client({ now: () => 1_800_000_000_000 });
    const ordinary = await c.call("get_departures", { crs: "NBN", rows: 3 });
    const explicit = await c.call("get_departures", { crs: "NBN", rows: 3, time_offset: 0, time_window: 120 });
    expect(ordinary.isError).toBe(false);
    expect(explicit.isError).toBe(false);
    expect(explicit.structuredContent).toEqual(ordinary.structuredContent);
    expect(c.fetches()).toBe(1);
  });

  test("future window text corresponds to the structured board and still fetches once", async () => {
    const c = client();
    const result = await c.call("get_departures", { crs: "NBN", rows: 3, time_offset: 90, time_window: 30 });
    expect(result.isError).toBe(false);
    expect(result.structuredContent.station).toBe("New Brighton");
    expect(result.structuredContent.services).toHaveLength(2);
    expect(result.content[0].text).toMatch(/90/);
    expect(result.content[0].text).toMatch(/30/);
    expect(c.fetches()).toBe(1);
  });

  test("reports the two-hour API limit without fetching when a future request exceeds it", async () => {
    const c = client();
    const result = await c.call("get_departures", { crs: "NBN", time_offset: 119, time_window: 2 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/120 minutes|2 hours|2-hour/);
    expect(c.fetches()).toBe(0);
  });

  test("known stations rejected by a provider are unavailable, never suggested back", async () => {
    for (const fixture of [false, true]) {
      const c = client(fixture ? {} : { provider: { name: "ldbws", fetchBoard: async () => ({ kind: "unknown_crs" }) } });
      const result = await c.call("get_departures", { crs: "kgx" });
      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("London Kings Cross (KGX) is a known station, but no departure board is available for it right now.");
      expect(text).not.toContain("Possible stations");
      expect(text).not.toContain("Use find_station");
      expect(text.includes("fixture mode")).toBe(fixture);
      if (fixture) {
        expect(text).toContain("only NBN, GNW and ZZZ");
        expect(text).toContain("Retrying this code will not produce a board");
        expect(c.fetches()).toBe(1);
      }
    }
  });

  test("short queries match only name or CRS prefixes, including punctuated input", async () => {
    const c = client();
    for (const query of ["KG", "K.G.", "k", "Yo"]) {
      const stations = (await c.call("find_station", { query, limit: 20 })).structuredContent.stations;
      const prefix = query.replace(/\./g, "").toLowerCase();
      expect(stations.length).toBeGreaterThan(0);
      for (const station of stations) expect(station.name.toLowerCase().startsWith(prefix) || station.crs.toLowerCase().startsWith(prefix)).toBe(true);
      expect(stations.some((station: any) => station.name === "Wakefield Kirkgate")).toBe(false);
    }
    expect(c.fetches()).toBe(0);
  });

  test("station hints never suggest the queried CRS", async () => {
    const { stationHint } = await import("../src/stations");
    expect(stationHint("KGX")).not.toContain("(KGX)");
    expect(stationHint("kgx")).not.toContain("(KGX)");
  });

  test("search keeps access logs without sending LoggerLizard analytics", async () => {
    const { spyOn } = await import("bun:test");
    const previousKey = process.env.LIZARD_SECRET_KEY;
    const network = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    process.env.LIZARD_SECRET_KEY = "test-only-key";
    try {
      const c = client();
      await c.call("find_station", { query: "Kings Cross" });
      expect(network).not.toHaveBeenCalled();
      expect(c.fetches()).toBe(0);
      expect(c.logs).toHaveLength(1);
      expect(c.logs[0]).toMatchObject({ event: "request", method: "POST", path: "/mcp", status: 200 });
    } finally {
      network.mockRestore();
      if (previousKey === undefined) delete process.env.LIZARD_SECRET_KEY;
      else process.env.LIZARD_SECRET_KEY = previousKey;
    }
  });
});
