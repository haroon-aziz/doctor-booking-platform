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
 * PayPal Orders v2 driver.
 *
 * PayPal uses OAuth2 client-credentials; the access token is cached in memory
 * until shortly before expiry so a burst of checkouts does not mint a token per
 * request.
 */

const PAYPAL_API =
  process.env.PAYPAL_ENVIRONMENT === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class PaypalPaymentAdapter implements PaymentAdapter {
  readonly driver = "paypal";
  readonly provider = "PAYPAL" as const;

  private tokenCache: CachedToken | null = null;

  private get credentials() {
    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("PayPal credentials are not configured.");
    return { clientId, clientSecret };
  }

  private async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token;
    }

    const { clientId, clientSecret } = this.credentials;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const response = await fetchWithTimeout(`${PAYPAL_API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      timeoutMs: 15_000,
    });

    if (!response.ok) throw new Error(`PayPal token request failed with HTTP ${response.status}`);

    const payload = (await response.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
    return payload.access_token;
  }

  async createPayment(input: CreatePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    try {
      const token = await this.accessToken();
      const response = await fetchWithTimeout(`${PAYPAL_API}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": input.idempotencyKey,
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: input.appointmentId,
              description: input.description.slice(0, 127),
              amount: {
                currency_code: input.currency.toUpperCase(),
                // PayPal expects a decimal string in the major unit.
                value: (input.amountMinor / 100).toFixed(2),
              },
            },
          ],
          application_context: { return_url: input.returnUrl, cancel_url: input.returnUrl },
        }),
        timeoutMs: 20_000,
      });

      const payload = (await response.json()) as {
        id?: string;
        status?: string;
        links?: Array<{ rel: string; href: string }>;
        message?: string;
      };

      if (!response.ok || !payload.id) {
        return adapterFail(
          `http_${response.status}`,
          payload.message ?? "PayPal rejected the order.",
          response.status >= 500,
        );
      }

      return adapterOk({
        providerPaymentId: payload.id,
        providerIntentId: payload.id,
        status: "requires_action",
        redirectUrl: payload.links?.find((link) => link.rel === "approve")?.href,
        amountMinor: input.amountMinor,
        currency: input.currency.toUpperCase(),
        raw: payload as Record<string, unknown>,
      });
    } catch (error) {
      logger.error({ err: error }, "PayPal order creation threw");
      return adapterFail("network_error", "Could not reach PayPal.", true);
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    try {
      const token = await this.accessToken();
      const response = await fetchWithTimeout(
        `${PAYPAL_API}/v2/checkout/orders/${input.providerPaymentId}/capture`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          timeoutMs: 20_000,
        },
      );

      const payload = (await response.json()) as { id?: string; status?: string };

      if (!response.ok) {
        return adapterFail(`http_${response.status}`, "PayPal capture failed.", response.status >= 500);
      }

      return adapterOk({
        providerPaymentId: input.providerPaymentId,
        status: payload.status === "COMPLETED" ? "succeeded" : "processing",
        amountMinor: input.amountMinor,
        currency: env.PAYMENT_CURRENCY,
        raw: payload as Record<string, unknown>,
      });
    } catch (error) {
      logger.error({ err: error }, "PayPal capture threw");
      return adapterFail("network_error", "Could not reach PayPal.", true);
    }
  }

  async getPayment(providerPaymentId: string): Promise<AdapterResult<PaymentIntent>> {
    try {
      const token = await this.accessToken();
      const response = await fetchWithTimeout(
        `${PAYPAL_API}/v2/checkout/orders/${providerPaymentId}`,
        { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 },
      );

      const payload = (await response.json()) as {
        status?: string;
        purchase_units?: Array<{ amount?: { value?: string; currency_code?: string } }>;
      };

      const amount = payload.purchase_units?.[0]?.amount;

      return adapterOk({
        providerPaymentId,
        status: payload.status === "COMPLETED" ? "succeeded" : "processing",
        amountMinor: Math.round(Number(amount?.value ?? 0) * 100),
        currency: amount?.currency_code ?? env.PAYMENT_CURRENCY,
        raw: payload as Record<string, unknown>,
      });
    } catch {
      return adapterFail("network_error", "Could not reach PayPal.", true);
    }
  }

  async refund(input: RefundInput): Promise<AdapterResult<RefundResult>> {
    try {
      const token = await this.accessToken();
      const response = await fetchWithTimeout(
        `${PAYPAL_API}/v2/payments/captures/${input.providerPaymentId}/refund`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": input.idempotencyKey,
          },
          body: JSON.stringify(
            input.amountMinor
              ? {
                  amount: {
                    value: (input.amountMinor / 100).toFixed(2),
                    currency_code: env.PAYMENT_CURRENCY,
                  },
                }
              : {},
          ),
          timeoutMs: 20_000,
        },
      );

      const payload = (await response.json()) as { id?: string; status?: string; message?: string };

      if (!response.ok || !payload.id) {
        return adapterFail(
          `http_${response.status}`,
          payload.message ?? "PayPal refund failed.",
          response.status >= 500,
        );
      }

      return adapterOk({
        providerRefundId: payload.id,
        refundedMinor: input.amountMinor ?? 0,
        status: payload.status === "COMPLETED" ? "succeeded" : "pending",
      });
    } catch {
      return adapterFail("network_error", "Could not reach PayPal.", true);
    }
  }

  /**
   * PayPal verifies webhooks server-side rather than with a local HMAC, so this
   * posts the notification back to the verification endpoint.
   */
  async verifyWebhook(input: WebhookVerificationInput): Promise<AdapterResult<WebhookEvent>> {
    try {
      const token = await this.accessToken();
      const event = JSON.parse(input.rawBody) as {
        event_type?: string;
        resource?: { id?: string; amount?: { value?: string } };
      };

      const response = await fetchWithTimeout(
        `${PAYPAL_API}/v1/notifications/verify-webhook-signature`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            transmission_id: input.headers["paypal-transmission-id"],
            transmission_time: input.headers["paypal-transmission-time"],
            cert_url: input.headers["paypal-cert-url"],
            auth_algo: input.headers["paypal-auth-algo"],
            transmission_sig: input.headers["paypal-transmission-sig"],
            webhook_id: process.env.PAYPAL_WEBHOOK_ID ?? "",
            webhook_event: event,
          }),
          timeoutMs: 15_000,
        },
      );

      const verification = (await response.json()) as { verification_status?: string };
      if (verification.verification_status !== "SUCCESS") {
        return adapterFail("invalid_signature", "PayPal webhook verification failed.");
      }

      const typeMap: Record<string, WebhookEvent["type"]> = {
        "PAYMENT.CAPTURE.COMPLETED": "payment.succeeded",
        "PAYMENT.CAPTURE.DENIED": "payment.failed",
        "PAYMENT.CAPTURE.REFUNDED": "refund.succeeded",
      };

      return adapterOk({
        type: typeMap[event.event_type ?? ""] ?? "unknown",
        providerPaymentId: event.resource?.id,
        amountMinor: Math.round(Number(event.resource?.amount?.value ?? 0) * 100),
        raw: event as Record<string, unknown>,
      });
    } catch (error) {
      logger.error({ err: error }, "PayPal webhook verification threw");
      return adapterFail("network_error", "Could not reach PayPal.", true);
    }
  }

  async health(): Promise<AdapterHealth> {
    try {
      await this.accessToken();
      return { driver: this.driver, healthy: true };
    } catch (error) {
      return {
        driver: this.driver,
        healthy: false,
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }
}
