import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// With a web root, index.ts hands only listed paths to the API and serves the
// rest as static files. A route missing from that list 404s in the container
// while every app test still passes, which is how /health first shipped.
test("every API route outside /v1/ is routed to the API by index.ts", () => {
  const src = join(import.meta.dir, "..", "src");
  const app = readFileSync(join(src, "app.ts"), "utf8");
  const index = readFileSync(join(src, "index.ts"), "utf8");
  const routes = [...app.matchAll(/app\.(?:get|post|put|delete|all)\("([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((path) => !path.startsWith("/v1/"));
  const list = index.match(/const APP_PATHS = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  const listed = new Set([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]!));
  expect(routes.length).toBeGreaterThan(0);
  expect(routes.filter((path) => !listed.has(path))).toEqual([]);
});
