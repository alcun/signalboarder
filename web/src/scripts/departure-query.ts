import { QueryClient } from "@tanstack/query-core";

export interface Service {
  scheduled: string;
  expected: string;
  destination: string;
  platform: string;
  disrupted: boolean;
  callingAt?: string[];
}

export interface BoardResponse {
  crs: string;
  station: string;
  generatedAt: string;
  stale: boolean;
  services: Service[];
  attribution: string;
}

export const FRESH_MS = 30_000;

export function createDepartureQueries(api: string, request: typeof fetch = fetch) {
  const client = new QueryClient({ defaultOptions: { queries: {
    staleTime: FRESH_MS, gcTime: 5 * 60_000, retry: false,
    // The board owns its visible-tab polling and exponential error backoff.
    networkMode: "always",
  } } });
  const key = (crs: string) => ["departures", api, crs.toUpperCase()] as const;
  return {
    client,
    cached(crs: string): BoardResponse | undefined {
      const state = client.getQueryState<BoardResponse>(key(crs));
      if (!state?.data) return;
      return { ...state.data, stale: state.data.stale || state.status === "error" || Date.now() - state.dataUpdatedAt >= FRESH_MS };
    },
    fetch(crs: string) {
      return client.fetchQuery<BoardResponse>({
        queryKey: key(crs),
        queryFn: async ({ signal }) => {
          const response = await request(`${api}/v1/departures/${encodeURIComponent(crs.toUpperCase())}?rows=10`, {
            headers: { accept: "application/json" }, signal,
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(typeof payload?.code === "string" ? payload.code : "unknown");
          return payload as BoardResponse;
        },
      });
    },
  };
}
