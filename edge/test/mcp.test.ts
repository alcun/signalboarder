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
      expect((await response.json()).result.isError).toBe(false);
    }
    expect((await call("192.0.2.1")).status).toBe(429);
  });

  test("rejects invalid arguments before fetching departures", async () => {
    for (const rows of [0, 11, 1.5, "3", null]) {
      const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_departures", arguments: { crs: "NBN", rows } } });
      expect((await response.json()).result.isError).toBe(true);
    }
  });

  test("validates envelopes and never runs a notification as a tool", async () => {
    expect((await (await post({ id: 1, method: "ping" })).json()).error.code).toBe(-32600);
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
    expect((await initialized.json()).result.serverInfo.name).toBe("signalboarder");

    const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = await listed.json();
    expect(body.result.tools[0].name).toBe("get_departures");
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  test("gets fixture departures through the public route", async () => {
    const response = await post({ jsonrpc: "2.0", id: "board", method: "tools/call", params: { name: "get_departures", arguments: { crs: "NBN", rows: 3 } } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.station).toBe("New Brighton");
    expect(body.result.structuredContent.services).toHaveLength(3);
  });

  test("turns an unknown station into a model-readable tool error", async () => {
    const response = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_departures", arguments: { crs: "QQQ" } } });
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("No station");
  });

  test("GET explains that the endpoint is POST-only", async () => {
    const response = await app.fetch(new Request("http://edge/mcp"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
  });
});
