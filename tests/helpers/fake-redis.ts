/**
 * A faithful in-memory stand-in for the handful of Redis commands this codebase
 * relies on.
 *
 * It exists to test *our* concurrency logic — token ownership, re-entrancy,
 * expiry, compare-and-swap release — without requiring a Redis server in CI.
 * It is not a Redis emulator and makes no claim to be: it implements SET with
 * NX/XX/EX, GET, TTL, DEL, EXPIRE, MULTI/EXEC and EVAL for the two specific
 * Lua scripts used by the slot lock.
 *
 * Because JavaScript is single-threaded, "concurrent" acquisition in a test is
 * modelled by interleaving awaits — which is exactly the interleaving that
 * matters here, since the real race is between separate requests hitting the
 * same key.
 */

interface Entry {
  value: string;
  expiresAtMs: number | null;
}

export class FakeRedis {
  private store = new Map<string, Entry>();
  private now: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.now = clock;
  }

  /** Advances logical time, used to test expiry deterministically. */
  setClock(clock: () => number): void {
    this.now = clock;
  }

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<"OK" | null> {
    let ttlSeconds: number | null = null;
    let mode: "NX" | "XX" | null = null;

    for (let i = 0; i < args.length; i += 1) {
      const token = String(args[i]).toUpperCase();
      if (token === "EX") {
        ttlSeconds = Number(args[i + 1]);
        i += 1;
      } else if (token === "NX" || token === "XX") {
        mode = token;
      }
    }

    const existing = this.live(key);
    if (mode === "NX" && existing) return null;
    if (mode === "XX" && !existing) return null;

    this.store.set(key, {
      value,
      expiresAtMs: ttlSeconds === null ? null : this.now() + ttlSeconds * 1000,
    });
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAtMs === null) return -1;
    return Math.ceil((entry.expiresAtMs - this.now()) / 1000);
  }

  async incr(key: string): Promise<number> {
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.store.set(key, { value: String(next), expiresAtMs: entry?.expiresAtMs ?? null });
    return next;
  }

  async expire(key: string, seconds: number, mode?: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return 0;
    if (mode?.toUpperCase() === "NX" && entry.expiresAtMs !== null) return 0;
    entry.expiresAtMs = this.now() + seconds * 1000;
    return 1;
  }

  async ping(): Promise<string> {
    return "PONG";
  }

  /** Implements the exact semantics of the slot-lock Lua scripts. */
  async eval(script: string, _numKeys: number, ...args: string[]): Promise<number> {
    const [key, token, ttl] = args;
    if (key === undefined || token === undefined) return 0;

    const current = await this.get(key);
    if (current !== token) return 0;

    if (script.includes("DEL")) {
      return this.del(key);
    }
    if (script.includes("EXPIRE")) {
      return this.expire(key, Number(ttl));
    }
    return 0;
  }

  multi(): FakeMulti {
    return new FakeMulti(this);
  }

  /** Test helper: wipes all state between cases. */
  flushall(): void {
    this.store.clear();
  }
}

class FakeMulti {
  private operations: (() => Promise<unknown>)[] = [];

  constructor(private redis: FakeRedis) {}

  incr(key: string): this {
    this.operations.push(() => this.redis.incr(key));
    return this;
  }

  expire(key: string, seconds: number, mode?: string): this {
    this.operations.push(() => this.redis.expire(key, seconds, mode));
    return this;
  }

  async exec(): Promise<[Error | null, unknown][]> {
    const results: [Error | null, unknown][] = [];
    for (const operation of this.operations) {
      try {
        results.push([null, await operation()]);
      } catch (error) {
        results.push([error as Error, null]);
      }
    }
    return results;
  }
}
