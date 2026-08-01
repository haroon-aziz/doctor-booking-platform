import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

import { EasypaisaPaymentAdapter } from "./easypaisa.adapter";
import { JazzCashPaymentAdapter } from "./jazzcash.adapter";
import { MockPaymentAdapter } from "./mock.adapter";
import { PaypalPaymentAdapter } from "./paypal.adapter";
import { StripePaymentAdapter } from "./stripe.adapter";
import type { PaymentAdapter } from "./types";

/**
 * Resolves the active payment driver from PAYMENT_DRIVER.
 *
 * The switch is exhaustive over the env enum, so adding a provider to the enum
 * without adding it here is a compile error rather than a runtime surprise.
 */

let instance: PaymentAdapter | undefined;

function build(): PaymentAdapter {
  switch (env.PAYMENT_DRIVER) {
    case "stripe":
      return new StripePaymentAdapter();
    case "jazzcash":
      return new JazzCashPaymentAdapter();
    case "easypaisa":
      return new EasypaisaPaymentAdapter();
    case "paypal":
      return new PaypalPaymentAdapter();
    case "mock":
      return new MockPaymentAdapter();
    default: {
      const exhaustive: never = env.PAYMENT_DRIVER;
      throw new Error(`Unsupported PAYMENT_DRIVER: ${String(exhaustive)}`);
    }
  }
}

export function getPaymentAdapter(): PaymentAdapter {
  if (!instance) {
    instance = build();
    logger.info({ driver: instance.driver }, "Payment adapter resolved");
  }
  return instance;
}

/** Test seam: lets a suite inject a double without touching the environment. */
export function setPaymentAdapter(adapter: PaymentAdapter | undefined): void {
  instance = adapter;
}

export type { PaymentAdapter } from "./types";
export * from "./types";
