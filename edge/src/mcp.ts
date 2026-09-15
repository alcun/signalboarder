/** Stateless Streamable HTTP; departures always use the shared route. */
import pkg from "../package.json";
import { lizard } from "./lizard";
import { discover, finish, readEra, type EraServer } from "./mcp-era";
import type { Board } from "./departures";
import type { DepartureWindow } from "./providers";
import { findStations, stationHint, stationByCrs } from "./stations";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpReply { status: number; body: unknown | null }
type Dispatch = (crs: string, rows: number, query?: DepartureWindow) => Promise<Response>;
type DepartureResult = Board & { generatedAt: string; stale: boolean; attribution: string };
const string = { type: "string" } as const;
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

const departureTool = {
  name: "get_departures",
  title: "Live train departures",
  description: "Get 1–10 UK railway departures (default 2), now or within the next two hours. time_offset starts the search that many minutes ahead; time_window is its duration (default: the remainder of the two-hour horizon). Their sum must be at most 120. Requests beyond two hours, later today or tomorrow are unsupported: explain the limit instead of returning current trains. Future On time is the current report, not a guarantee. Use find_station if you only have a station name. Scheduled and estimated times are Europe/London local time, 24h. expected is On time, Delayed (no estimate), Cancelled, an HH:MM estimate, or No report. stale: true means an older cached board served after a failed refresh or exhausted budget; stale: false may still be a fresh cache hit. generatedAt is the response timestamp, not the provider observation time. Preserve attribution when presenting results. Calling points may be absent or only cover the first portion of a splitting train. This is a departure board, not a journey planner.",
  inputSchema: {
    type: "object",
    properties: {
      crs: { type: "string", description: "Three-letter National Rail CRS code, e.g. KGX. Case-insensitive." },
      rows: { type: "integer", minimum: 1, maximum: 10, default: 2 },
      time_offset: { type: "integer", minimum: 0, maximum: 119, default: 0, description: "Minutes ahead of provider query time to start; current departures if omitted. Relative elapsed minutes, not a UK clock time." },
      time_window: { type: "integer", minimum: 1, maximum: 120, description: "Search duration in minutes; defaults to 120 minus time_offset. Offset plus window must not exceed 120." },
    },
    required: ["crs"], additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      crs: string, station: string, generatedAt: string, stale: { type: "boolean" }, attribution: string,
      services: {
        type: "array", maxItems: 10,
        items: {
          type: "object",
          properties: {
            scheduled: string, expected: string, destination: string, platform: string,
            disrupted: { type: "boolean" }, callingAt: { type: "array", items: string },
          },
          required: ["scheduled", "expected", "destination", "platform", "disrupted"], additionalProperties: false,
        },
      },
    },
    required: ["crs", "station", "generatedAt", "stale", "services", "attribution"], additionalProperties: false,
  },
  annotations: { ...annotations, openWorldHint: true },
};

const stationTool = {
  name: "find_station",
  title: "Find a UK railway station",
  description: "Resolve a station name, partial name or CRS code before calling get_departures. Exact CRS, exact name, name prefix, word prefix, then substring matches. Case and punctuation are ignored. Queries under three characters match only name or CRS prefixes. Choose the intended station from ambiguous results; ask the user if needed. Searches a bundled list with no live provider call. Station data: Dav Wheat and Trainline EU, ODbL.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Station name or code, e.g. King's Cross, St Pancras or NBN." }, limit: { type: "integer", minimum: 1, maximum: 20, default: 5 } },
    required: ["query"], additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      query: string,
      stations: { type: "array", maxItems: 20, items: {
        type: "object", properties: { name: string, crs: string }, required: ["name", "crs"], additionalProperties: false,
      } },
    },
    required: ["query", "stations"], additionalProperties: false,
  },
  annotations: { ...annotations, openWorldHint: false },
};

function reply(id: JsonRpcRequest["id"], result: unknown): McpReply {
  return { status: 200, body: { jsonrpc: "2.0", id: id ?? null, result } };
}
function error(id: JsonRpcRequest["id"], code: number, message: string): McpReply {
  return { status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}
function toolError(id: JsonRpcRequest["id"], message: string): McpReply {
  return reply(id, { content: [{ type: "text", text: message }], isError: true });
}
function success(id: JsonRpcRequest["id"], structuredContent: unknown, text: string): McpReply {
  return reply(id, { content: [{ type: "text", text }], structuredContent, isError: false });
}

async function failureText(response: Response, crs: string, fixture: boolean): Promise<string> {
  try {
    const body = (await response.json()) as { code?: string };
    if (body.code === "unknown_crs") {
      const station = stationByCrs(crs);
      const message = station
        ? `${station.name} (${station.crs}) is a known station, but no departure board is available for it right now.`
        : `No station was found for ${crs}. ${stationHint(crs)}`;
      return message + (fixture
        ? " This server is in fixture mode: only NBN, GNW and ZZZ have demo boards. Station search still covers all stations. Retrying this code will not produce a board in fixture mode."
        : "");
    }
    const retry = response.headers.get("retry-after");
    const messages: Record<string, string> = {
      bad_crs: `The CRS code must be three letters. ${stationHint(crs)}`,
      rate_limited: `Request limit reached. Retry in ${retry ?? "3600"} seconds.`,
      provider_budget: `The daily departure provider budget is exhausted. Retry in about ${retry ?? "300"} seconds; the budget may remain exhausted until its rolling 24-hour reset.`,
      provider_unavailable: "The departure provider is temporarily unavailable. Try again in about a minute.",
    };
    return messages[body.code ?? ""] ?? "The departure request failed. Try again in about a minute.";
  } catch {
    return "The departure request failed. Try again in about a minute.";
  }
}

function boardText(board: DepartureResult, query?: DepartureWindow): string {
  return [
    `${board.station} (${board.crs}) — departures, Europe/London`,
    ...(query ? [`Search window: ${query.offset}–${query.offset + query.window} minutes after provider query time (${query.window}-minute window); cached boards may predate this response. Future status can change.`] : []),
    `Generated: ${board.generatedAt} (response time) | stale: ${board.stale}${board.stale ? " — older cached data; live refresh unavailable" : ""}`,
    ...board.services.map((service) => {
      const points = service.callingAt ?? [];
      return `${service.scheduled} | ${service.expected} | ${service.destination} | Platform ${service.platform || "not announced"}${points.length ? ` | Calling: ${points.slice(0, 3).join(", ")}${points.length > 3 ? ` (+${points.length - 3} more)` : ""}` : ""}`;
    }),
    ...(board.services.length ? [] : ["No departures currently listed."]),
    board.attribution,
  ].join("\n");
}

async function callTool(id: JsonRpcRequest["id"], name: string, args: Record<string, unknown>, dispatch: Dispatch, fixture: boolean): Promise<McpReply> {
  if (name === stationTool.name) {
    if (typeof args.query !== "string") return toolError(id, "The query argument must be a string: a station name or CRS code.");
    if (args.limit !== undefined && (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20)) return toolError(id, "The limit argument must be an integer from 1 to 20.");
    if (Object.keys(args).some((key) => key !== "query" && key !== "limit")) return toolError(id, "Only query and limit arguments are supported.");
    const stations = findStations(args.query, (args.limit as number | undefined) ?? 5);
    return success(id, { query: args.query, stations }, stations.length
      ? stations.map(({ name, crs }) => `${name} (${crs})`).join("\n")
      : "No stations found. Try a shorter query or a three-letter CRS code.");
  }
  if (typeof args.crs !== "string" || !args.crs) return toolError(id, "The crs argument is required. Use find_station to look up a station name.");
  if (!/^[a-z]{3}$/i.test(args.crs)) return toolError(id, `The CRS code must be three letters. ${stationHint(args.crs)}`);
  if (args.rows !== undefined && (typeof args.rows !== "number" || !Number.isInteger(args.rows) || args.rows < 1 || args.rows > 10)) return toolError(id, "The rows argument must be an integer from 1 to 10.");
  if (Object.keys(args).some((key) => !["crs", "rows", "time_offset", "time_window"].includes(key))) return toolError(id, "Only crs, rows, time_offset and time_window arguments are supported.");
  const offset = args.time_offset ?? 0;
  if (args.time_offset === null || typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 119) return toolError(id, "time_offset must be an integer from 0 to 119 minutes. National Rail only supports the next 2 hours (120 minutes); try again nearer departure for later trains.");
  const window = args.time_window ?? (120 - offset);
  if (args.time_window === null || typeof window !== "number" || !Number.isInteger(window) || window < 1 || window > 120 || offset + window > 120) return toolError(id, "time_window must be a positive integer and time_offset + time_window must be at most 120 minutes (2 hours). Use a shorter window or try again nearer departure.");
  const query = offset === 0 && window === 120 ? undefined : { offset, window };
  const response = await dispatch(args.crs, (args.rows as number | undefined) ?? 2, query);
  if (!response.ok) return toolError(id, await failureText(response, args.crs, fixture));
  const board = await response.json() as DepartureResult;
  return success(id, board, boardText(board, query));
}

export type McpContext = { ip?: string | null; ua?: string | null; headers?: Headers };

// Client-declared text on its way into analytics: clamped, never trusted.
const declared = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 64) : undefined);

// Methods a normal client probes and expects to be refused. Answered, but not
// logged as rejections, or routine handshakes become the most common failure.
const PROBES = new Set(["resources/list", "prompts/list"]);

const SERVER: EraServer = {
  name: "signalboarder",
  title: "Signalboarder",
  version: pkg.version,
  instructions: "Use find_station to turn a station name into a CRS code, then get_departures for the next 1–10 trains (default 2). Resolve ambiguous station names with the user. Both tools share the request limit; station search uses no provider budget and each departure call makes at most one provider fetch. Preserve National Rail attribution, explain stale results, and treat times as Europe/London. generatedAt is response time, not data age. Respect Retry-After on HTTP 429. For later departures use time_offset and optional time_window, whose sum must be at most 120 minutes. There is no support beyond the next two hours, arrivals or journey planning. Future status may change.",
  legacyVersions: PROTOCOL_VERSIONS,
};

/**
 * Analytics, matching the other fleet MCP servers. A departures call already
 * logs through the shared route (tagged surface: mcp), but who connected, with
 * which client and what failed before a tool ran is otherwise invisible. ping
 * and notifications stay unlogged: per-session chatter buries everything else.
 */
async function route(message: unknown, dispatch: Dispatch, fixture: boolean, ctx?: McpContext, seen?: Record<string, string | undefined>): Promise<McpReply> {
  const rejected = (reason: string, extra?: Record<string, unknown>) => lizard("mcp_rejected", { reason, ...extra }, undefined, "error", ctx);
  if (!message || Array.isArray(message) || typeof message !== "object") {
    rejected(Array.isArray(message) ? "batch" : "not_an_object");
    return error(null, -32600, "Invalid request. Send one JSON-RPC message, not a batch.");
  }
  const request = message as JsonRpcRequest;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || !request.method ||
      (request.id !== undefined && typeof request.id !== "string" && (typeof request.id !== "number" || !Number.isInteger(request.id))) ||
      (request.params !== undefined && (!request.params || typeof request.params !== "object" || Array.isArray(request.params)))) {
    rejected("invalid_request");
    return error(null, -32600, "Invalid request.");
  }
  if (request.id === undefined) return { status: 202, body: null };
  if (request.method === "ping") return reply(request.id, {});
  if (request.method === "initialize") {
    const requested = request.params?.protocolVersion;
    const protocolVersion = typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
    const client = request.params?.clientInfo as { name?: unknown; version?: unknown } | undefined;
    lizard("mcp_connected", {
      client: declared(client?.name),
      client_version: declared(client?.version),
      protocol: protocolVersion,
      protocol_asked: declared(requested),
    }, undefined, "ok", ctx);
    return reply(request.id, {
      protocolVersion, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER.name, title: SERVER.title, version: SERVER.version },
      instructions: SERVER.instructions,
    });
  }
  if (request.method === "tools/list") {
    lizard("mcp_tools_listed", seen, undefined, "ok", ctx);
    return reply(request.id, { tools: [departureTool, stationTool] });
  }
  if (request.method === "tools/call") {
    const params = request.params ?? {};
    if (params.name !== departureTool.name && params.name !== stationTool.name) {
      rejected("unknown_tool", { tool: declared(params.name) });
      return error(request.id, -32602, `Unknown tool: ${String(params.name ?? "")}`);
    }
    const args = params.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      rejected("bad_arguments", { tool: params.name });
      return toolError(request.id, "Tool arguments must be an object.");
    }
    const startedAt = Date.now();
    const result = await callTool(request.id, params.name, args as Record<string, unknown>, dispatch, fixture);
    const failed = (result.body as { result: { isError: boolean } }).result.isError;
    lizard("mcp_tool_called", { ...seen, tool: params.name }, Date.now() - startedAt, failed ? "error" : "ok", ctx);
    return result;
  }
  if (!PROBES.has(request.method)) rejected("unknown_method", { method: declared(request.method) });
  return error(request.id, -32601, `Unknown method: ${request.method}`);
}

/**
 * Handle one JSON-RPC message in either protocol era (see mcp-era.ts). A modern
 * 2026-07-28 request is validated, answered by server/discover or routed as
 * usual and stamped; a legacy request goes straight through.
 */
export async function handleMcp(message: unknown, dispatch: Dispatch, fixture = false, ctx?: McpContext): Promise<McpReply> {
  const era = readEra(message, ctx?.headers, PROTOCOL_VERSIONS);
  if (era.kind === "rejected") {
    lizard("mcp_rejected", { reason: era.reason }, undefined, "error", ctx);
    return era.reply;
  }
  const { id, method } = (message ?? {}) as JsonRpcRequest;
  const seen = era.kind === "modern" ? { client: era.client, protocol: era.version } : undefined;
  if (method === "server/discover" && id !== undefined) {
    // With no initialize in 2026-07-28, this is where a client names itself.
    lizard("mcp_connected", {
      client: seen?.client,
      client_version: era.kind === "modern" ? era.clientVersion : undefined,
      protocol: seen?.protocol,
      via: "server/discover",
    }, undefined, "ok", ctx);
    return discover(id, SERVER);
  }
  return finish(await route(message, dispatch, fixture, ctx, seen), era, SERVER, method);
}
