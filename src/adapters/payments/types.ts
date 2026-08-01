import type { Adapter, AdapterResult } from "@/adapters/types";
import type { PaymentProvider } from "@/generated/prisma/enums";

export interface CreatePaymentInput {
  /** Integer minor units — see `src/lib/utils/money.ts`. */
  amountMinor: number;
  currency: string;
  appointmentId: string;
  patientId: string;
  description: string;
  /**
   * Caller-generated key that makes retries safe. The same key must never
   * result in two charges, which matters most on a flaky mobile connection
   * where the patient taps "Pay" twice.
   */
  idempotencyKey: string;
  returnUrl: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntent {
  providerPaymentId: string;
  providerIntentId?: string;
  status: "requires_action" | "processing" | "succeeded" | "failed";
  /** Set when the provider needs the patient to complete a hosted flow. */
  redirectUrl?: string;
  clientSecret?: string;
  amountMinor: number;
  currency: string;
  raw?: Record<string, unknown>;
}

export interface CapturePaymentInput {
  providerPaymentId: string;
  amountMinor: number;
}

export interface RefundInput {
  providerPaymentId: string;
  /** Omit to refund the full remaining amount. */
  amountMinor?: number;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  refundedMinor: number;
  status: "pending" | "succeeded" | "failed";
}

export interface WebhookVerificationInput {
  rawBody: string;
  signature: string | null;
  headers: Record<string, string>;
}

export interface WebhookEvent {
  type: "payment.succeeded" | "payment.failed" | "refund.succeeded" | "unknown";
  providerPaymentId?: string;
  amountMinor?: number;
  raw: Record<string, unknown>;
}

export interface PaymentAdapter extends Adapter {
  readonly provider: PaymentProvider;
  createPayment(input: CreatePaymentInput): Promise<AdapterResult<PaymentIntent>>;
  capturePayment(input: CapturePaymentInput): Promise<AdapterResult<PaymentIntent>>;
  getPayment(providerPaymentId: string): Promise<AdapterResult<PaymentIntent>>;
  refund(input: RefundInput): Promise<AdapterResult<RefundResult>>;
  verifyWebhook(input: WebhookVerificationInput): Promise<AdapterResult<WebhookEvent>>;
}
