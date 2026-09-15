// MCP 2026-07-28, served alongside the legacy initialize handshake.
//
// 2026-07-28 made MCP stateless: there is no initialize, every request carries
// its protocol version in params._meta, and servers MUST answer server/discover.
// Claude.ai probes server/discover before connecting and falls back to
// initialize on anything that is not a modern answer, so before this every
// connection took the legacy path and logged a rejection on the way.
//
// This file is identical in every fleet MCP server (sitelookeratter,
// agentbeacon, vitalsbeacon-api, signalboarder). Change them together.
//
// A request is modern when its _meta names a protocol version, or when the
// MCP-Protocol-Version header names a modern one. Everything else is legacy and
// passes through untouched, so no existing client can be broken by this.
//
// Lenient on purpose: the spec also rejects a MISSING Mcp-Method, Mcp-Name or
// clientCapabilities. Only a header that CONTRADICTS the body is rejected here,
// which is the actual risk (a proxy routing on one value while the server runs
// another). Any rejection is a modern error, so a dual-era client will not fall
// back to initialize: refusing an omitted header could only lock out a real
// client, and these servers act on the body alone.

const KEY = "io.modelcontextprotocol/";

export const MODERN_VERSIONS = ["2026-07-28"];

// Tool lists change only on deploy and are identical for every caller.
const CACHE = { ttlMs: 60 * 60 * 1000, cacheScope: "public" } as const;

export interface EraServer {
  name: string;
  title: string;
  version: string;
  instructions: string;
  legacyVersions: string[];
}

export interface EraReply {
  status: number;
  body: unknown | null;
}

export type Era =
  | { kind: "legacy" }
  | { kind: "modern"; version: string; client?: string; clientVersion?: string }
  | { kind: "rejected"; reason: string; reply: EraReply };

// Client-declared or header text on its way into a log or an error: clamped.
const clamp = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 64) : undefined);

// Mcp-Name carries a name that is not plain ASCII as =?base64?...?=.
function decoded(value: string): string {
  const match = /^=\?base64\?(.*)\?=$/.exec(value);
  return match ? Buffer.from(match[1], "base64").toString("utf8") : value;
}

export function readEra(message: unknown, headers: Headers | undefined, legacyVersions: string[]): Era {
  if (!message || typeof message !== "object" || Array.isArray(message)) return { kind: "legacy" };
  const { id, method, params } = message as { id?: string | number | null; method?: unknown; params?: any };
  const meta = params && typeof params === "object" && params._meta && typeof params._meta === "object" ? params._meta : {};
  const bodyVersion = meta[`${KEY}protocolVersion`];
  const headerVersion = headers?.get("mcp-protocol-version") ?? undefined;

  // An unknown header version with no _meta stays legacy, as it always has.
  const version = typeof bodyVersion === "string"
    ? bodyVersion
    : headerVersion && MODERN_VERSIONS.includes(headerVersion) ? headerVersion : undefined;
  if (version === undefined || legacyVersions.includes(version)) return { kind: "legacy" };

  const reject = (status: number, code: number, text: string, reason: string, data?: unknown): Era => ({
    kind: "rejected",
    reason,
    reply: { status, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message: text, ...(data ? { data } : {}) } } },
  });

  if (!MODERN_VERSIONS.includes(version)) {
    return reject(400, -32022, "Unsupported protocol version", "unsupported_version", {
      supported: [...MODERN_VERSIONS, ...legacyVersions],
      requested: clamp(version),
    });
  }
  if (headerVersion !== undefined && headerVersion !== version) {
    return reject(400, -32020, `Header mismatch: MCP-Protocol-Version ${clamp(headerVersion)} does not match _meta ${version}`, "header_mismatch");
  }
  const headerMethod = headers?.get("mcp-method") ?? undefined;
  if (headerMethod !== undefined && headerMethod !== method) {
    return reject(400, -32020, `Header mismatch: Mcp-Method ${clamp(headerMethod)} does not match method ${clamp(method)}`, "header_mismatch");
  }
  const headerName = headers?.get("mcp-name") ?? undefined;
  const bodyName = params?.name ?? params?.uri;
  if (headerName !== undefined && typeof bodyName === "string" && decoded(headerName) !== bodyName) {
    return reject(400, -32020, `Header mismatch: Mcp-Name ${clamp(decoded(headerName))} does not match ${clamp(bodyName)}`, "header_mismatch");
  }

  const client = meta[`${KEY}clientInfo`];
  return { kind: "modern", version, client: clamp(client?.name), clientVersion: clamp(client?.version) };
}

const serverInfo = (server: EraServer) => ({
  [`${KEY}serverInfo`]: { name: server.name, title: server.title, version: server.version },
});

/** The server/discover result. Answered in either era: it costs nothing and tells a client everything. */
export function discover(id: string | number | null | undefined, server: EraServer): EraReply {
  return {
    status: 200,
    body: {
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        resultType: "complete",
        supportedVersions: [...MODERN_VERSIONS, ...server.legacyVersions],
        capabilities: { tools: {} },
        instructions: server.instructions,
        ...CACHE,
        _meta: serverInfo(server),
      },
    },
  };
}

/**
 * Shape a reply for a modern request: every result carries resultType and the
 * identity of the server, tools/list carries cache hints, and an unknown method is a
 * 404. Legacy replies are returned exactly as they were.
 */
export function finish<T extends EraReply>(reply: T, era: Era, server: EraServer, method: unknown): T {
  if (era.kind !== "modern") return reply;
  const body = reply.body as { result?: Record<string, any>; error?: { code: number } } | null;
  if (body?.error?.code === -32601) return { ...reply, status: 404 };
  if (!body?.result) return reply;
  const result = {
    resultType: "complete",
    ...body.result,
    ...(method === "tools/list" ? CACHE : {}),
    _meta: { ...body.result._meta, ...serverInfo(server) },
  };
  return { ...reply, body: { ...body, result } };
}
