import type { APIRoute } from "astro";
import { PAGES } from "../lib/pages";

export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, "") ?? "";
  const indexable = import.meta.env.PUBLIC_INDEXABLE === "true";
  const body = indexable
    ? ["User-agent: *", "Allow: /", "", `Sitemap: ${base}/sitemap.xml`, "", `# ${PAGES.length} curated static pages.`, "# Live departures load in the browser; every route also contains server-rendered copy."].join("\n")
    : ["User-agent: *", "Disallow: /"].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
