/**
 * Shared adapter contracts.
 *
 * Every external capability the platform needs (email, SMS, payments, video,
 * file storage) is expressed as an interface here and resolved at runtime from
 * an environment variable. Application code depends only on these interfaces,
 * which is what lets the whole product run offline with zero third-party
 * accounts while the production drivers sit in the same tree, fully written,
 * waiting for credentials.
 */

export interface AdapterHealth {
  driver: string;
  healthy: boolean;
  detail?: string;
}

export interface Adapter {
  readonly driver: string;
  health(): Promise<AdapterHealth>;
}

/**
 * A uniform success/failure envelope. Adapters never throw for expected
 * provider-side failures (a declined card, an unroutable number) — those are
 * business outcomes the caller must handle, not exceptions. They do throw for
 * programming errors and misconfiguration.
 */
export type AdapterResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: string; errorMessage: string; retryable: boolean };

export function adapterOk<T>(data: T): AdapterResult<T> {
  return { ok: true, data };
}

export function adapterFail<T>(
  errorCode: string,
  errorMessage: string,
  retryable = false,
): AdapterResult<T> {
  return { ok: false, errorCode, errorMessage, retryable };
}

/**
 * `fetch` with a hard timeout. Production adapters must never hang a request
 * thread waiting on an unresponsive provider.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
