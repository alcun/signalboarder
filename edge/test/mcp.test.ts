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
