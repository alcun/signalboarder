/**
 * Per-station cache, single-flight and the upstream budget.
 *
 * All three exist for one reason: this service holds ONE National Rail key on
 * behalf of everybody. A hundred people watching Lime Street must cost three
 * upstream calls a minute, not three hundred.
 */

import type { Board } from "./departures";
import type { DepartureWindow, Provider, ProviderResult } from "./providers";

export interface CacheOptions {
  provider: Provider;
  /** How long a board is served without asking upstream again. */
  ttlMs: number;
  /** How long a cached board may still be served after upstream fails. */
  staleMs: number;
  /** Upstream calls allowed per day, kept below the subscription's own cap. */
  dailyBudget: number;
  now?: () => number;
}

export type BoardResult =
  // `fetched` says whether this answer cost a real call to the provider. The
  // board polls every 30 to 60 seconds and almost every poll is a cache hit, so
  // it is the difference between logging what we asked National Rail and
  // logging the polling itself.
  | { kind: "ok"; board: Board; stale: boolean; fetched: boolean }
  | { kind: "unknown_crs" }
  | { kind: "unavailable"; reason: string }
  | { kind: "budget_spent" };

interface Entry {
  board: Board;
  freshUntil: number;
  staleUntil: number;
}

export function createBoardCache(options: CacheOptions) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  // Requests for the same station that arrive while one is in flight wait on
  // it instead of starting their own. Without this, a cache expiry under load
  // sends a burst of identical calls upstream.
  const inFlight = new Map<string, Promise<ProviderResult>>();

  let spent = 0;
  let budgetResetsAt = 0;

  function key(crs: string, rows: number, query?: DepartureWindow): string {
    // The provider's ordinary board is deliberately the legacy key, so REST
    // and default MCP requests share it.  A future window is a distinct board.
    if (!query || (query.offset === 0 && query.window === 120)) return `${crs.toUpperCase()}:${rows}`;
    return `${crs.toUpperCase()}:${rows}:${query.offset}:${query.window}`;
  }

  function takeBudget(): boolean {
    const t = now();
    if (t >= budgetResetsAt) {
      spent = 0;
      budgetResetsAt = t + 24 * 60 * 60 * 1000;
    }
    if (spent >= options.dailyBudget) return false;
    spent += 1;
    return true;
  }

  async function callProvider(crs: string, rows: number, query?: DepartureWindow): Promise<ProviderResult> {
    const id = key(crs, rows, query);
    const existing = inFlight.get(id);
    if (existing) return existing;

    const attempt = options.provider.fetchBoard(crs, rows, query).finally(() => inFlight.delete(id));
    inFlight.set(id, attempt);
    return attempt;
  }

  return {
    stats() {
      return { entries: entries.size, spent, budget: options.dailyBudget };
    },

    async get(crs: string, rows: number, query?: DepartureWindow): Promise<BoardResult> {
      const id = key(crs, rows, query);
      const t = now();
      const cached = entries.get(id);

      if (cached && t < cached.freshUntil) {
        return { kind: "ok", board: cached.board, stale: false, fetched: false };
      }

      // Serving a slightly old board beats reporting a failure, so the budget
      // check happens here, after the fresh hit and before spending anything.
      // Requests joining an existing fetch do not spend another budget slot.
      if (!inFlight.has(id) && !takeBudget()) {
        if (cached && t < cached.staleUntil)
          return { kind: "ok", board: cached.board, stale: true, fetched: false };
        return { kind: "budget_spent" };
      }

      const result = await callProvider(crs, rows, query);

      if (result.kind === "ok") {
        entries.set(id, {
          board: result.board,
          freshUntil: now() + options.ttlMs,
          staleUntil: now() + options.staleMs,
        });
        return { kind: "ok", board: result.board, stale: false, fetched: true };
      }

      // An unknown station is a fact, not an outage: never paper over it with a
      // stale board, or a mistyped code would keep showing the last station.
      if (result.kind === "unknown_crs") {
        entries.delete(id);
        return result;
      }

      if (cached && t < cached.staleUntil) {
        return { kind: "ok", board: cached.board, stale: true, fetched: true };
      }
      return result;
    },

    /** Drop expired entries so the map cannot grow one key per station forever. */
    sweep() {
      const t = now();
      for (const [id, entry] of entries) {
        if (t > entry.staleUntil) entries.delete(id);
      }
    },
  };
}
