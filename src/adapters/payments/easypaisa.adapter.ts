import { createHash } from "node:crypto";

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
 * EasyPaisa (Telenor Pakistan) driver.
 *
 * EasyPaisa's hosted checkout takes the amount in RUPEES with two decimals —
 * unlike JazzCash, which takes paisa. The conversion happens once, here, so the
 * rest of the platform can keep speaking in minor units.
 */

const EASYPAISA_CHECKOUT_URL = "https://easypay.easypaisa.com.pk/easypay/Index.jsf";
const EASYPAISA_TXN_API = "https://easypay.easypaisa.com.pk/easypay-service/rest/v4/qr-payment";

export class EasypaisaPaymentAdapter implements PaymentAdapter {
  readonly driver = "easypaisa";
  readonly provider = "EASYPAISA" as const;

  private get credentials() {
    const storeId = env.EASYPAISA_STORE_ID;
    const hashKey = env.EASYPAISA_HASH_KEY;
    if (!storeId || !hashKey) throw new Error("EasyPaisa credentials are not fully configured.");
    return { storeId, hashKey, accountNumber: env.EASYPAISA_ACCOUNT_NUMBER ?? "" };
  }

  /** Ampersand-joined `key=value` pairs in ascending key order, then SHA-256. */
  private signature(fields: Record<string, string>): string {
    const { hashKey } = this.credentials;
    const canonical = Object.keys(fields)
      .filter((key) => key !== "merchantHashedReq")
      .sort()
      .map((key) => `${key}=${fields[key]}`)
      .join("&");

    return createHash("sha256").update(`${canonical}${hashKey}`).digest("base64");
  }

  async createPayment(input: CreatePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    if (input.currency.toUpperCase() !== "PKR") {
      return adapterFail("unsupported_currency", "EasyPaisa settles in PKR only.");
    }

    const { storeId } = this.credentials;
    const orderId = `EP${Date.now()}${input.idempotencyKey.slice(0, 5).toUpperCase()}`;
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    const fields: Record<string, string> = {
      storeId,
      orderRefNum: orderId,
      // Rupees with two decimals — see the note in this class's doc comment.
      amount: (input.amountMinor / 100).toFixed(2),
      postBackURL: input.returnUrl,
      expiryDate: expiry.toISOString().slice(0, 19).replace("T", " "),
      merchantPaymentMethod: "",
      paymentMethod: "MA_PAYMENT_METHOD",
      autoRedirect: "1",
    };
    fields.merchantHashedReq = this.signature(fields);

    return adapterOk({
      providerPaymentId: orderId,
      providerIntentId: orderId,
      status: "requires_action",
      redirectUrl: EASYPAISA_CHECKOUT_URL,
      amountMinor: input.amountMinor,
      currency: "PKR",
      raw: { formAction: EASYPAISA_CHECKOUT_URL, formFields: fields },
    });
  }

  async capturePayment(input: CapturePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    return this.getPayment(input.providerPaymentId);
  }

  async getPayment(providerPaymentId: string): Promise<AdapterResult<PaymentIntent>> {
    const { storeId } = this.credentials;
    try {
      const response = await fetchWithTimeout(
        `${EASYPAISA_TXN_API}/inquire?storeId=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(providerPaymentId)}`,
        { method: "GET", timeoutMs: 20_000 },
      );

      const payload = (await response.json()) as {
        responseCode?: string;
        transactionAmount?: string;
      };

      return adapterOk({
        providerPaymentId,
        status: payload.responseCode === "0000" ? "succeeded" : "failed",
        amountMinor: Math.round(Number(payload.transactionAmount ?? 0) * 100),
        currency: "PKR",
        raw: payload as Record<string, unknown>,
      });
    } catch (error) {
      logger.error({ err: error }, "EasyPaisa inquiry threw");
      return adapterFail("network_error", "Could not reach EasyPaisa.", true);
    }
  }

  async refund(input: RefundInput): Promise<AdapterResult<RefundResult>> {
    const { storeId } = this.credentials;
    const fields: Record<string, string> = {
      storeId,
      orderId: input.providerPaymentId,
      refundAmount: ((input.amountMinor ?? 0) / 100).toFixed(2),
    };
    fields.merchantHashedReq = this.signature(fields);

    try {
      const response = await fetchWithTimeout(`${EASYPAISA_TXN_API}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        timeoutMs: 20_000,
      });

      const payload = (await response.json()) as { responseCode?: string; responseDesc?: string };

      if (!response.ok || payload.responseCode !== "0000") {
        return adapterFail(
          payload.responseCode ?? `http_${response.status}`,
          payload.responseDesc ?? "EasyPaisa refund failed.",
          response.status >= 500,
        );
      }

      return adapterOk({
        providerRefundId: `${input.providerPaymentId}-R`,
        refundedMinor: input.amountMinor ?? 0,
        status: "succeeded",
      });
    } catch (error) {
      logger.error({ err: error }, "EasyPaisa refund threw");
      return adapterFail("network_error", "Could not reach EasyPaisa.", true);
    }
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<AdapterResult<WebhookEvent>> {
    const fields = Object.fromEntries(new URLSearchParams(input.rawBody)) as Record<string, string>;
    const provided = fields.merchantHashedReq;

    if (!provided) return adapterFail("missing_signature", "merchantHashedReq absent from callback.");
    if (this.signature(fields) !== provided) {
      return adapterFail("invalid_signature", "EasyPaisa hash mismatch.");
    }

    return adapterOk({
      type: fields.status === "0000" ? "payment.succeeded" : "payment.failed",
      providerPaymentId: fields.orderRefNumber ?? fields.orderRefNum,
      amountMinor: Math.round(Number(fields.transactionAmount ?? 0) * 100),
      raw: fields,
    });
  }

  async health(): Promise<AdapterHealth> {
    try {
      const response = await fetchWithTimeout(EASYPAISA_CHECKOUT_URL, {
        method: "HEAD",
        timeoutMs: 8_000,
      });
      return { driver: this.driver, healthy: response.status < 500, detail: `HTTP ${response.status}` };
    } catch (error) {
      return {
        driver: this.driver,
        healthy: false,
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }
}
