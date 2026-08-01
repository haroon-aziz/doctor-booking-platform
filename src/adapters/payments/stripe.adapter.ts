import { createHmac, timingSafeEqual } from "node:crypto";

import {
  adapterFail,
  adapterOk,
  fetchWithTimeout,
  type AdapterHealth,
  type AdapterResult,
} from "@/adapters/types";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

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
 * Stripe driver, implemented against the REST API with `fetch` rather than the
 * official SDK. That keeps the dependency tree free of a package that is dead
 * weight for every developer running the default offline stack, while the
 * request/response contract stays exactly the one Stripe documents.
 *
 * Activated by PAYMENT_DRIVER=stripe; env validation guarantees the keys exist.
 */

const STRIPE_API = "https://api.stripe.com/v1";

/** Stripe expects `application/x-www-form-urlencoded` with bracketed nesting. */
function toFormBody(payload: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) params.append(key, String(value));
  }
  return params.toString();
}

interface StripeIntentResponse {
  id: string;
  client_secret?: string;
  status: string;
  amount: number;
  currency: string;
  next_action?: { redirect_to_url?: { url?: string } } | null;
  error?: { code?: string; message?: string; type?: string };
}

export class StripePaymentAdapter implements PaymentAdapter {
  readonly driver = "stripe";
  readonly provider = "STRIPE" as const;

  private get secretKey(): string {
    const key = env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
    return key;
  }

  async createPayment(input: CreatePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    return this.request<PaymentIntent>("/payment_intents", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: toFormBody({
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        description: input.description,
        "automatic_payment_methods[enabled]": "true",
        "metadata[appointmentId]": input.appointmentId,
        "metadata[patientId]": input.patientId,
        return_url: input.returnUrl,
      }),
      map: (data) => this.toIntent(data),
    });
  }

  async capturePayment(input: CapturePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    return this.request<PaymentIntent>(`/payment_intents/${input.providerPaymentId}/capture`, {
      method: "POST",
      body: toFormBody({ amount_to_capture: input.amountMinor }),
      map: (data) => this.toIntent(data),
    });
  }

  async getPayment(providerPaymentId: string): Promise<AdapterResult<PaymentIntent>> {
    return this.request<PaymentIntent>(`/payment_intents/${providerPaymentId}`, {
      method: "GET",
      map: (data) => this.toIntent(data),
    });
  }

  async refund(input: RefundInput): Promise<AdapterResult<RefundResult>> {
    return this.request<RefundResult>("/refunds", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: toFormBody({
        payment_intent: input.providerPaymentId,
        amount: input.amountMinor,
        reason: input.reason === "duplicate" ? "duplicate" : "requested_by_customer",
      }),
      map: (data) => ({
        providerRefundId: data.id,
        refundedMinor: data.amount,
        status: data.status === "succeeded" ? ("succeeded" as const) : ("pending" as const),
      }),
    });
  }

  /**
   * Verifies the `Stripe-Signature` header per Stripe's scheme: the signed
   * payload is `${timestamp}.${rawBody}`, HMAC-SHA256 with the webhook secret.
   * The timestamp is checked to reject replayed events.
   */
  async verifyWebhook(input: WebhookVerificationInput): Promise<AdapterResult<WebhookEvent>> {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return adapterFail("not_configured", "STRIPE_WEBHOOK_SECRET is not set.");
    if (!input.signature) return adapterFail("missing_signature", "Stripe-Signature header absent.");

    const parts = Object.fromEntries(
      input.signature.split(",").map((piece) => {
        const [key, value] = piece.split("=");
        return [key?.trim() ?? "", value?.trim() ?? ""];
      }),
    );

    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) {
      return adapterFail("malformed_signature", "Stripe-Signature header is malformed.");
    }

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
      return adapterFail("stale_signature", "Webhook timestamp is outside the tolerance window.");
    }

    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${input.rawBody}`)
      .digest("hex");

    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(signature, "utf8");

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      return adapterFail("invalid_signature", "Webhook signature verification failed.");
    }

    const event = JSON.parse(input.rawBody) as {
      type?: string;
      data?: { object?: { id?: string; amount?: number; amount_refunded?: number } };
    };
    const object = event.data?.object;

    const typeMap: Record<string, WebhookEvent["type"]> = {
      "payment_intent.succeeded": "payment.succeeded",
      "payment_intent.payment_failed": "payment.failed",
      "charge.refunded": "refund.succeeded",
    };

    return adapterOk({
      type: typeMap[event.type ?? ""] ?? "unknown",
      providerPaymentId: object?.id,
      amountMinor: object?.amount ?? object?.amount_refunded,
      raw: event as Record<string, unknown>,
    });
  }

  async health(): Promise<AdapterHealth> {
    try {
      const response = await fetchWithTimeout(`${STRIPE_API}/balance`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
        timeoutMs: 8_000,
      });
      return { driver: this.driver, healthy: response.ok, detail: `HTTP ${response.status}` };
    } catch (error) {
      return {
        driver: this.driver,
        healthy: false,
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }

  private toIntent(data: StripeIntentResponse): PaymentIntent {
    const statusMap: Record<string, PaymentIntent["status"]> = {
      succeeded: "succeeded",
      processing: "processing",
      requires_payment_method: "failed",
      requires_action: "requires_action",
      requires_confirmation: "requires_action",
      canceled: "failed",
    };

    return {
      providerPaymentId: data.id,
      providerIntentId: data.id,
      status: statusMap[data.status] ?? "processing",
      redirectUrl: data.next_action?.redirect_to_url?.url,
      clientSecret: data.client_secret,
      amountMinor: data.amount,
      currency: (data.currency ?? "usd").toUpperCase(),
      raw: data as unknown as Record<string, unknown>,
    };
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST";
      body?: string;
      idempotencyKey?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map: (data: any) => T;
    },
  ): Promise<AdapterResult<T>> {
    try {
      const response = await fetchWithTimeout(`${STRIPE_API}${path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        body: options.body,
        timeoutMs: 20_000,
      });

      const payload = (await response.json()) as StripeIntentResponse;

      if (!response.ok) {
        logger.warn({ status: response.status, error: payload.error }, "Stripe request failed");
        // 5xx and rate limits are worth retrying; a declined card is not.
        const retryable = response.status >= 500 || response.status === 429;
        return adapterFail(
          payload.error?.code ?? `http_${response.status}`,
          payload.error?.message ?? "Stripe rejected the request.",
          retryable,
        );
      }

      return adapterOk(options.map(payload));
    } catch (error) {
      logger.error({ err: error }, "Stripe request threw");
      return adapterFail("network_error", "Could not reach Stripe.", true);
    }
  }
}
