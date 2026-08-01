import pino, { type Logger } from "pino";

import { env } from "@/lib/config/env";

/**
 * Structured application logger.
 *
 * Redaction is applied at the logger level rather than at each call site: a
 * healthcare platform must never emit credentials, tokens or patient
 * identifiers into a log aggregator, and relying on discipline at hundreds of
 * call sites is not a control.
 */

const REDACTED_PATHS = [
  "password",
  "*.password",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "token",
  "*.token",
  "accessToken",
  "refreshToken",
  "*.accessToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "cardNumber",
  "*.cardNumber",
  "cvv",
  "*.cvv",
];

function createLogger(): Logger {
  // pino-pretty runs in a worker thread, which Next's bundled server runtime
  // cannot spawn. Pretty output is therefore limited to plain Node processes
  // (scripts, seeds, tests); inside Next we emit structured JSON.
  const usePrettyTransport = env.NODE_ENV === "development" && !process.env.NEXT_RUNTIME;

  return pino({
    level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    base: { service: "doctor-booking-platform", env: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(usePrettyTransport
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,service" },
          },
        }
      : {}),
  });
}

const globalForLogger = globalThis as unknown as { logger?: Logger };

export const logger: Logger = globalForLogger.logger ?? createLogger();

if (env.NODE_ENV !== "production") {
  globalForLogger.logger = logger;
}

/** Returns a child logger that stamps every line with a correlation id. */
export function requestLogger(requestId: string, extra?: Record<string, unknown>): Logger {
  return logger.child({ requestId, ...extra });
}

export type { Logger };
