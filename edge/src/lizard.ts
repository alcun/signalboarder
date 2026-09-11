// Fire-and-forget server-side event logging to LoggerLizard (the self-hosted
// analytics at api.loggerlizard.com). Ported from enso-api's src/lib/lizard.ts,
// which is the proven copy; keep the two in step if the contract moves.
//
// Analytics must NEVER add latency or a failure mode to a request, so this is:
//   - never awaited by callers
//   - never throws (wrapped in try/catch AND .catch)
//   - never retries; one attempt with a 3s timeout so sockets can't pile up
//   - a silent no-op when LIZARD_SECRET_KEY is unset (read at call time)
//
// The only constant committed here is the public API URL. The secret key comes
// from the environment. A SECRET key skips LoggerLizard's domain check, which
// is what makes it the right kind of key for a server.
//
// ctx: request-derived fields forwarded to LoggerLizard, honoured for our secret
// key only.
//   ip: the visitor's IP. On this box that is the LAST x-forwarded-for entry -
//       Traefik overwrites a client-supplied header rather than appending, so
//       first and last are the same trustworthy value today, and taking the last
//       stays correct if a proxy that genuinely appends is ever put in front.
//       LoggerLizard looks it up against a local MaxMind DB and NEVER stores it.
//   ua: the visitor's User-Agent. Without it LoggerLizard records this service's
//       runtime ('Bun/1.3.x') and misclassifies crawlers as human.
export function lizard(
  event: string,
  metadata?: Record<string, unknown>,
  duration_ms?: number,
  status?: string,
  ctx?: { ip?: string | null; ua?: string | null },
): void {
  try {
    const apiKey = process.env.LIZARD_SECRET_KEY;
    if (!apiKey) return; // not configured - silent no-op

    const body: Record<string, unknown> = { event };
    if (metadata !== undefined) body.metadata = metadata;
    // The API requires duration_ms to be a positive integer, so round and drop
    // anything <= 0 (a sub-millisecond cache hit) rather than have the whole
    // event rejected.
    if (typeof duration_ms === "number" && Number.isFinite(duration_ms) && duration_ms > 0) {
      body.duration_ms = Math.round(duration_ms);
    }
    if (status !== undefined) body.status = status;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    };
    if (ctx?.ip) headers["X-Client-IP"] = ctx.ip;
    if (ctx?.ua) headers["X-Client-User-Agent"] = ctx.ua;

    void fetch("https://api.loggerlizard.com/log", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {
    // Analytics can never break the caller.
  }
}
