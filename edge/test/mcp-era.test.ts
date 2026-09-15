// MCP 2026-07-28 alongside the legacy handshake, through the real handleMcp.
// Identical in every fleet MCP server apart from the imports and `send`.

import { describe, expect, test } from "bun:test";
import { handleMcp } from "../src/mcp";

const V = "2026-07-28";
const meta = {
  "io.modelcontextprotocol/protocolVersion": V,
  "io.modelcontextprotocol/clientInfo": { name: "era-test", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const never = async (): Promise<Response> => {
  throw new Error("dispatch should not be reached");
};
const send = (message: unknown, extra: Record<string, string> = {}) =>
  handleMcp(message, never, false, { headers: new Headers(extra) }) as Promise<{ status: number; body: any }>;

const modern = (id: number, method: string, params: Record<string, unknown> = {}) =>
  ({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } });
const headers = (method: string) => ({ "MCP-Protocol-Version": V, "Mcp-Method": method });

describe("MCP 2026-07-28", () => {
  test("server/discover answers with versions, capabilities, instructions, identity and cache hints", async () => {
    const { status, body } = await send(modern(1, "server/discover"), headers("server/discover"));
    expect(status).toBe(200);
    const result = body.result;
    expect(result.resultType).toBe("complete");
    expect(result.supportedVersions[0]).toBe(V);
    expect(result.supportedVersions).toContain("2025-11-25");
    expect(result.capabilities.tools).toBeDefined();
    expect(typeof result.instructions).toBe("string");
    expect(result.ttlMs).toBeGreaterThan(0);
    expect(result.cacheScope).toBe("public");
    expect(typeof result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("string");
  });

  test("server/discover also answers a probe that carries no _meta", async () => {
    const { body } = await send({ jsonrpc: "2.0", id: 1, method: "server/discover" });
    expect(body.result.supportedVersions).toContain(V);
  });

  test("a modern tools/list is stamped with resultType, identity and cache hints", async () => {
    const { status, body } = await send(modern(2, "tools/list"), headers("tools/list"));
    expect(status).toBe(200);
    expect(body.result.resultType).toBe("complete");
    expect(body.result.tools.length).toBeGreaterThan(0);
    expect(body.result.ttlMs).toBeGreaterThan(0);
    expect(body.result.cacheScope).toBe("public");
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"]).toBeDefined();
  });

  test("missing Mcp-* headers are tolerated", async () => {
    const { status, body } = await send(modern(3, "tools/list"));
    expect(status).toBe(200);
    expect(body.result.resultType).toBe("complete");
  });

  test("legacy requests are exactly as before", async () => {
    const init = await send({ jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "old", version: "1" } } });
    expect(init.body.result.protocolVersion).toBe("2025-11-25");
    expect(init.body.result.resultType).toBeUndefined();
    const list = await send({ jsonrpc: "2.0", id: 5, method: "tools/list" }, { "MCP-Protocol-Version": "2025-11-25" });
    expect(list.body.result.ttlMs).toBeUndefined();
  });

  test("an unknown version header with no _meta stays legacy rather than failing", async () => {
    const { status, body } = await send({ jsonrpc: "2.0", id: 6, method: "tools/list" }, { "MCP-Protocol-Version": "2030-01-01" });
    expect(status).toBe(200);
    expect(body.result.tools.length).toBeGreaterThan(0);
  });

  test("an unsupported _meta version is UnsupportedProtocolVersion with the supported list", async () => {
    const message = { jsonrpc: "2.0", id: 7, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } };
    const { status, body } = await send(message);
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toEqual(expect.arrayContaining([V, "2025-11-25"]));
    expect(body.error.data.requested).toBe("2099-01-01");
  });

  test("headers that contradict the body are HeaderMismatch", async () => {
    for (const extra of <Record<string, string>[]>[
      { "MCP-Protocol-Version": "2025-11-25" },
      { "Mcp-Method": "tools/list" },
      { "Mcp-Name": "something_else" },
      { "Mcp-Name": `=?base64?${Buffer.from("something_else").toString("base64")}?=` },
    ]) {
      const { status, body } = await send(modern(8, "tools/call", { name: "no_such_tool", arguments: {} }), { ...headers("tools/call"), ...extra });
      expect(status).toBe(400);
      expect(body.error.code).toBe(-32020);
    }
  });

  test("a base64 Mcp-Name that matches the body passes validation", async () => {
    const { status, body } = await send(modern(9, "tools/call", { name: "no_such_tool", arguments: {} }), {
      ...headers("tools/call"),
      "Mcp-Name": `=?base64?${Buffer.from("no_such_tool").toString("base64")}?=`,
    });
    expect(status).not.toBe(400);
    expect(body.error?.code).not.toBe(-32020);
  });

  test("an unknown method is a 404 for a modern client and unchanged for a legacy one", async () => {
    const modernReply = await send(modern(10, "made/up"), headers("made/up"));
    expect(modernReply.status).toBe(404);
    expect(modernReply.body.error.code).toBe(-32601);
    const legacyReply = await send({ jsonrpc: "2.0", id: 11, method: "made/up" });
    expect(legacyReply.status).toBe(200);
    expect(legacyReply.body.error.code).toBe(-32601);
  });
});
