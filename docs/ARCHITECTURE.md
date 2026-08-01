# Architecture

## Layering

Dependencies point inward. A layer may import from the layers below it, never above.

```
  app/            routes, layouts, metadata          ← thin, no business logic
    ↓
  features/*/actions        server actions           ← auth, validation, rate limit
    ↓
  features/*/services       business rules           ← pure where possible
    ↓
  features/*/repositories   data access (interface)  ← Prisma | in-memory
    ↓
  lib/, adapters/           infrastructure
```

The rule that matters: **a page never talks to Prisma about business rules.** It calls a
repository for reads and a server action for writes. That keeps `app/` disposable — the routing
layer could be replaced without touching the logic underneath.

## Feature slices

Each feature is a vertical slice that owns its whole stack:

```
features/booking/
├── domain/         SlotView, DayAvailability — serialisable read models
├── repositories/   SlotRepository interface + Prisma and in-memory drivers
├── services/       slot-generator (pure), slot-lock, booking.service
├── actions/        holdSlot, confirmBooking, cancel, reschedule
├── schemas/        Zod contracts shared verbatim by client and server
└── components/     AvailabilityPanel, CheckoutForm, HoldCountdown
```

Cross-feature imports go through a feature's public surface (`domain/`, `repositories/index.ts`),
never into its internals.

## Repository pattern, and why it earns its keep

Every repository is an interface with at least two implementations:

| Interface | Production | Alternative |
| --- | --- | --- |
| `DoctorRepository` | `PrismaDoctorRepository` | `InMemoryDoctorRepository` |
| `SlotRepository` | `PrismaSlotRepository` | `InMemorySlotRepository` |

This is not ceremony. It buys three concrete things:

1. **The UI runs before the database exists.** `DEMO_MODE=true` swaps the driver; the marketplace
   renders with real filtering, faceting and ranking logic.
2. **Tests need no database.** The in-memory driver *is* the fixture.
3. **The filtering algorithm is shared.** The in-memory driver implements the same relevance
   score, facet counting and pagination as the Prisma one — it is a different store, not
   different behaviour.

The in-memory slot repository expands availability through the **same `generateSlots` function**
the seed and the schedule editor use. There is one definition of "when is this doctor free".

## Request lifecycle

### A read (doctor search)

```
GET /doctors?city=Karachi&mode=VIDEO
  → app/doctors/page.tsx           Server Component
  → parseFilters()                 narrow untrusted query strings to union types
  → getDoctorRepository().search() Prisma or in-memory
  → DoctorCard[]                   streamed inside <Suspense>
```

Filters live in the URL, not component state: results are shareable, the back button works, and
the server re-renders with fresh data instead of the client holding a divergent copy.

### A write (confirm a booking)

```
confirmBookingAction(input)
  → runAction()                  wraps everything; failures become values, not throws
  → confirmBookingSchema.parse() Zod
  → requirePatient()             session + role + patient profile
  → enforceRateLimit()           Redis, fail-closed
  → confirmBooking()             service
      ├── verifySlotHold()       Redis CAS on the hold token
      ├── assertBookableWindow() lead time, max advance
      ├── resolveDiscount()      coupon rules
      └── $transaction
            ├── updateMany AVAILABLE|HELD → BOOKED  ← the concurrency guard
            ├── appointment.create
            └── coupon redemption
  → payment adapter
  → revalidatePath("/appointments")
```

Every server action re-authenticates. A server action is a public HTTP endpoint; the fact that
the only link to it sits behind a login screen is not access control.

## Error handling

One taxonomy, `AppError`, carrying an HTTP status and a stable machine-readable `code`
(`SLOT_UNAVAILABLE`, `SLOT_HOLD_EXPIRED`, `RATE_LIMITED`, …). Clients branch on `code`, never on
prose.

Server actions never throw across the network boundary. An uncaught throw reaches the browser as
an opaque "An error occurred in the Server Components render", which tells the patient nothing
and the developer less. `runAction` converts everything into:

```ts
type ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: { code, message, fieldErrors?, retryAfter? } };
```

`toAppError` maps anything unrecognised to a generic 500, so an internal message — a SQL
fragment, a stack trace — can never reach a client by accident.

## Concurrency: the booking engine

Three layers, in descending order of authority.

**1 — The unique index.** `@@unique([doctorId, startsAt, mode])`. The database physically cannot
hold two bookings for one doctor-instant. Everything else is optimisation.

**2 — The conditional update.** Inside a transaction:

```ts
const claimed = await tx.appointmentSlot.updateMany({
  where: { id, status: { in: ["AVAILABLE", "HELD"] }, OR: [ /* ours, free, or expired */ ] },
  data:  { status: "BOOKED" },
});
if (claimed.count === 0) throw new SlotUnavailableError();
```

Postgres serialises the row write. Of N concurrent confirmations exactly one sees `count === 1`.

**3 — The Redis hold.** A 10-minute reservation so two patients do not both reach payment. It
expires on its own, which is the point: if the patient closes the tab, the slot returns with no
cleanup job required.

Each hold carries a random token, and release/extend are compare-and-swap via Lua:

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end
```

Without that check a hold that expired mid-request would be deleted by its original owner just
after a second patient acquired it — silently handing the slot to two people. There is a test for
exactly this sequence.

Two reconciliation sweeps cover Redis loss: `sweepExpiredHolds` returns rows stuck in `HELD`, and
`expireUnpaidAppointments` releases slots behind abandoned checkouts.

## Time and DST

`AvailabilityRule` stores `dayOfWeek` (0–6) plus minutes from local midnight, against an IANA
timezone. It never stores an absolute instant, because a recurring rule is a statement about
wall-clock time.

`generateSlots` is a pure function — no database, no ambient clock — which is what makes DST
behaviour testable:

| Case | Expectation |
| --- | --- |
| Karachi 09:00 | `04:00Z` year-round (no DST) |
| New York 09:00, 7 Mar 2026 | `14:00Z` (EST, −5) |
| New York 09:00, 9 Mar 2026 | `13:00Z` (EDT, −4) |
| Wall-clock round trip | preserved in Karachi, New York, London, Sydney, Kathmandu |

Precedence: vacation → unavailable exception → available exception → weekly rules.

## Adapters

Every external capability is an interface in `adapters/`, resolved at runtime by an environment
variable through an exhaustive `switch` — adding a driver to the env enum without adding it to
the factory is a compile error, not a runtime surprise.

Adapters **do not throw for expected provider failures**. A declined card is a business outcome
the caller must handle:

```ts
type AdapterResult<T> =
  | { ok: true;  data: T }
  | { ok: false; errorCode: string; errorMessage: string; retryable: boolean };
```

`retryable` distinguishes a 503 from a declined card — one should be retried, the other never.

Environment validation refuses `PAYMENT_DRIVER=mock` when `NODE_ENV=production`, so a mock
payment cannot reach a real customer. That check is skipped during `next build`, which sets
`NODE_ENV=production` even on a laptop; the rule governs serving, not compiling.

## Security

| Concern | Where it is handled |
| --- | --- |
| AuthN | Better Auth, scrypt (N=16384, r=16, p=1), httpOnly SameSite=Lax cookies |
| AuthZ | `requireRole` / `requirePermission` beside the data, never in middleware |
| Mass assignment | `role`/`status` are `input: false` |
| Rate limiting | Redis fixed-window; fail-**closed** on auth and booking, fail-open on reads |
| User enumeration | Sign-in returns one uniform error for unknown-email and wrong-password |
| Open redirect | `next` param must be a relative path |
| SQL injection | Prisma parameterises; no raw SQL |
| XSS | React escaping; the assistant renders a three-construct markdown subset, not raw HTML |
| Session theft | Password reset deletes every other session |
| Audit | Field-level before/after diffs, secrets redacted at write time |
| Headers | CSP-adjacent set in `next.config.ts` (HSTS, nosniff, frame options, permissions policy) |

Middleware deserves its own note: it performs an **optimistic cookie check only**. It never reads
the database and never decides role access. A cookie proves possession, not authority, and
treating middleware as the security boundary is the classic Next.js authorisation bug.

## Performance

- Server Components by default; `"use client"` only where interaction demands it.
- `<Suspense>` around the doctor grid, keyed on filters, with geometry-matched skeletons so the
  layout does not reflow.
- 77 database indexes covering every documented access path.
- Facet counts computed over the filtered set, so the numbers describe what the patient would
  actually get.
- Slot queries bounded (`take: 500`) — a busy doctor over a wide horizon is thousands of rows.
- `optimizePackageImports` for `lucide-react` and `date-fns`.
- Denormalised `ratingAverage` / `ratingCount` on `Doctor`, recomputed on review write, so the
  listing never aggregates per row.

## Known trade-offs

**Search has two tiers.** Meilisearch serves `search` when reachable, giving typo tolerance and
facet distributions in one round trip; Postgres serves everything else and takes over whenever the
index is down, erroring or empty. The index is a projection, never the source of truth — a profile
page and the fee shown beside a Book button are always re-read from Postgres, because an index
lagging one sync behind is fine for a result grid and unacceptable for a price.

**The in-memory slot repository re-expands the calendar to resolve one slot by id.** Bounded to a
30-day horizon it is cheap, and it only ever runs in demo mode.

**`earliest_available` sorting is applied in memory** after the page is fetched, because slot
ordering cannot be expressed in the same query. Correct within a page, not globally.

**Facet queries are several round trips.** Clear and correct; a single grouped query would be
faster and is the obvious next optimisation.
