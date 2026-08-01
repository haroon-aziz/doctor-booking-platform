import { createHash, randomUUID } from "node:crypto";

import { adapterFail, adapterOk, type AdapterHealth, type AdapterResult } from "@/adapters/types";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis/client";

import type {
  CapturePaymentInput,
  CreatePaymentInput,
  PaymentAdapter,
  PaymentIntent,
  RefundInput,
  RefundResult,
  WebhookEvent,
  WebhookVerificationInput,
} from "./types";

/**
 * Offline payment driver.
 *
 * It is a genuine state machine rather than a stub that always returns success:
 * intents are persisted in Redis, idempotency keys are honoured, refunds are
 * validated against the captured amount, and partial refunds accumulate. That
 * means the checkout flow, the refund flow and the reconciliation logic are all
 * exercised for real in development — the only thing that never happens is
 * money moving.
 *
 * Failure injection: an amount whose minor-unit value ends in `13` is declined,
 * and one ending in `99` requires an extra confirmation step. This gives
 * deterministic, dependency-free coverage of the unhappy paths.
 */

const INTENT_PREFIX = "mock-payment:intent:";
const IDEMPOTENCY_PREFIX = "mock-payment:idem:";
const INTENT_TTL_SECONDS = 60 * 60 * 24 * 7;

interface StoredIntent {
  providerPaymentId: string;
  appointmentId: string;
  amountMinor: number;
  capturedMinor: number;
  refundedMinor: number;
  currency: string;
  status: PaymentIntent["status"];
  createdAt: string;
}

export class MockPaymentAdapter implements PaymentAdapter {
  readonly driver = "mock";
  readonly provider = "MOCK" as const;

  async createPayment(input: CreatePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    if (input.amountMinor <= 0) {
      return adapterFail("invalid_amount", "Payment amount must be greater than zero.");
    }

    // Replaying the same idempotency key must return the original intent.
    const existingId = await redis.get(IDEMPOTENCY_PREFIX + input.idempotencyKey);
    if (existingId) {
      const existing = await this.read(existingId);
      if (existing) return adapterOk(this.toIntent(existing));
    }

    const lastTwo = input.amountMinor % 100;
    if (lastTwo === 13) {
      return adapterFail("card_declined", "The payment was declined by the issuing bank.", false);
    }

    const providerPaymentId = `mock_pi_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const status: PaymentIntent["status"] = lastTwo === 99 ? "requires_action" : "succeeded";

    const stored: StoredIntent = {
      providerPaymentId,
      appointmentId: input.appointmentId,
      amountMinor: input.amountMinor,
      capturedMinor: status === "succeeded" ? input.amountMinor : 0,
      refundedMinor: 0,
      currency: input.currency,
      status,
      createdAt: new Date().toISOString(),
    };

    await this.write(stored);
    await redis.set(
      IDEMPOTENCY_PREFIX + input.idempotencyKey,
      providerPaymentId,
      "EX",
      INTENT_TTL_SECONDS,
    );

    logger.info(
      { providerPaymentId, amountMinor: input.amountMinor, status, appointmentId: input.appointmentId },
      "Mock payment created",
    );

    return adapterOk({
      ...this.toIntent(stored),
      redirectUrl:
        status === "requires_action"
          ? `/checkout/mock-confirm?intent=${providerPaymentId}&return=${encodeURIComponent(input.returnUrl)}`
          : undefined,
    });
  }

  async capturePayment(input: CapturePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    const stored = await this.read(input.providerPaymentId);
    if (!stored) return adapterFail("not_found", "Unknown payment intent.");

    if (stored.status === "succeeded") return adapterOk(this.toIntent(stored));

    stored.status = "succeeded";
    stored.capturedMinor = input.amountMinor;
    await this.write(stored);

    return adapterOk(this.toIntent(stored));
  }

  async getPayment(providerPaymentId: string): Promise<AdapterResult<PaymentIntent>> {
    const stored = await this.read(providerPaymentId);
    if (!stored) return adapterFail("not_found", "Unknown payment intent.");
    return adapterOk(this.toIntent(stored));
  }

  async refund(input: RefundInput): Promise<AdapterResult<RefundResult>> {
    const stored = await this.read(input.providerPaymentId);
    if (!stored) return adapterFail("not_found", "Unknown payment intent.");

    if (stored.status !== "succeeded") {
      return adapterFail("not_refundable", "Only a captured payment can be refunded.");
    }

    const remaining = stored.capturedMinor - stored.refundedMinor;
    const requested = input.amountMinor ?? remaining;

    if (requested <= 0 || requested > remaining) {
      return adapterFail(
        "invalid_refund_amount",
        `Refund of ${requested} exceeds the refundable balance of ${remaining}.`,
      );
    }

    stored.refundedMinor += requested;
    await this.write(stored);

    logger.info(
      { providerPaymentId: stored.providerPaymentId, refundedMinor: requested },
      "Mock refund issued",
    );

    return adapterOk({
      providerRefundId: `mock_re_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      refundedMinor: requested,
      status: "succeeded",
    });
  }

  /**
   * The mock provider signs webhooks with a SHA-256 of the body so the
   * verification path is genuinely exercised offline, not bypassed.
   */
  async verifyWebhook(input: WebhookVerificationInput): Promise<AdapterResult<WebhookEvent>> {
    const expected = createHash("sha256").update(input.rawBody).digest("hex");
    if (input.signature !== expected) {
      return adapterFail("invalid_signature", "Webhook signature verification failed.");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      return adapterFail("invalid_payload", "Webhook body was not valid JSON.");
    }

    const type = typeof parsed.type === "string" ? parsed.type : "unknown";
    const knownTypes = ["payment.succeeded", "payment.failed", "refund.succeeded"] as const;
    const matched = knownTypes.find((candidate) => candidate === type);

    return adapterOk({
      type: matched ?? "unknown",
      providerPaymentId: typeof parsed.paymentId === "string" ? parsed.paymentId : undefined,
      amountMinor: typeof parsed.amountMinor === "number" ? parsed.amountMinor : undefined,
      raw: parsed,
    });
  }

  async health(): Promise<AdapterHealth> {
    try {
      await redis.ping();
      return { driver: this.driver, healthy: true, detail: "Offline mock driver backed by Redis" };
    } catch (error) {
      return {
        driver: this.driver,
        healthy: false,
        detail: error instanceof Error ? error.message : "Redis unreachable",
      };
    }
  }

  private toIntent(stored: StoredIntent): PaymentIntent {
    return {
      providerPaymentId: stored.providerPaymentId,
      providerIntentId: stored.providerPaymentId,
      status: stored.status,
      amountMinor: stored.amountMinor,
      currency: stored.currency,
      raw: { ...stored },
    };
  }

  private async read(providerPaymentId: string): Promise<StoredIntent | null> {
    const raw = await redis.get(INTENT_PREFIX + providerPaymentId);
    return raw ? (JSON.parse(raw) as StoredIntent) : null;
  }

  private async write(intent: StoredIntent): Promise<void> {
    await redis.set(
      INTENT_PREFIX + intent.providerPaymentId,
      JSON.stringify(intent),
      "EX",
      INTENT_TTL_SECONDS,
    );
  }
}
