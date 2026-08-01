import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { adapterOk, type AdapterHealth, type AdapterResult } from "@/adapters/types";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis/client";

import type { EmailAdapter, SendEmailInput, SendEmailResult } from "./types";

/**
 * Offline email driver.
 *
 * Messages are written to `storage/mailbox/` as browsable `.html` files and
 * pushed onto a capped Redis list that the admin panel reads. Developers can
 * therefore click through a real password-reset or appointment-reminder email
 * without an SMTP server, and integration tests can assert on what was sent.
 */

const MAILBOX_KEY = "mock-email:outbox";
const MAILBOX_LIMIT = 200;
const MAILBOX_DIR = path.resolve(process.cwd(), "storage", "mailbox");

export interface CapturedEmail {
  messageId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  sentAt: string;
  filePath: string;
}

export class MockEmailAdapter implements EmailAdapter {
  readonly driver = "mock";

  async send(input: SendEmailInput): Promise<AdapterResult<SendEmailResult>> {
    const messageId = `mock-${randomUUID()}`;
    const sentAt = new Date().toISOString();
    const safeName = `${sentAt.replace(/[:.]/g, "-")}-${input.to.replace(/[^a-z0-9]/gi, "_")}.html`;
    const filePath = path.join(MAILBOX_DIR, safeName);

    await mkdir(MAILBOX_DIR, { recursive: true });
    await writeFile(
      filePath,
      `<!-- to: ${input.to} | subject: ${input.subject} | sent: ${sentAt} -->\n${input.html}`,
      "utf8",
    );

    const captured: CapturedEmail = {
      messageId,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      sentAt,
      filePath,
    };

    // Best-effort: a Redis outage must not break a signup flow in development.
    try {
      await redis.lpush(MAILBOX_KEY, JSON.stringify(captured));
      await redis.ltrim(MAILBOX_KEY, 0, MAILBOX_LIMIT - 1);
    } catch (error) {
      logger.warn({ err: error }, "Could not record mock email in Redis");
    }

    logger.info({ to: input.to, subject: input.subject, filePath }, "Mock email captured");

    return adapterOk({ messageId, captured: true });
  }

  async health(): Promise<AdapterHealth> {
    return { driver: this.driver, healthy: true, detail: `Writing to ${MAILBOX_DIR}` };
  }

  /** Reads the captured outbox — used by the developer mailbox screen. */
  static async readOutbox(limit = 50): Promise<CapturedEmail[]> {
    try {
      const entries = await redis.lrange(MAILBOX_KEY, 0, limit - 1);
      return entries.map((entry) => JSON.parse(entry) as CapturedEmail);
    } catch {
      return [];
    }
  }
}
