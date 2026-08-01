import { createHmac } from "node:crypto";

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
 * JazzCash (Pakistan) driver.
 *
 * JazzCash is a hosted-checkout provider: the server prepares a signed field
 * set, the patient is redirected to the JazzCash page, and the result comes
 * back as a signed POST. The signature ("secure hash") is an HMAC-SHA256 over
 * every non-empty field sorted by key and joined with `&`, prefixed by the
 * integrity salt — getting the ordering wrong is the classic integration bug,
 * so the canonicalisation lives in one place here.
 */

const JAZZCASH_CHECKOUT_URL =
  "https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform";
const JAZZCASH_STATUS_API =
  "https://payments.jazzcash.com.pk/ApplicationAPI/API/PaymentInquiry/Inquire";
const JAZZCASH_REFUND_API =
  "https://payments.jazzcash.com.pk/ApplicationAPI/API/Refund/DoRefund";

type JazzCashFields = Record<string, string>;

function jazzCashTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export class JazzCashPaymentAdapter implements PaymentAdapter {
  readonly driver = "jazzcash";
  readonly provider = "JAZZCASH" as const;

  private get credentials() {
    const merchantId = env.JAZZCASH_MERCHANT_ID;
    const password = env.JAZZCASH_PASSWORD;
    const salt = env.JAZZCASH_INTEGRITY_SALT;
    if (!merchantId || !password || !salt) {
      throw new Error("JazzCash credentials are not fully configured.");
    }
    return { merchantId, password, salt };
  }

  /**
   * Canonical secure hash: salt first, then every non-empty value ordered by
   * field name, joined with `&`.
   */
  private secureHash(fields: JazzCashFields): string {
    const { salt } = this.credentials;
    const canonical = Object.keys(fields)
      .filter((key) => key !== "pp_SecureHash")
      .sort()
      .map((key) => fields[key])
      .filter((value): value is string => Boolean(value && value.length > 0))
      .join("&");

    return createHmac("sha256", salt).update(`${salt}&${canonical}`).digest("hex").toUpperCase();
  }

  async createPayment(input: CreatePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    if (input.currency.toUpperCase() !== "PKR") {
      return adapterFail("unsupported_currency", "JazzCash settles in PKR only.");
    }

    const { merchantId, password } = this.credentials;
    const now = new Date();
    const expiry = new Date(now.getTime() + 60 * 60 * 1000);
    const txnRefNo = `T${jazzCashTimestamp(now)}${input.idempotencyKey.slice(0, 6).toUpperCase()}`;

    const fields: JazzCashFields = {
      pp_Version: "1.1",
      pp_TxnType: "MWALLET",
      pp_Language: "EN",
      pp_MerchantID: merchantId,
      pp_Password: password,
      pp_TxnRefNo: txnRefNo,
      // JazzCash expects the amount in paisa, which is already our storage unit.
      pp_Amount: String(input.amountMinor),
      pp_TxnCurrency: "PKR",
      pp_TxnDateTime: jazzCashTimestamp(now),
      pp_TxnExpiryDateTime: jazzCashTimestamp(expiry),
      pp_BillReference: input.appointmentId,
      pp_Description: input.description.slice(0, 100),
      pp_ReturnURL: input.returnUrl,
      ppmpf_1: input.patientId,
    };

    fields.pp_SecureHash = this.secureHash(fields);

    // The patient's browser must POST these fields to the hosted page, so the
    // form payload travels back to the caller inside `raw`.
    return adapterOk({
      providerPaymentId: txnRefNo,
      providerIntentId: txnRefNo,
      status: "requires_action",
      redirectUrl: JAZZCASH_CHECKOUT_URL,
      amountMinor: input.amountMinor,
      currency: "PKR",
      raw: { formAction: JAZZCASH_CHECKOUT_URL, formFields: fields },
    });
  }

  /** JazzCash captures at authorisation, so this is a status read-back. */
  async capturePayment(input: CapturePaymentInput): Promise<AdapterResult<PaymentIntent>> {
    return this.getPayment(input.providerPaymentId);
  }

  async getPayment(providerPaymentId: string): Promise<AdapterResult<PaymentIntent>> {
    const { merchantId, password } = this.credentials;
    const fields: JazzCashFields = {
      pp_TxnRefNo: providerPaymentId,
      pp_MerchantID: merchantId,
      pp_Password: password,
    };
    fields.pp_SecureHash = this.secureHash(fields);

    try {
      const response = await fetchWithTimeout(JAZZCASH_STATUS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        timeoutMs: 20_000,
      });

      const payload = (await response.json()) as {
        pp_ResponseCode?: string;
        pp_ResponseMessage?: string;
        pp_Amount?: string;
      };

      if (!response.ok) {
        return adapterFail(`http_${response.status}`, "JazzCash inquiry failed.", response.status >= 500);
      }

      return adapterOk({
        providerPaymentId,
        status: payload.pp_ResponseCode === "000" ? "succeeded" : "failed",
        amountMinor: Number(payload.pp_Amount ?? 0),
        currency: "PKR",
        raw: payload as Record<string, unknown>,
      });
    } catch (error) {
      logger.error({ err: error }, "JazzCash inquiry threw");
      return adapterFail("network_error", "Could not reach JazzCash.", true);
    }
  }

  async refund(input: RefundInput): Promise<AdapterResult<RefundResult>> {
    const { merchantId, password } = this.credentials;
    const fields: JazzCashFields = {
      pp_TxnRefNo: input.providerPaymentId,
      pp_MerchantID: merchantId,
      pp_Password: password,
      pp_Amount: String(input.amountMinor ?? 0),
    };
    fields.pp_SecureHash = this.secureHash(fields);

    try {
      const response = await fetchWithTimeout(JAZZCASH_REFUND_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        timeoutMs: 20_000,
      });

      const payload = (await response.json()) as {
        pp_ResponseCode?: string;
        pp_ResponseMessage?: string;
      };

      if (!response.ok || payload.pp_ResponseCode !== "000") {
        return adapterFail(
          payload.pp_ResponseCode ?? `http_${response.status}`,
          payload.pp_ResponseMessage ?? "JazzCash refund failed.",
          response.status >= 500,
        );
      }

      return adapterOk({
        providerRefundId: `${input.providerPaymentId}-R`,
        refundedMinor: input.amountMinor ?? 0,
        status: "succeeded",
      });
    } catch (error) {
      logger.error({ err: error }, "JazzCash refund threw");
      return adapterFail("network_error", "Could not reach JazzCash.", true);
    }
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<AdapterResult<WebhookEvent>> {
    const fields = Object.fromEntries(new URLSearchParams(input.rawBody)) as JazzCashFields;
    const provided = fields.pp_SecureHash;

    if (!provided) return adapterFail("missing_signature", "pp_SecureHash absent from callback.");
    if (this.secureHash(fields) !== provided.toUpperCase()) {
      return adapterFail("invalid_signature", "JazzCash secure hash mismatch.");
    }

    return adapterOk({
      type: fields.pp_ResponseCode === "000" ? "payment.succeeded" : "payment.failed",
      providerPaymentId: fields.pp_TxnRefNo,
      amountMinor: Number(fields.pp_Amount ?? 0),
      raw: fields,
    });
  }

  async health(): Promise<AdapterHealth> {
    try {
      const response = await fetchWithTimeout(JAZZCASH_CHECKOUT_URL, {
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
