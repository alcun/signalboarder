# One Signalboarder image: build the static board, then serve it and /v1 from
# the same Bun process. The National Rail key never enters the browser build.
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
ARG PUBLIC_SITE_URL=http://localhost:3000
ARG PUBLIC_INDEXABLE=false
ARG PUBLIC_SIGNALBOARDER_API=
ARG PUBLIC_LIZARD_KEY=
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
ENV PUBLIC_INDEXABLE=$PUBLIC_INDEXABLE
ENV PUBLIC_SIGNALBOARDER_API=$PUBLIC_SIGNALBOARDER_API
ENV PUBLIC_LIZARD_KEY=$PUBLIC_LIZARD_KEY
RUN npm run build

FROM oven/bun:1-alpine AS deps
WORKDIR /app/edge
COPY edge/package.json edge/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/edge/node_modules ./edge/node_modules
COPY edge/package.json ./edge/
COPY edge/src ./edge/src
COPY --from=web /app/web/dist ./web
ENV PORT=3000
ENV SIGNALBOARDER_WEB_ROOT=/app/web
EXPOSE 3000
# tini as PID 1 reaps orphaned child processes.
RUN apk add --no-cache tini
USER bun
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "run", "edge/src/index.ts"]
