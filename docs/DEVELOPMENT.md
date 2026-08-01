# Developer guide

## Conventions

**TypeScript is strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
`noImplicitOverride`. `array[0]` is `T | undefined` and must be narrowed. This is deliberate: most
runtime crashes in a codebase like this are an index or an optional field the author assumed was
present.

**No `any`.** Use `unknown` and narrow. Server action inputs are typed `unknown` and parsed with
Zod, because the client is untrusted by definition.

**Comments explain *why*.** The code already says what. A comment earns its place by recording a
constraint, a trade-off, or a trap — not by narrating the next line.

**Imports** are ordered: node builtins → external → `@/` internal → relative. Prettier with the
Tailwind plugin handles class ordering.

## Adding a feature

Follow the vertical slice. For a hypothetical `prescriptions` feature:

```
src/features/prescriptions/
├── domain/types.ts              serialisable read models
├── repositories/
│   ├── prescription.repository.ts    the interface
│   ├── prisma-prescription.repository.ts
│   └── index.ts                      DEMO_MODE-aware factory
├── schemas/prescription.schema.ts    Zod, shared by client and server
├── services/prescription.service.ts  business rules
├── actions/prescription.actions.ts   "use server"
└── components/                       feature UI
```

Then add the route in `src/app/`, keeping it thin — fetch, compose, render.

### A server action, in full

```ts
"use server";

export async function createPrescriptionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction("createPrescription", async () => {
    const parsed = createPrescriptionSchema.parse(input);   // 1. validate
    const { user, doctorId } = await requireDoctor();       // 2. authorise
    await enforceRateLimit("prescription", user.id, 30);    // 3. rate limit

    const result = await createPrescription({ ...parsed, doctorId });

    await recordAudit({                                     // 4. audit
      actorId: user.id, actorRole: user.role,
      action: "CREATE", entityType: "Prescription", entityId: result.id,
    });

    revalidatePath("/doctor/patients");                     // 5. revalidate
    return { id: result.id };
  });
}
```

Those five steps, in that order, every time. Skipping step 2 because "the page is already behind
a login" is the mistake — a server action is a public HTTP endpoint.

## Testing

```bash
npm test                  # run once
npm run test:watch        # watch mode
npm run test:coverage     # coverage report
```

Tests live in `tests/`, mirroring `src/`. Environment is `node`; component tests opt into jsdom
with a `// @vitest-environment jsdom` docblock (Vitest 4 removed `environmentMatchGlobs`).

### What is worth testing here

Current coverage is 103 tests across the pure logic that is genuinely hard to get right:

| Suite | Covers |
| --- | --- |
| `slot-generator` | Breaks, buffers, holidays, vacation, lead time, DST in five zones |
| `money` | Minor-unit round trips, discount caps, fee splits that must sum exactly |
| `datetime` | Wall-clock conversion, overlap boundaries, local day-of-week |
| `permissions` | Every role boundary, including "admins hold no clinical authority" |
| `fallback-engine` | Emergency detection, negation, escalation, FAQ routing |
| `search-filters` | Meilisearch filter escaping, sorting, Postgres fallback paths |
| `redis-config` | Client configuration invariants |

The pattern: **test the pure core, not the framework.** `generateSlots` takes its inputs and clock
as arguments precisely so DST is testable without a database or a fake timer.

### Testing without infrastructure

`tests/helpers/fake-redis.ts` implements the exact commands the slot lock uses — `SET NX EX`,
`GET`, `TTL`, `DEL`, `EVAL` of both Lua scripts, `MULTI/EXEC` — with a settable clock. It verifies
the *algorithm*: token ownership, re-entrancy, expiry, and the case that matters most, where an
expired owner's late release must not delete a hold someone else just acquired.

It is not a Redis emulator and does not replace an integration test against a real server.

Repositories take the same approach: `setDoctorRepository()` and `setSlotRepository()` are test
seams for injecting a double.

## Working without Docker

```bash
DEMO_MODE=true npm run dev
```

The marketplace serves from `InMemoryDoctorRepository` and `InMemorySlotRepository`, which
implement the same filtering, ranking, faceting and slot-expansion logic as the Prisma drivers —
a different store, not different behaviour. Availability is expanded by the same `generateSlots`
the seed uses.

Reads work. Writes (auth, booking, portals) need Postgres.

## Database changes

```bash
# 1. edit prisma/schema.prisma
npm run db:migrate -- --name add_prescription_notes
npm run db:generate
```

Never hand-edit a migration that has been applied elsewhere. Add indexes for the access paths you
actually introduce, and say which query each serves in `docs/DATABASE.md`.

## Adding an adapter driver

1. Implement the interface in `src/adapters/<capability>/<driver>.adapter.ts`.
2. Add the driver name to the env enum in `src/lib/config/env.ts`.
3. Add the case to the factory `switch`.

The `switch` ends in `const exhaustive: never = driver`, so step 2 without step 3 is a **compile
error**, not a runtime surprise.

Return `AdapterResult` — never throw for an expected provider failure. A declined card is a
business outcome the caller must handle. Set `retryable` honestly: a 503 is retryable, a declined
card is not.

## Debugging

```bash
LOG_LEVEL=debug npm run dev     # pretty-printed pino
npm run db:studio               # browse data
```

- **Mock emails** — open the `.html` files in `storage/mailbox/`.
- **Mock SMS** — `redis-cli lrange mock-sms:inbox 0 10`.
- **Slot holds** — `redis-cli keys 'slot:hold:*'` then `ttl <key>`.
- **Rate limits** — `redis-cli keys 'ratelimit:*'`.

## Pitfalls specific to this codebase

**Money is minor units.** `350_000` is Rs 3,500.00. Never `parseFloat` a fee.

**Times are UTC in the database, local in rules.** An `AvailabilityRule` stores minutes from local
midnight. Converting it with `new Date(...)` and the server's zone will be wrong twice a year —
use `localMinutesToUtc`.

**Prisma `Decimal` and `Date` do not cross to Client Components.** Map to primitives in the
repository. That is why read models are separate types.

**`revalidatePath` after every mutation**, or the list the user returns to is stale.

**Regex stems need `\w*`, not a trailing `\b`.** `\breschedul\b` can never match "reschedule",
because a word boundary cannot fall between two letters.

**Redis `lazyConnect` requires `enableOfflineQueue`.** Together with the queue disabled, the first
command after boot is rejected while the socket is still opening — and because the rate limiter
fails open, it degrades silently instead of erroring.

## Before opening a PR

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

All four must pass. Run them in that order: the build catches whole classes of problem `tsc`
cannot see, such as module-level code that reaches for infrastructure while Next collects page
data.
