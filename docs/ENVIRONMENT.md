# Environment variables

Validated by Zod in `src/lib/config/env.ts` on first access. Invalid configuration fails at
startup with a list of problems, never at 3am with an undefined dereference.

Copy `.env.example` to `.env` — the defaults are a working local setup.

## Core

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `APP_NAME` | `Doctor Booking Platform` | Used in emails and metadata |
| `APP_URL` | `http://localhost:3000` | Absolute URLs in emails and payment returns |
| `PORT` | `3000` | |
| `DEMO_MODE` | `false` | `true` serves the marketplace from memory, no database needed |

## Infrastructure

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://dbp:dbp_local_password@localhost:5432/doctor_booking` | Required |
| `REDIS_URL` | `redis://localhost:6379` | Slot locks, rate limits, mock adapter state |
| `MEILISEARCH_HOST` | `http://localhost:7700` | Doctor search index |
| `MEILISEARCH_MASTER_KEY` | `dbp_local_master_key_change_me` | Required |
| `SEARCH_DRIVER` | `meilisearch` | `meilisearch` \| `postgres`. Falls back to Postgres automatically |

## Authentication

| Variable | Default | Notes |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | — | **Required, min 32 chars.** `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Must match `APP_URL` |
| `SESSION_MAX_AGE_SECONDS` | `604800` | 7 days |
| `SESSION_UPDATE_AGE_SECONDS` | `86400` | Rolling refresh interval |

## Booking

| Variable | Default | Notes |
| --- | --- | --- |
| `SLOT_HOLD_TTL_SECONDS` | `600` | Checkout reservation window |
| `BOOKING_DEFAULT_TIMEZONE` | `Asia/Karachi` | Fallback IANA zone |
| `BOOKING_MAX_ADVANCE_DAYS` | `90` | How far ahead patients may book |
| `BOOKING_MIN_LEAD_MINUTES` | `60` | Minimum notice |

## Rate limiting

| Variable | Default | Applies to |
| --- | --- | --- |
| `RATE_LIMIT_AUTH_MAX` | `10` | Auth endpoints, fail-**closed** |
| `RATE_LIMIT_AUTH_WINDOW_SECONDS` | `900` | |
| `RATE_LIMIT_API_MAX` | `120` | General API, fail-open |
| `RATE_LIMIT_API_WINDOW_SECONDS` | `60` | |

Auth and booking limits fail **closed**: if Redis is unreachable the request is refused. Better to
ask a patient to retry than to leave credential stuffing unbounded during an outage. Read-only
browsing fails **open**, so a cache blip does not take the marketplace down.

## Adapters

Each capability picks a driver. Defaults are all offline.

### Payments — `PAYMENT_DRIVER`

`mock` (default) | `stripe` | `jazzcash` | `easypaisa` | `paypal`

| Driver | Required when selected |
| --- | --- |
| `stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `jazzcash` | `JAZZCASH_MERCHANT_ID`, `JAZZCASH_PASSWORD`, `JAZZCASH_INTEGRITY_SALT` |
| `easypaisa` | `EASYPAISA_STORE_ID`, `EASYPAISA_ACCOUNT_NUMBER`, `EASYPAISA_HASH_KEY` |
| `paypal` | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` |

`PAYMENT_CURRENCY` defaults to `PKR`.

**`PAYMENT_DRIVER=mock` is refused when `NODE_ENV=production`** — a mock payment must never reach
a real customer. The check is skipped during `next build`, which sets `NODE_ENV=production` even
on a laptop; the rule governs serving, not compiling.

The mock driver's deterministic failure injection, for testing declines without a sandbox
account:

| Amount ends in (minor units) | Behaviour |
| --- | --- |
| `13` | Declined |
| `99` | Requires an extra confirmation step |
| anything else | Succeeds |

### Email — `EMAIL_DRIVER`

`mock` (default) | `smtp`

The mock driver writes browsable `.html` files to `storage/mailbox/`. Open one to see exactly
what a patient would receive. `smtp` requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`; `EMAIL_FROM` applies to both.

### SMS — `SMS_DRIVER`

`mock` (default) | `twilio`

The mock driver keeps a Redis inbox (last 200 messages) and enforces E.164 — a number that would
fail in production fails in development too. `twilio` requires `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.

### Video — `VIDEO_DRIVER`

`mock` (default) | `daily` | `zoom` | `meet`

The mock driver mints HMAC-signed tokens for an in-app room, so join/leave and expiry are
genuinely exercisable. Requires `DAILY_API_KEY`, the `ZOOM_*` triple, or the `GOOGLE_MEET_*` pair
respectively.

### Storage — `STORAGE_DRIVER`

`local` (default) | `s3`

> **Not implemented.** These variables are validated but no adapter exists yet, so document
> upload is non-functional. `STORAGE_LOCAL_PATH` (`./storage/uploads`) and
> `STORAGE_MAX_FILE_SIZE_BYTES` (10 MB) are reserved, as are the `S3_*` variables.

### AI — `AI_DRIVER`

`ollama` (default)

| Variable | Default |
| --- | --- |
| `OLLAMA_HOST` | `http://localhost:11434` |
| `OLLAMA_MODEL` | `llama3.2` |
| `OLLAMA_TIMEOUT_MS` | `30000` |

No credentials — Ollama is local. If it is unreachable, has no matching model pulled, or stalls
past the timeout, the assistant answers from the built-in rule engine instead. There is no
configuration to "enable" the fallback; it is the failure path.

## Logging

| Variable | Default | Notes |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `fatal` … `trace`. Pretty-printed in development, JSON in production |

## Production checklist

- [ ] `BETTER_AUTH_SECRET` is a fresh 32-byte random value, not the example
- [ ] `POSTGRES_PASSWORD` and `MEILISEARCH_MASTER_KEY` changed from defaults
- [ ] `APP_URL` and `BETTER_AUTH_URL` are the real HTTPS origin
- [ ] `PAYMENT_DRIVER` is a real provider (the app refuses to serve otherwise)
- [ ] `EMAIL_DRIVER=smtp` — otherwise verification mail goes to a local folder
- [ ] `LOG_LEVEL=info` or `warn`
- [ ] `.env` is not committed
