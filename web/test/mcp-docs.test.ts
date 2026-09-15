import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

test("MCP client snippets use each client's configuration shape", async () => {
  const docs = await read("../../edge/README.md");
  const configs = [...docs.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]!));
  const url = "https://signalboarder.alcun.dev/mcp";
  expect(configs.find((config) => config.mcpServers)?.mcpServers.signalboarder).toEqual({ url });
  expect(configs.find((config) => config.servers)?.servers.signalboarder).toEqual({ type: "http", url });
  expect(docs).toContain(`claude mcp add --transport http signalboarder ${url}`);
  expect(docs).toContain("### Claude Desktop / claude.ai");
  expect(docs).toContain("cannot reach your `localhost`");
  expect(docs).toContain("UI setup has not been tested hands-on");
});

test("MCP section stays below FAQ and links setup and agent reference", async () => {
  const layout = await read("../src/layouts/Base.astro");
  expect(layout.indexOf('id="mcp"')).toBeGreaterThan(layout.indexOf("Common questions"));
  const section = layout.slice(layout.indexOf('id="mcp"'), layout.indexOf('</section>', layout.indexOf('id="mcp"')));
  expect(section).toContain('href="/llms.txt"');
  expect(section).toContain('edge/README.md#mcp-setup');
  expect(section).toContain("Claude, Cursor and VS Code setup");
  const selfhosting = await read("../../SELFHOSTING.md");
  expect(selfhosting).toContain("exist only for `NBN`, `GNW` and `ZZZ`");
});
