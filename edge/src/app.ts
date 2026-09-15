import { Hono } from "hono";

import { createBoardCache, type BoardResult } from "./cache";
import { lizard } from "./lizard";
import { handleMcp } from "./mcp";
import type { Provider } from "./providers";

/**
 * The Signalboarder departure API.
 *
 * Public, unauthenticated and read-only. It serves public timetable data, so
 * there is no device token and no private hop. The only secret involved is the
 * operator's: the National Rail consumer key, which lives in
 * the provider and never leaves this process.
 *
 * The response body is Signalboarder's own departure model. See src/departures.ts.
 */

export type ErrorCode =
  | "bad_crs"
  | "unknown_crs"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_budget"
  | "not_found"
  | "internal";

export interface LogLine {
  event: string;
  request_id: string;
  [key: string]: unknown;
}

export interface EdgeConfig {
  provider: Provider;
  /** Seconds a board is served before asking upstream again. */
  ttlMs?: number;
  /** How long a cached board may still be served after upstream fails. */
  staleMs?: number;
  /** Upstream calls per day, kept below the subscription's own cap. */
  dailyBudget?: number;
  /** Requests per client address per window. */
  rateLimit?: number;
  rateWindowMs?: number;
  /** Origins allowed to read this API. Empty means any origin. */
  allowedOrigins?: string[];
  /** Trust X-Forwarded-For only when an operator controls the reverse proxy. */
  trustProxy?: boolean;
  maxRows?: number;
  now?: () => number;
  log?: (line: LogLine) => void;
}

const DEFAULTS = {
  ttlMs: 20_000,
  staleMs: 10 * 60 * 1000,
  dailyBudget: 20_000,
  // Deliberately NOT the fleet's usual 50/hr. One Signalboarder polls every 60
  // seconds, so a single board is already 60 requests an hour and a house with
  // a board and two open tabs is several hundred. This is an abuse ceiling,
  // not a usage quota; the per-station cache is what protects the key.
  rateLimit: 600,
  rateWindowMs: 60 * 60 * 1000,
  maxRows: 10,
} as const;

const CRS_PATTERN = /^[A-Za-z]{3}$/;

/**
 * Client address for rate limiting.
 *
 * Fleet convention, measured 2026-07-22: Traefik OVERWRITES a client-supplied
 * X-Forwarded-For rather than appending, so there is one trustworthy entry.
 * Take the LAST, which is correct today and stays correct if a proxy that
 * genuinely appends is ever put in front. ONE derivation per app, used for both
 * logging and limiting.
 */
function clientAddress(header: string | undefined, trustProxy: boolean): string {
  if (!trustProxy) return "direct";
  const entries = header?.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries && entries.length > 0) return entries[entries.length - 1]!;
  return "internal";
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createApp(config: EdgeConfig) {
  const ttlMs = config.ttlMs ?? DEFAULTS.ttlMs;
  const staleMs = config.staleMs ?? DEFAULTS.staleMs;
  const dailyBudget = config.dailyBudget ?? DEFAULTS.dailyBudget;
  const rateLimit = config.rateLimit ?? DEFAULTS.rateLimit;
  const rateWindowMs = config.rateWindowMs ?? DEFAULTS.rateWindowMs;
  const maxRows = config.maxRows ?? DEFAULTS.maxRows;
  const allowedOrigins = config.allowedOrigins ?? [];
  const trustProxy = config.trustProxy ?? false;
  const now = config.now ?? Date.now;
  const log = config.log ?? ((line: LogLine) => console.log(JSON.stringify(line)));

  const cache = createBoardCache({ provider: config.provider, ttlMs, staleMs, dailyBudget, now });

  const buckets = new Map<string, Bucket>();
  const sweep = setInterval(() => {
    const t = now();
    for (const [address, bucket] of buckets) {
      if (t > bucket.resetAt) buckets.delete(address);
    }
    cache.sweep();
  }, rateWindowMs);
  if (typeof sweep.unref === "function") sweep.unref();

  function takeToken(address: string): { allowed: boolean; retryAfterSeconds: number } {
    const t = now();
    const bucket = buckets.get(address);
    if (!bucket || t > bucket.resetAt) {
      buckets.set(address, { count: 1, resetAt: t + rateWindowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.count >= rateLimit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const app = new Hono<{ Variables: { requestId: string; clientAddress: string } }>();

  function send(c: any, status: number, payload: unknown, headers: Record<string, string> = {}) {
    return c.body(JSON.stringify(payload), status, { "content-type": "application/json", ...headers });
  }

  function fail(c: any, status: number, code: ErrorCode, headers: Record<string, string> = {}) {
    return send(c, status, { ok: false, code }, { "cache-control": "no-store", ...headers });
  }

  // Request id, CORS and structured logging for every route.
  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    const address = clientAddress(c.req.header("x-forwarded-for"), trustProxy);
    const startedAt = now();
    c.set("requestId", requestId);
    c.set("clientAddress", address);
    c.header("x-request-id", requestId);

    // Public read-only data, so any origin may read it and credentials are
    // never involved. An explicit allow-list narrows it if that ever changes.
    const origin = c.req.header("origin");
    if (allowedOrigins.length === 0) {
      c.header("access-control-allow-origin", "*");
    } else if (origin && allowedOrigins.includes(origin)) {
      c.header("access-control-allow-origin", origin);
      c.header("vary", "origin");
    }

    if (c.req.method === "OPTIONS") {
      c.header("access-control-allow-methods", "GET, POST, OPTIONS");
      c.header("access-control-max-age", "86400");
      return c.body(null, 204);
    }

    await next();

    log({
      event: "request",
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: now() - startedAt,
      ip: address,
    });
  });

  /**
   * Unauthenticated liveness probe for the container healthcheck. Touches no
   * provider and reveals nothing. Same reasoning as babel-edge: a health check
   * that fails when a third party is down gets the container restarted, which
   * fixes nothing.
   */
  app.get("/healthz", (c) => send(c, 200, { ok: true }, { "cache-control": "no-store" }));

  app.use("*", async (c, next) => {
    if (c.req.path === "/healthz") return next();
    const address = c.get("clientAddress");
    const { allowed, retryAfterSeconds } = takeToken(address);
    if (!allowed) {
      log({ event: "rejected", request_id: c.get("requestId"), reason: "rate_limited", ip: address });
      lizard("rate_limited", { path: c.req.path }, undefined, "rate_limited", {
        ip: address,
        ua: c.req.header("user-agent"),
      });
      return fail(c, 429, "rate_limited", { "retry-after": String(retryAfterSeconds) });
    }
    return next();
  });

  app.get("/v1/departures/:crs", async (c) => {
    const requestId = c.get("requestId");
    const crs = c.req.param("crs");

    // Server-side analytics for this route only, and deliberately NOT on every
    // request. A board polls every 30 to 60 seconds and so does the ESP32, so
    // logging each 200 would bury the story in its own polling. What is logged
    // is what the poll actually COST or what went wrong: a real call out to
    // National Rail, and every failure. "How many people opened a board" is the
    // browser SDK's question, and the web half answers it in the same project.
    const startedAt = now();
    const who = { ip: c.get("clientAddress"), ua: c.req.header("user-agent") };
    const note = (event: string, metadata: Record<string, unknown>, status: string) =>
      lizard(event, metadata, now() - startedAt, status, who);

    if (!CRS_PATTERN.test(crs)) {
      note("departures_rejected", { crs: crs.slice(0, 8) }, "bad_crs");
      return fail(c, 400, "bad_crs");
    }

    const requested = Number.parseInt(c.req.query("rows") ?? "2", 10);
    const rows = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), maxRows) : 2;

    let result: BoardResult;
    try {
      result = await cache.get(crs, rows);
    } catch (error) {
      log({
        event: "provider_error",
        request_id: requestId,
        crs: crs.toUpperCase(),
        reason: error instanceof Error ? error.name : "unknown",
      });
      note(
        "departures_failed",
        { crs: crs.toUpperCase(), reason: error instanceof Error ? error.name : "unknown" },
        "provider_unavailable",
      );
      return fail(c, 502, "provider_unavailable");
    }

    if (result.kind === "unknown_crs") {
      // A fact about the station, not a fault. Clients render NO STATION FOUND
      // from this code and keep their editing actions visible. Worth logging:
      // a code people keep mistyping is a thing to know about.
      note("departures_unknown_crs", { crs: crs.toUpperCase() }, "unknown_crs");
      return fail(c, 404, "unknown_crs");
    }

    if (result.kind === "budget_spent") {
      log({ event: "budget_spent", request_id: requestId, crs: crs.toUpperCase() });
      note("departures_budget_spent", { crs: crs.toUpperCase() }, "provider_budget");
      return fail(c, 503, "provider_budget", { "retry-after": "300" });
    }

    if (result.kind === "unavailable") {
      log({ event: "provider_unavailable", request_id: requestId, crs: crs.toUpperCase(), reason: result.reason });
      note("departures_failed", { crs: crs.toUpperCase(), reason: result.reason }, "provider_unavailable");
      return fail(c, 502, "provider_unavailable");
    }

    // Only a real call out to the provider, never a cache hit. See `note` above.
    if (result.fetched) {
      note(
        "departures",
        {
          crs: result.board.crs,
          station: result.board.station,
          rows,
          stale: result.stale,
        },
        result.stale ? "stale" : "ok",
      );
    }

    return send(
      c,
      200,
      {
        crs: result.board.crs,
        station: result.board.station,
        generatedAt: new Date(now()).toISOString(),
        stale: result.stale,
        services: result.board.services,
        attribution: "Powered by National Rail Enquiries",
      },
      // Short shared cache window. The board polls every 30 to 60 seconds, so
      // this only ever collapses an accidental double fetch.
      { "cache-control": "public, max-age=10" },
    );
  });

  app.post("/mcp", async (c) => {
    let message: unknown;
    try {
      message = await c.req.json();
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: body must be JSON." } }, 200);
    }

    const origin = new URL(c.req.url).origin;
    const { status, body } = await handleMcp(message, async (path) =>
      app.fetch(new Request(`${origin}${path}`, { headers: { accept: "application/json" } })),
    );
    if (body === null) return c.body(null, status as 202);
    return c.json(body as object, status as 200);
  });

  app.get("/mcp", (c) =>
    c.json({
      error: "This MCP endpoint is stateless and accepts JSON-RPC over POST.",
      hint: "POST an initialize request, then use tools/list and tools/call.",
    }, 405, { Allow: "POST, OPTIONS" }),
  );

  app.notFound((c) => fail(c, 404, "not_found"));

  app.onError((error, c) => {
    log({
      event: "unhandled",
      request_id: c.get("requestId") ?? "none",
      reason: error instanceof Error ? error.name : "unknown",
    });
    return fail(c, 500, "internal");
  });

  return app;
}
