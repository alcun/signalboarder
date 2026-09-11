// @ts-check
import { defineConfig } from "astro/config";

// Production URL for canonical and OG tags. Override with PUBLIC_SITE_URL.
const site = process.env.PUBLIC_SITE_URL || "http://localhost:3000";

export default defineConfig({
  site,
  output: "static",
  // One small stylesheet and no images. Inlining it removes the only
  // render-blocking request before first paint.
  build: { inlineStylesheets: "always" },
  // `astro preview` serves through Vite, which blocks unknown Host headers.
  // Allow any host so it works behind a platform-generated hostname and a
  // custom domain alike.
  vite: {
    preview: { allowedHosts: true },
  },
});
