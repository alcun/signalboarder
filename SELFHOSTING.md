# Running your own Signalboarder

One container, no database. It serves the board and the `/v1` API from one
address.

Install and start Docker first. On macOS, an existing Bun plus Node/npm setup is
also supported.

## 1. Start it

```sh
git clone https://github.com/alcun/signalboarder
cd signalboarder
./setup
```

`./setup` asks where departures come from:

| Choose | You need | Notes |
|---|---|---|
| **Your own key** | A [Rail Data Marketplace](https://raildata.org.uk) account | Recommended. The key stays in your container |
| **Hosted service** | Nothing | Reads from `signalboarder.alcun.dev` and uses its budget |
| **Fixtures** | Nothing | No key; works offline after installation |

Open <http://localhost:3000>. Demo stations are `NBN` and `GNW`. The API also accepts `ZZZ` for an empty
board; this synthetic station is not in the browser picker.

Run `./setup` again to change the configuration. It writes `.env` at mode 0600 and
starts the image.

## 2. Get your own key

1. Register at [Rail Data Marketplace](https://raildata.org.uk).
2. Subscribe to the **Live Departure Board** product. This is separate from registration.
3. Copy the endpoint and the consumer key from the application.
4. Run `./setup` and paste them.

Only the Bun server reads the key. It never reaches a browser.

**Check your licence terms before making a board public.** The daily budget
below is a safety ceiling, not a statement of what your licence permits.

## 3. Configure HTTPS

The container speaks plain HTTP. Put Caddy, nginx, Traefik or a tunnel in front
of it.

Then set three variables:

| Variable | Set to |
|---|---|
| `PUBLIC_SITE_URL` | Your address |
| `PUBLIC_SIGNALBOARDER_API` | Normally the same address |
| `SIGNALBOARDER_ALLOWED_ORIGINS` | Your address |

**Both `PUBLIC_` values are baked into the static board at build time.**
Changing either needs a rebuild, not a restart:

```sh
docker compose up -d --build
```

Check the API origin in the built page:

```sh
curl -s localhost:3000 | grep -o 'configuredApi = "[^"]*"'
```

An empty string means the board falls back to its own origin. Anything else is
the configured API origin.

## Limits

| Variable | Default | What it does |
|---|---:|---|
| `SIGNALBOARDER_TTL_MS` | 20000 | How long a station is served from cache |
| `SIGNALBOARDER_STALE_MS` | 600000 | Stale window when the provider fails |
| `SIGNALBOARDER_DAILY_BUDGET` | 20000 | Daily ceiling on National Rail calls |
| `SIGNALBOARDER_RATE_LIMIT` | 600 | Requests per address per window |
| `SIGNALBOARDER_RATE_WINDOW_MS` | 3600000 | Rate-limit window |
| `SIGNALBOARDER_TRUST_PROXY` | false | Trust `X-Forwarded-For`; enable only behind a proxy you control |

Direct clients can forge forwarding headers. Leave trusted-proxy mode off when
port 3000 is public; enable it only when your proxy overwrites incoming
`X-Forwarded-For`.

Set the daily budget from your subscription allowance. The default is not a
verified provider quota. Counters are per process and reset on restart;
multiple replicas do not share a budget. Use provider-side limits where
available. With trusted-proxy mode off, all clients share one rate-limit bucket.

## Health checks

```sh
docker compose ps
docker compose logs -f signalboarder
curl -s localhost:3000/healthz
curl -s localhost:3000/v1/departures/NBN
```

No database, no volume, no server-side user state. A chosen station lives in
that browser's local storage.

## The physical board

Separate repository:
[`alcun/signalboarder-device`](https://github.com/alcun/signalboarder-device).
Flash it, and enter your server's address when it asks.
