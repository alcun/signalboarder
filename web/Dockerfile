# Multi-stage: build the static site, then serve it with Astro's preview server.
# Any container platform can run the result; nothing here is host-specific.
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS install
COPY package*.json ./
RUN npm install --no-audit --no-fund

FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY . .
# Public production URL for canonical and OG tags. Override at build time.
ARG PUBLIC_SITE_URL=http://localhost:4321
ARG PUBLIC_INDEXABLE=false
# Empty means same-origin; a reusable image never opts into another service.
ARG PUBLIC_SIGNALBOARDER_API=
# Analytics tag. Empty ships no analytics at all, which is the right default for
# anyone who is not us.
ARG PUBLIC_LIZARD_KEY=
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
ENV PUBLIC_INDEXABLE=$PUBLIC_INDEXABLE
ENV PUBLIC_SIGNALBOARDER_API=$PUBLIC_SIGNALBOARDER_API
ENV PUBLIC_LIZARD_KEY=$PUBLIC_LIZARD_KEY
RUN npm run build

FROM base AS release
COPY --from=install /app/node_modules node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/astro.config.mjs ./astro.config.mjs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 4321/tcp

CMD ["npx", "astro", "preview", "--host", "0.0.0.0", "--port", "4321"]
