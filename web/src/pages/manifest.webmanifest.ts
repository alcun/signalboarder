import type { APIRoute } from "astro";

export const GET: APIRoute = () => new Response(JSON.stringify({
  name: "Signalboarder - live train departures",
  short_name: "Signalboarder",
  description: "Turn any device into a live UK train departure board.",
  start_url: "/",
  display: "standalone",
  background_color: "#000000",
  theme_color: "#000000",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}), { headers: { "content-type": "application/manifest+json; charset=utf-8" } });
