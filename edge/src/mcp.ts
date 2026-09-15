/**
 * Minimal stateless Streamable HTTP MCP handler for the public departure API.
 *
 * The tool deliberately uses the existing departure handler. That keeps
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

async function callTool(id: JsonRpcRequest["id"], args: Record<string, unknown>, dispatch: (crs: string, rows: number) => Promise<Response>): Promise<McpReply> {
  if (typeof args.crs !== "string" || !args.crs) return toolError(id, "The crs argument is required.");
  if (!/^[a-z]{3}$/i.test(args.crs)) return toolError(id, "The CRS code must be three letters.");
  if (args.rows !== undefined && (typeof args.rows !== "number" || !Number.isInteger(args.rows) || args.rows < 1 || args.rows > 10)) {
    return toolError(id, "The rows argument must be an integer from 1 to 10.");
  }
  if (Object.keys(args).some((key) => key !== "crs" && key !== "rows")) return toolError(id, "Only crs and rows arguments are supported.");

  const response = await dispatch(args.crs, (args.rows as number | undefined) ?? 2);
  if (!response.ok) return toolError(id, await failureText(response));

  const board = await response.json();
  return reply(id, {
    content: [{ type: "text", text: JSON.stringify(board) }],
    structuredContent: board,
    isError: false,
  });
}

export async function handleMcp(message: unknown, dispatch: (crs: string, rows: number) => Promise<Response>): Promise<McpReply> {
  if (!message || Array.isArray(message) || typeof message !== "object") {
    return error(null, -32600, "Invalid request.");
  }

  const request = message as JsonRpcRequest;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || !request.method ||
      (request.id !== undefined && typeof request.id !== "string" && typeof request.id !== "number") ||
      (request.params !== undefined && (!request.params || typeof request.params !== "object" || Array.isArray(request.params)))) {
    return error(null, -32600, "Invalid request.");
  }

  if (request.id === undefined) {
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
