# Pinned to an exact Bun patch release, not the floating `1-slim` tag, so a
# rebuild for rollback produces the same runtime. Same as babel-edge.
FROM oven/bun:1.3.14-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER bun

ENV PORT=3000
EXPOSE 3000

# curl is not in the slim image, so probe with bun's own fetch. /healthz
# deliberately touches no provider: a health check that fails when National
# Rail is down would restart a container that is working correctly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
