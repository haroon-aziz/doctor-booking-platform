import { createConnection, type Socket } from "node:net";
import { connect as createTlsConnection, type TLSSocket } from "node:tls";

import { adapterFail, adapterOk, type AdapterHealth, type AdapterResult } from "@/adapters/types";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

import type { EmailAdapter, SendEmailInput, SendEmailResult } from "./types";

/**
 * SMTP driver written directly against the protocol.
 *
 * Nodemailer would be the conventional choice, but it is a substantial
 * dependency that no developer running the default offline stack ever loads.
 * This implementation covers what the platform actually needs: ESMTP with
 * STARTTLS, AUTH LOGIN, and a MIME multipart/alternative body.
 *
 * Activated by EMAIL_DRIVER=smtp.
 */

class SmtpSession {
  private socket: Socket | TLSSocket;
  private buffer = "";
  private pending: ((line: string) => void) | null = null;

  constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // A complete SMTP reply ends with "NNN " (space, not hyphen) on the last line.
    const match = /^\d{3} [^\r\n]*\r\n$/m.exec(this.buffer.split(/(?<=\r\n)/).at(-1) ?? "");
    if (match && this.pending) {
      const reply = this.buffer;
      this.buffer = "";
      const resolve = this.pending;
      this.pending = null;
      resolve(reply);
    }
  }

  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("SMTP read timed out")), 15_000);
      this.pending = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }

  async command(line: string, expected: number): Promise<string> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    const code = Number(reply.slice(0, 3));
    if (code !== expected) {
      throw new Error(`SMTP command "${line.split(" ")[0]}" returned ${code}: ${reply.trim()}`);
    }
    return reply;
  }

  upgradeToTls(host: string): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const tlsSocket = createTlsConnection({ socket: this.socket, servername: host }, () => {
        resolve(new SmtpSession(tlsSocket));
      });
      tlsSocket.once("error", reject);
    });
  }

  close(): void {
    this.socket.end();
  }
}

function encodeHeader(value: string): string {
  // RFC 2047 encoding so non-ASCII subjects survive transit.
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export class SmtpEmailAdapter implements EmailAdapter {
  readonly driver = "smtp";

  async send(input: SendEmailInput): Promise<AdapterResult<SendEmailResult>> {
    const host = env.SMTP_HOST;
    const port = env.SMTP_PORT ?? 587;
    const user = env.SMTP_USER;
    const password = env.SMTP_PASSWORD;

    if (!host || !user || !password) {
      return adapterFail("not_configured", "SMTP credentials are incomplete.");
    }

    let session: SmtpSession | null = null;

    try {
      const socket = createConnection({ host, port });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });

      session = new SmtpSession(socket);
      await session.read();

      await session.command(`EHLO ${new URL(env.APP_URL).hostname}`, 250);
      await session.command("STARTTLS", 220);
      session = await session.upgradeToTls(host);
      await session.command(`EHLO ${new URL(env.APP_URL).hostname}`, 250);

      await session.command("AUTH LOGIN", 334);
      await session.command(Buffer.from(user, "utf8").toString("base64"), 334);
      await session.command(Buffer.from(password, "utf8").toString("base64"), 235);

      await session.command(`MAIL FROM:<${env.EMAIL_FROM}>`, 250);
      await session.command(`RCPT TO:<${input.to}>`, 250);
      await session.command("DATA", 354);

      const boundary = `b${Date.now().toString(36)}`;
      const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${new URL(env.APP_URL).hostname}>`;

      const body = [
        `From: ${env.EMAIL_FROM}`,
        `To: ${input.to}`,
        `Subject: ${encodeHeader(input.subject)}`,
        `Message-ID: ${messageId}`,
        `Date: ${new Date().toUTCString()}`,
        ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(input.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(input.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
        `--${boundary}--`,
        "",
        ".",
      ].join("\r\n");

      await session.command(body, 250);
      await session.command("QUIT", 221);

      return adapterOk({ messageId, captured: false });
    } catch (error) {
      logger.error({ err: error }, "SMTP send failed");
      return adapterFail(
        "smtp_error",
        error instanceof Error ? error.message : "SMTP delivery failed.",
        true,
      );
    } finally {
      session?.close();
    }
  }

  async health(): Promise<AdapterHealth> {
    const host = env.SMTP_HOST;
    const port = env.SMTP_PORT ?? 587;
    if (!host) return { driver: this.driver, healthy: false, detail: "SMTP_HOST not set" };

    return new Promise((resolve) => {
      const socket = createConnection({ host, port });
      const finish = (healthy: boolean, detail?: string) => {
        socket.destroy();
        resolve({ driver: this.driver, healthy, detail });
      };
      socket.setTimeout(5_000, () => finish(false, "connection timed out"));
      socket.once("connect", () => finish(true));
      socket.once("error", (error) => finish(false, error.message));
    });
  }
}
