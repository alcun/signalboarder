/**
 * Minimal stateless Streamable HTTP MCP handler for the public departure API.
 *
 * The tool deliberately dispatches through the existing HTTP route. That keeps
 * provider caching, limits and the response contract identical for browsers,
 * devices and agents.
 */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpReply {
  status: number;
  body: unknown | null;
}

const tool = {
  name: "get_departures",
  description: "Get live departures for a UK railway station by its three-letter CRS code.",
  inputSchema: {
    type: "object",
    properties: {
      crs: { type: "string", description: "Three-letter National Rail CRS station code, for example NBN." },
      rows: { type: "integer", minimum: 1, maximum: 10, description: "Number of departures to return, from 1 to 10." },
    },
    required: ["crs"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
} as const;

function reply(id: JsonRpcRequest["id"], result: unknown): McpReply {
  return { status: 200, body: { jsonrpc: "2.0", id: id ?? null, result } };
}

function error(id: JsonRpcRequest["id"], code: number, message: string): McpReply {
  return { status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}

function toolError(id: JsonRpcRequest["id"], message: string): McpReply {
  return reply(id, { content: [{ type: "text", text: message }], isError: true });
}

async function failureText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: string };
    const messages: Record<string, string> = {
      bad_crs: "The CRS code must be three letters.",
      unknown_crs: "No station was found for that CRS code.",
      rate_limited: "The departure API is rate limited; try again later.",
      provider_budget: "The departure provider budget is temporarily exhausted.",
      provider_unavailable: "The departure provider is temporarily unavailable.",
    };
    return messages[body.code ?? ""] ?? "The departure request failed.";
  } catch {
    return "The departure request failed.";
  }
}

async function callTool(id: JsonRpcRequest["id"], args: Record<string, unknown>, dispatch: (path: string) => Promise<Response>): Promise<McpReply> {
  if (typeof args.crs !== "string" || !args.crs) return toolError(id, "The crs argument is required.");

  const query = new URLSearchParams({ rows: String(args.rows ?? 2) });
  const response = await dispatch(`/v1/departures/${encodeURIComponent(args.crs)}?${query}`);
  if (!response.ok) return toolError(id, await failureText(response));

  const board = await response.json();
  return reply(id, {
    content: [{ type: "text", text: JSON.stringify(board) }],
    structuredContent: board,
    isError: false,
  });
}

export async function handleMcp(message: unknown, dispatch: (path: string) => Promise<Response>): Promise<McpReply> {
  if (!message || Array.isArray(message) || typeof message !== "object") {
    return error(null, -32600, "Invalid request.");
  }

  const request = message as JsonRpcRequest;
  if (!request.method) return error(request.id, -32600, "Method is required.");

  if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") {
    return { status: 202, body: null };
  }

  if (request.method === "ping") return reply(request.id, {});

  if (request.method === "initialize") {
    const requested = request.params?.protocolVersion;
    const protocolVersion = typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : PROTOCOL_VERSIONS[0];
    return reply(request.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "signalboarder", version: "1.0.0" },
    });
  }

  if (request.method === "tools/list") return reply(request.id, { tools: [tool] });

  if (request.method === "tools/call") {
    const params = request.params ?? {};
    if (params.name !== tool.name) return error(request.id, -32602, `Unknown tool: ${String(params.name ?? "")}`);
    const args = params.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) return toolError(request.id, "Tool arguments must be an object.");
    return callTool(request.id, args as Record<string, unknown>, dispatch);
  }

  return error(request.id, -32601, `Unknown method: ${request.method}`);
}
