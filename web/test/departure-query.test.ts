import { expect, test } from "bun:test";
import { createDepartureQueries } from "../src/scripts/departure-query";

test("shares one ten-row fetch across callers and serves a fresh station from cache", async () => {
  let calls = 0;
  const queries = createDepartureQueries("http://fixture", (async (url: string) => {
    calls++;
    expect(url).toBe("http://fixture/v1/departures/NBN?rows=10");
    return Response.json({ crs: "NBN", stale: false, services: [] });
  }) as typeof fetch);
  await Promise.all([queries.fetch("nbn"), queries.fetch("NBN")]);
  await queries.fetch("NBN");
  expect(calls).toBe(1);
  expect(queries.cached("NBN")?.stale).toBe(false);
  queries.client.clear();
});

test("isolates stations and labels expired cached data as stale", () => {
  const queries = createDepartureQueries("http://fixture");
  queries.client.setQueryData(["departures", "http://fixture", "NBN"], { crs: "NBN", stale: false, services: [] }, { updatedAt: Date.now() - 31_000 });
  expect(queries.cached("NBN")?.stale).toBe(true);
  expect(queries.cached("GNW")).toBeUndefined();
  queries.client.clear();
});
