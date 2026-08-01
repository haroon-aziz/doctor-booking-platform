# API reference

There is no public REST API. The application talks to itself through **server actions** for
mutations and **direct repository calls** in Server Components for reads. Two route handlers
exist because they need HTTP semantics that actions cannot express: OAuth-style auth callbacks,
and a streaming response.

## Result envelope

Every server action returns a discriminated union. Actions never throw across the network
boundary — an uncaught throw reaches the browser as an opaque "An error occurred in the Server
Components render", which tells a patient nothing and a developer less.

```ts
type ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: {
        code: ErrorCode;
        message: string;                        // safe to display
        fieldErrors?: Record<string, string[]>; // keyed by form field path
        retryAfter?: number;                    // seconds, on RATE_LIMITED
      } };
```

Client usage:

```ts
const result = await confirmBookingAction({ slotId, holdToken });
if (!result.ok) {
  if (result.error.code === "SLOT_HOLD_EXPIRED") return showExpiredState();
  return setError(result.error.message);
}
router.push(`/appointments/${result.data.appointmentId}`);
```

Branch on `code`, never on `message` — prose is for humans and will change.

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Zod rejected the input; see `fieldErrors` |
| `UNAUTHENTICATED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Authenticated, but not permitted (also suspended/deactivated accounts) |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | State does not allow the operation |
| `SLOT_UNAVAILABLE` | 409 | Slot taken, blocked, or the doctor is unbookable |
| `SLOT_HOLD_EXPIRED` | 410 | The 10-minute reservation lapsed — re-select a time |
| `BOOKING_WINDOW_INVALID` | 422 | Outside min lead time or max advance |
| `PAYMENT_FAILED` | 402 | Provider declined |
| `RATE_LIMITED` | 429 | Too many requests; honour `retryAfter` |
| `UPLOAD_REJECTED` | 415 | File type or size refused |
| `DEPENDENCY_UNAVAILABLE` | 503 | Redis, database or a provider is down |
| `INTERNAL_ERROR` | 500 | Unmapped failure; details logged, never returned |

`toAppError` maps anything unrecognised to `INTERNAL_ERROR`, so an internal message — a SQL
fragment, a stack trace — can never reach a client by accident.

---

## Booking actions

`src/features/booking/actions/booking.actions.ts`

### `holdSlotAction({ slotId })`

Reserves a slot for the current patient. Called automatically when checkout opens.

- **Requires** `PATIENT`
- **Rate limit** 20/min, fail-closed
- **Returns** `{ holdToken, expiresAt, slot }`
- **Errors** `SLOT_UNAVAILABLE`, `BOOKING_WINDOW_INVALID`, `NOT_FOUND`

Re-entrant: the same patient reloading checkout gets their existing hold refreshed rather than a
"taken" error.

### `releaseSlotAction(slotId, holdToken)`

Returns a held slot to the pool. Fired on checkout unmount so an abandoned tab frees the slot
immediately instead of waiting out the TTL. Compare-and-swap on the token — a caller can only
release its own hold.

### `confirmBookingAction({ slotId, holdToken, reasonForVisit?, patientNotes?, couponCode? })`

Converts a hold into an appointment.

- **Requires** `PATIENT`
- **Rate limit** 10/min, fail-closed
- **Returns** `{ appointmentId, referenceCode, status, requiresPaymentAction, redirectUrl? }`
- **Errors** `SLOT_HOLD_EXPIRED`, `SLOT_UNAVAILABLE`, `BOOKING_WINDOW_INVALID`, `CONFLICT`

A fully discounted booking (`totalMinor === 0`) skips the payment provider entirely. A declined
payment rolls the slot back to `AVAILABLE` so a failed card does not silently consume it.

### `cancelAppointmentAction({ appointmentId, reason? })`

Permitted for the owning patient, the attending doctor, or an admin.

Refund policy: full refund if the patient cancels outside the free window
(`booking.cancellation_window_hours`, default 24) **or** if the doctor cancels at any time. Late
patient cancellations are not auto-refunded; support can still issue one.

Returns `{ refunded: boolean }`.

### `rescheduleAppointmentAction({ appointmentId, newSlotId })`

Moves an appointment, carrying the original payment across. The new slot is claimed **before** the
old one is released, so a failure never leaves the patient with no appointment. Must stay with the
same doctor.

---

## Doctor portal actions

`src/features/doctor-portal/actions/schedule.actions.ts`

### `saveScheduleAction({ rules })`

Replaces the weekly schedule and regenerates 60 days of slots.

- **Requires** `DOCTOR` with `verificationStatus: APPROVED`
- **Errors** `CONFLICT` (overlapping periods), `VALIDATION_ERROR` (bad window, break outside
  hours, mode not enabled)
- **Returns** `{ slots: number }`

Only `AVAILABLE` future slots are deleted. `HELD` and `BOOKED` survive — a patient's confirmed
appointment must not vanish because the doctor edited Tuesday.

### `setVacationModeAction({ enabled, startsAt, endsAt })`

Withdraws untaken slots in the window. Existing appointments are **not** cancelled; the doctor
must do that deliberately.

---

## Admin actions

`src/features/admin/actions/verification.actions.ts`

### `approveDoctorAction({ doctorId, note? })`

- **Requires** permission `doctor:verify`
- Sets `APPROVED`, activates the account, notifies in-app and by email
- Fully audited (actor, before/after, IP, user-agent)

### `rejectDoctorAction({ doctorId, reason, allowResubmit })`

`reason` is **required**, minimum 10 characters — a doctor is entitled to know why, and an
unexplained rejection cannot be appealed or audited. Also sets `isAcceptingPatients: false` and
deletes future open slots, so a rejected doctor does not merely lose a badge while staying
bookable.

---

## Route handlers

### `GET|POST /api/auth/[...all]`

Better Auth's full surface: sign-in, sign-up, sign-out, session, email verification, password
reset, account linking. Rate limited to `RATE_LIMIT_AUTH_MAX` per
`RATE_LIMIT_AUTH_WINDOW_SECONDS`.

### `GET /api/ai/chat`

Reports which assistant driver is live.

```json
{ "driver": "fallback", "model": "rule-engine", "ready": true }
```

`ready` is always `true` — the assistant is usable whether or not Ollama is running. That is the
point of the fallback.

### `POST /api/ai/chat`

Server-sent events. SSE rather than JSON because a local model emits tokens over several seconds.

```jsonc
// request
{ "message": "I have had a sore throat for four days", "history": [{ "role": "user", "content": "…" }] }
```

```
data: {"type":"meta","usedFallback":true,"triageLevel":"ROUTINE","suggestedSpecialty":"ENT"}
data: {"type":"delta","content":"An ENT specialist can assess this…"}
data: {"type":"done","usedFallback":true,"triageLevel":"ROUTINE"}
data: [DONE]
```

Rate limit: 40 messages / 5 min authenticated, 12 anonymous — a local model is CPU-bound and one
scripted client could otherwise starve real users.

**Emergency short-circuit:** if the rule engine flags possible emergency symptoms, that answer is
returned verbatim and Ollama is never called.

---

## Reads

Reads go through repositories in Server Components, not actions.

```ts
const doctors = await getDoctorRepository().search({ city, specialty, mode, page, sort });
const slots   = await getSlotRepository().getAvailability({ doctorId, days: 7 });
```

Both resolve to a Prisma or in-memory driver depending on `DEMO_MODE`. Search filters live in the
URL, so results are shareable and the back button works.
