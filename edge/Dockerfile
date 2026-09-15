# The API alone, without the web board. Same base as the root Dockerfile.
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS runtime
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# tini as PID 1 reaps orphaned child processes.
RUN apk add --no-cache tini
USER bun

ENV PORT=3000
EXPOSE 3000

# Probe with bun's own fetch rather than relying on curl or wget. /healthz
# deliberately touches no provider: a health check that fails when National
# Rail is down would restart a container that is working correctly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
