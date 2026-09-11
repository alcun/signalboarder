import type { APIRoute } from "astro";
import { PAGES } from "../lib/pages";

export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, "") ?? "";
  const urls = PAGES.map((page) => {
    const loc = page.slug ? `${base}/${page.slug}` : base;
    return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>${page.slug ? "0.8" : "1.0"}</priority>\n  </url>`;
  }).join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, { headers: { "content-type": "application/xml; charset=utf-8" } });
};
