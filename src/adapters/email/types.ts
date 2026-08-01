import type { Adapter, AdapterResult } from "@/adapters/types";

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Both parts are always supplied; text is the accessible fallback. */
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  messageId: string;
  /** True when the message was captured locally instead of actually sent. */
  captured: boolean;
}

export interface EmailAdapter extends Adapter {
  send(input: SendEmailInput): Promise<AdapterResult<SendEmailResult>>;
}
