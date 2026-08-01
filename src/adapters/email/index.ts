import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

import { MockEmailAdapter } from "./mock.adapter";
import { SmtpEmailAdapter } from "./smtp.adapter";
import type { EmailAdapter } from "./types";

let instance: EmailAdapter | undefined;

function build(): EmailAdapter {
  switch (env.EMAIL_DRIVER) {
    case "smtp":
      return new SmtpEmailAdapter();
    case "mock":
      return new MockEmailAdapter();
    default: {
      const exhaustive: never = env.EMAIL_DRIVER;
      throw new Error(`Unsupported EMAIL_DRIVER: ${String(exhaustive)}`);
    }
  }
}

export function getEmailAdapter(): EmailAdapter {
  if (!instance) {
    instance = build();
    logger.info({ driver: instance.driver }, "Email adapter resolved");
  }
  return instance;
}

export function setEmailAdapter(adapter: EmailAdapter | undefined): void {
  instance = adapter;
}

export { MockEmailAdapter } from "./mock.adapter";
export type { CapturedEmail } from "./mock.adapter";
export * from "./types";
