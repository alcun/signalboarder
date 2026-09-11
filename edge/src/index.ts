import { createApp } from "./app";
import { createFixtureProvider, createLdbwsProvider, type Provider } from "./providers";
import { resolve, sep } from "node:path";

/**
 * Server entry for the Signalboarder edge.
 *
 * Same shape as babel-edge: explicit Bun.serve so the server handle is
 * available for graceful shutdown, and every configuration value read once,
 * here, with a loud failure at boot rather than a broken endpoint later.
 */

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`FATAL: ${name} must be a positive integer. Refusing to boot.`);
    process.exit(1);
  }
  return parsed;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    // The name is safe to print. The value never is.
    console.error(`FATAL: ${name} is required. Refusing to boot.`);
    process.exit(1);
  }
  return value;
}

const port = positiveInt("PORT", 3000);
const providerName = process.env.SIGNALBOARDER_PROVIDER ?? "ldbws";
const ttlMs = positiveInt("SIGNALBOARDER_TTL_MS", 20_000);
const staleMs = positiveInt("SIGNALBOARDER_STALE_MS", 10 * 60 * 1000);
const dailyBudget = positiveInt("SIGNALBOARDER_DAILY_BUDGET", 20_000);
const rateLimit = positiveInt("SIGNALBOARDER_RATE_LIMIT", 600);
const rateWindowMs = positiveInt("SIGNALBOARDER_RATE_WINDOW_MS", 60 * 60 * 1000);
const providerTimeoutMs = positiveInt("SIGNALBOARDER_PROVIDER_TIMEOUT_MS", 8_000);
const allowedOrigins = (process.env.SIGNALBOARDER_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const trustProxy = process.env.SIGNALBOARDER_TRUST_PROXY === "true";

let provider: Provider;
if (providerName === "fixture") {
  // Development only. Announced loudly so a container serving invented
  // departures can never be mistaken for a live one.
  console.warn(JSON.stringify({ event: "fixture_provider", detail: "serving fixture data, not live departures" }));
  provider = createFixtureProvider();
} else if (providerName === "ldbws") {
  provider = createLdbwsProvider({
    baseUrl: required("SIGNALBOARDER_LDBWS_URL"),
    apiKey: required("SIGNALBOARDER_LDBWS_KEY"),
    timeoutMs: providerTimeoutMs,
  });
} else {
  console.error(`FATAL: SIGNALBOARDER_PROVIDER must be "ldbws" or "fixture". Refusing to boot.`);
  process.exit(1);
}

const app = createApp({
  provider,
  ttlMs,
  staleMs,
  dailyBudget,
  rateLimit,
  rateWindowMs,
  allowedOrigins,
  trustProxy,
});

const webRoot = process.env.SIGNALBOARDER_WEB_ROOT;
const resolvedWebRoot = webRoot ? resolve(webRoot) : null;

async function fetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!resolvedWebRoot || url.pathname === "/healthz" || url.pathname.startsWith("/v1/")) {
    return app.fetch(request);
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const candidates = [resolve(resolvedWebRoot, requested), resolve(resolvedWebRoot, requested, "index.html")];
  for (const candidate of candidates) {
    if (candidate !== resolvedWebRoot && !candidate.startsWith(resolvedWebRoot + sep)) continue;
    const file = Bun.file(candidate);
    if (await file.exists()) return new Response(file, { headers: { "cache-control": "public, max-age=300" } });
  }
  return new Response("Not found", { status: 404 });
}

const server = Bun.serve({
  port,
  fetch,
  // Nothing here accepts a body. A request that sends one is already wrong.
  maxRequestBodySize: 4096,
});

// Never logs the key, the provider URL or the runtime version.
console.log(
  JSON.stringify({
    event: "listening",
    port: server.port,
    provider: provider.name,
    ttl_ms: ttlMs,
    stale_ms: staleMs,
    daily_budget: dailyBudget,
    rate_limit: rateLimit,
    rate_window_ms: rateWindowMs,
    origins: allowedOrigins.length === 0 ? "any" : allowedOrigins.length,
    trust_proxy: trustProxy,
    web: resolvedWebRoot ? "same_origin" : "off",
  }),
);

let shuttingDown = false;
for (const signalboarder of ["SIGTERM", "SIGINT"] as const) {
  process.on(signalboarder, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: "shutdown", signalboarder }));
    server.stop(false);
    const timer = setTimeout(() => process.exit(0), 10_000);
    if (typeof timer.unref === "function") timer.unref();
  });
}
