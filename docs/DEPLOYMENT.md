# Deployment

## Local development

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run setup` chains all of it.

### Services

| Service | Port | Purpose |
| --- | --- | --- |
| Postgres 16 | 5432 | Primary datastore |
| Redis 7 | 6379 | Slot locks, rate limits, mock adapter state |
| Meilisearch 1.11 | 7700 | Doctor search index (typo tolerance, facets) |
| Ollama | 11434 | Local model for the assistant |

All four declare health checks, so `docker compose up -d --wait` blocks until they are actually
ready rather than merely started.

### Pulling a model for the assistant

```bash
docker compose exec ollama ollama pull llama3.2
```

Optional. Without it the assistant runs on the rule engine and says so in the UI.

### Docker permissions

If `docker compose` reports `permission denied … /var/run/docker.sock`, your user is not in the
`docker` group:

```bash
sudo usermod -aG docker $USER
newgrp docker          # or log out and back in
```

## Verifying a deployment

Run these in order; each proves something the previous did not.

```bash
npm run typecheck                     # 0 errors
npm test                              # 82 passing
npm run build                         # 16 routes
docker compose ps                     # all healthy
npm run db:migrate:deploy && npm run db:seed
```

Then check by hand:

| Check | Expected |
| --- | --- |
| `GET /` | 200, doctors listed |
| `GET /doctors?city=Karachi` | 200, filtered, facet counts match |
| `GET /appointments` while signed out | 307 → `/sign-in?next=%2Fappointments` |
| `GET /api/ai/chat` | `{"ready":true}` |
| Sign in as `hina.rauf@medibook.test` | Lands on the patient area |
| Book a slot, then replay the confirm | Second attempt returns `SLOT_UNAVAILABLE` |

That last one is the check worth doing manually — it is the double-booking guarantee.

## Production

### Build

```bash
npm ci
npx prisma generate
npm run build
npm run db:migrate:deploy
npm start
```

`prisma generate` must run before `build`; the generated client is not committed.

### Before going live

1. **Secrets.** Fresh `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), real database password,
   real Meilisearch key. Inject them from your platform's secret store — never a committed file.
2. **Payments.** Set a real `PAYMENT_DRIVER`. The app refuses to start with `mock` when
   `NODE_ENV=production`; that guard is deliberate, do not remove it.
3. **Email.** `EMAIL_DRIVER=smtp`, or verification and reset mail silently lands in a local
   folder.
4. **TLS.** Terminate HTTPS upstream. Cookies are issued `Secure` automatically when
   `NODE_ENV=production`.
5. **Proxy headers.** Rate limiting reads `x-forwarded-for`. Your proxy must *overwrite* it, not
   append — otherwise a client can spoof its identity and bypass limits.

### Reverse proxy

The assistant streams SSE, which proxy buffering will break. The route sets
`X-Accel-Buffering: no`, but nginx also needs:

```nginx
location /api/ai/ {
    proxy_pass http://app:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

### Background jobs

Two reconciliation sweeps should run on a schedule. Neither is wired to a scheduler — pick your
own (cron, systemd timer, platform scheduler):

```bash
*/5 * * * *  cd /app && npm run slots:sweep
```

`sweepExpiredHolds` returns slots stuck in `HELD` after a Redis flush; `expireUnpaidAppointments`
releases slots behind abandoned checkouts. Both are idempotent and safe to run concurrently.

### Scaling notes

- The app is stateless — scale horizontally behind a load balancer.
- **Redis must be shared** across instances. Per-instance Redis would make slot locks and rate
  limits meaningless, since two nodes would not see each other's holds. Correctness would still
  hold (the database guarantees that), but two patients could reach payment for one slot.
- Postgres is the bottleneck under load. `connection_limit` in `DATABASE_URL` should be tuned to
  `instances × pool ≤ max_connections`.
- Ollama is CPU-bound. Give it its own host, or accept the fallback under load.

### Backups

```bash
docker compose exec postgres pg_dump -U dbp doctor_booking | gzip > backup-$(date +%F).sql.gz
```

Redis holds only ephemeral state (locks, counters, mock inboxes) — losing it costs live checkout
sessions, nothing durable. The sweeps reconcile the rest.

## Health checks

There is **no `/api/health` endpoint yet.** Point your orchestrator at `GET /` until one exists,
or add a handler that pings Postgres and Redis. Each adapter already implements a `health()`
method that such an endpoint should aggregate.

## Known deployment caveats

- **Edge runtime warning.** `better-auth/cookies` pulls in `jose`, which references
  `CompressionStream` — unsupported in the Edge runtime. Build emits a warning; middleware works
  in Node. Verify under a real Edge deployment before relying on it, or pin middleware to the
  Node runtime.
- **Meilisearch needs an initial index.** Run `npm run search:reindex` after seeding, and on a
  schedule if doctors are imported in bulk. Until then search silently uses Postgres.
- **No Dockerfile for the app itself.** Compose provisions dependencies only; the app runs on the
  host. Containerising it is a small addition, not yet made.
