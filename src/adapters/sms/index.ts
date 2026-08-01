import { randomUUID } from "node:crypto";

import {
  adapterFail,
  adapterOk,
  fetchWithTimeout,
  type Adapter,
  type AdapterHealth,
  type AdapterResult,
} from "@/adapters/types";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis/client";

/**
 * SMS delivery.
 *
 * The mock driver keeps a Redis-backed inbox so OTP and appointment-reminder
 * flows are fully exercisable offline; the Twilio driver talks to the REST API
 * directly rather than pulling in an SDK that is dead weight for every
 * developer running the default stack.
 */

export interface SendSmsInput {
  to: string;
  body: string;
}

export interface SendSmsResult {
  messageId: string;
  /** True when the message was captured locally instead of actually sent. */
  captured: boolean;
}

export interface SmsAdapter extends Adapter {
  send(input: SendSmsInput): Promise<AdapterResult<SendSmsResult>>;
}

export interface CapturedSms {
  messageId: string;
  to: string;
  body: string;
  sentAt: string;
}

const INBOX_KEY = "mock-sms:inbox";
const INBOX_LIMIT = 200;

/** E.164 is the only format Twilio accepts, so the mock enforces it too — a
 *  number that would fail in production must fail in development. */
const E164 = /^\+[1-9]\d{7,14}$/;

export class MockSmsAdapter implements SmsAdapter {
  readonly driver = "mock";

  async send(input: SendSmsInput): Promise<AdapterResult<SendSmsResult>> {
    if (!E164.test(input.to)) {
      return adapterFail("invalid_number", `"${input.to}" is not a valid E.164 phone number.`);
    }

    const captured: CapturedSms = {
      messageId: `mock-sms-${randomUUID()}`,
      to: input.to,
      body: input.body,
      sentAt: new Date().toISOString(),
    };

    // Best effort: a Redis outage must not break a signup flow in development.
    try {
      await redis.lpush(INBOX_KEY, JSON.stringify(captured));
      await redis.ltrim(INBOX_KEY, 0, INBOX_LIMIT - 1);
    } catch (error) {
      logger.warn({ err: error }, "Could not record mock SMS in Redis");
    }

    logger.info({ to: input.to, body: input.body }, "Mock SMS captured");
    return adapterOk({ messageId: captured.messageId, captured: true });
  }

  async health(): Promise<AdapterHealth> {
    return { driver: this.driver, healthy: true, detail: "Offline mock driver" };
  }

  /** Reads the captured inbox — used by the developer tooling screen. */
  static async readInbox(limit = 50): Promise<CapturedSms[]> {
    try {
      const entries = await redis.lrange(INBOX_KEY, 0, limit - 1);
      return entries.map((entry) => JSON.parse(entry) as CapturedSms);
    } catch {
      return [];
    }
  }
}

export class TwilioSmsAdapter implements SmsAdapter {
  readonly driver = "twilio";

  private get credentials() {
    const accountSid = env.TWILIO_ACCOUNT_SID;
    const authToken = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || !from) {
      throw new Error("Twilio credentials are not fully configured.");
    }
    return { accountSid, authToken, from };
  }

  private authHeader(accountSid: string, authToken: string): string {
    return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }

  async send(input: SendSmsInput): Promise<AdapterResult<SendSmsResult>> {
    let credentials: { accountSid: string; authToken: string; from: string };

    try {
      credentials = this.credentials;
    } catch {
      return adapterFail("not_configured", "Twilio credentials are incomplete.");
    }

    try {
      const response = await fetchWithTimeout(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: this.authHeader(credentials.accountSid, credentials.authToken),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: input.to,
            From: credentials.from,
            Body: input.body,
          }).toString(),
          timeoutMs: 15_000,
        },
      );

      const payload = (await response.json()) as {
        sid?: string;
        message?: string;
        code?: number;
      };

      if (!response.ok || !payload.sid) {
        return adapterFail(
          String(payload.code ?? `http_${response.status}`),
          payload.message ?? "Twilio rejected the message.",
          // 5xx and throttling are worth retrying; an unroutable number is not.
          response.status >= 500 || response.status === 429,
        );
      }

      return adapterOk({ messageId: payload.sid, captured: false });
    } catch (error) {
      logger.error({ err: error }, "Twilio send threw");
      return adapterFail("network_error", "Could not reach Twilio.", true);
    }
  }

  async health(): Promise<AdapterHealth> {
    try {
      const { accountSid, authToken } = this.credentials;
      const response = await fetchWithTimeout(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
        { headers: { Authorization: this.authHeader(accountSid, authToken) }, timeoutMs: 8_000 },
      );
      return { driver: this.driver, healthy: response.ok, detail: `HTTP ${response.status}` };
    } catch (error) {
      return {
        driver: this.driver,
        healthy: false,
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }
}

let instance: SmsAdapter | undefined;

function build(): SmsAdapter {
  switch (env.SMS_DRIVER) {
    case "twilio":
      return new TwilioSmsAdapter();
    case "mock":
      return new MockSmsAdapter();
    default: {
      const exhaustive: never = env.SMS_DRIVER;
      throw new Error(`Unsupported SMS_DRIVER: ${String(exhaustive)}`);
    }
  }
}

export function getSmsAdapter(): SmsAdapter {
  if (!instance) {
    instance = build();
    logger.info({ driver: instance.driver }, "SMS adapter resolved");
  }
  return instance;
}

/** Test seam: lets a suite inject a double without touching the environment. */
export function setSmsAdapter(adapter: SmsAdapter | undefined): void {
  instance = adapter;
}
