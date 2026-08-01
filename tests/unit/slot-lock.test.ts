import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeRedis } from "../helpers/fake-redis";

const fakeRedis = new FakeRedis();

vi.mock("@/lib/redis/client", () => ({
  redis: fakeRedis,
  isRedisHealthy: async () => true,
}));

const {
  acquireSlotHold,
  releaseSlotHold,
  extendSlotHold,
  verifySlotHold,
  getSlotHoldTtl,
} = await import("@/features/booking/services/slot-lock");

const SLOT = "slot_123";
const ALICE = "user_alice";
const BOB = "user_bob";

describe("slot locking", () => {
  beforeEach(() => {
    fakeRedis.flushall();
    fakeRedis.setClock(() => Date.now());
  });

  it("grants the hold to the first caller", async () => {
    const result = await acquireSlotHold(SLOT, ALICE, 600);

    expect(result.acquired).toBe(true);
    if (!result.acquired) return;
    expect(result.hold.userId).toBe(ALICE);
    expect(result.hold.token).toBeTruthy();
  });

  it("refuses a second patient while the hold is live", async () => {
    await acquireSlotHold(SLOT, ALICE, 600);
    const bob = await acquireSlotHold(SLOT, BOB, 600);

    expect(bob.acquired).toBe(false);
    if (bob.acquired) return;
    expect(bob.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("is re-entrant for the same patient, preserving the original token", async () => {
    const first = await acquireSlotHold(SLOT, ALICE, 600);
    const second = await acquireSlotHold(SLOT, ALICE, 600);

    expect(first.acquired && second.acquired).toBe(true);
    if (!first.acquired || !second.acquired) return;
    // A reload must not orphan the token the checkout page is already holding.
    expect(second.hold.token).toBe(first.hold.token);
  });

  it("only exactly one of many concurrent callers wins", async () => {
    const contenders = Array.from({ length: 25 }, (_, i) => `user_${i}`);

    const results = await Promise.all(
      contenders.map((userId) => acquireSlotHold(SLOT, userId, 600)),
    );

    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.filter((r) => !r.acquired)).toHaveLength(24);
  });

  it("refuses to release a hold owned by someone else", async () => {
    const alice = await acquireSlotHold(SLOT, ALICE, 600);
    expect(alice.acquired).toBe(true);
    if (!alice.acquired) return;

    // Bob guesses the slot id but not the token.
    const stolen = await releaseSlotHold(SLOT, BOB, alice.hold.token);
    expect(stolen).toBe(false);

    // And the correct token still cannot be used under the wrong identity.
    const wrongToken = await releaseSlotHold(SLOT, ALICE, "not-the-token");
    expect(wrongToken).toBe(false);

    expect(await verifySlotHold(SLOT, ALICE, alice.hold.token)).toBe(true);
  });

  it("releases cleanly for the true owner and frees the slot", async () => {
    const alice = await acquireSlotHold(SLOT, ALICE, 600);
    if (!alice.acquired) throw new Error("expected hold");

    expect(await releaseSlotHold(SLOT, ALICE, alice.hold.token)).toBe(true);

    const bob = await acquireSlotHold(SLOT, BOB, 600);
    expect(bob.acquired).toBe(true);
  });

  it("expires on its own so an abandoned checkout frees the slot", async () => {
    let clock = Date.now();
    fakeRedis.setClock(() => clock);

    await acquireSlotHold(SLOT, ALICE, 600);
    expect(await getSlotHoldTtl(SLOT)).toBeGreaterThan(0);

    clock += 601 * 1000;

    const bob = await acquireSlotHold(SLOT, BOB, 600);
    expect(bob.acquired).toBe(true);
  });

  it("does not let a stale owner release a hold that has been reissued", async () => {
    let clock = Date.now();
    fakeRedis.setClock(() => clock);

    const alice = await acquireSlotHold(SLOT, ALICE, 600);
    if (!alice.acquired) throw new Error("expected hold");

    clock += 601 * 1000;

    const bob = await acquireSlotHold(SLOT, BOB, 600);
    expect(bob.acquired).toBe(true);

    // This is the bug the token guard exists to prevent: Alice's late release
    // must not delete Bob's freshly acquired hold.
    expect(await releaseSlotHold(SLOT, ALICE, alice.hold.token)).toBe(false);
    if (!bob.acquired) return;
    expect(await verifySlotHold(SLOT, BOB, bob.hold.token)).toBe(true);
  });

  it("extends only for the owner", async () => {
    let clock = Date.now();
    fakeRedis.setClock(() => clock);

    const alice = await acquireSlotHold(SLOT, ALICE, 100);
    if (!alice.acquired) throw new Error("expected hold");

    expect(await extendSlotHold(SLOT, BOB, alice.hold.token, 600)).toBe(false);
    expect(await extendSlotHold(SLOT, ALICE, alice.hold.token, 600)).toBe(true);

    clock += 150 * 1000;
    expect(await verifySlotHold(SLOT, ALICE, alice.hold.token)).toBe(true);
  });

  it("keeps holds on different slots independent", async () => {
    const a = await acquireSlotHold("slot_a", ALICE, 600);
    const b = await acquireSlotHold("slot_b", BOB, 600);

    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
  });
});
