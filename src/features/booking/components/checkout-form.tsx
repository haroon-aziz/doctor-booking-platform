"use client";

import { AlertCircle, CheckCircle2, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmBookingAction,
  holdSlotAction,
  releaseSlotAction,
} from "@/features/booking/actions/booking.actions";
import { HoldCountdown } from "@/features/booking/components/hold-countdown";
import { formatMoney } from "@/lib/utils/money";

interface CheckoutFormProps {
  slotId: string;
  priceMinor: number;
  currency: string;
}

type Phase = "acquiring" | "held" | "submitting" | "expired" | "failed" | "done";

export function CheckoutForm({ slotId, priceMinor, currency }: CheckoutFormProps) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>("acquiring");
  const [hold, setHold] = React.useState<{ token: string; expiresAt: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [coupon, setCoupon] = React.useState("");

  const holdRef = React.useRef<{ token: string } | null>(null);

  // Take the hold as soon as checkout opens, so the countdown the patient sees
  // reflects a reservation that actually exists server-side.
  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await holdSlotAction({ slotId });
      if (cancelled) return;

      if (!result.ok) {
        setPhase("failed");
        setError(result.error.message);
        return;
      }

      holdRef.current = { token: result.data.holdToken };
      setHold({ token: result.data.holdToken, expiresAt: result.data.expiresAt });
      setPhase("held");
    })();

    return () => {
      cancelled = true;
    };
  }, [slotId]);

  // Releasing on unmount returns the slot immediately instead of making the
  // next patient wait out the full TTL.
  React.useEffect(() => {
    return () => {
      const current = holdRef.current;
      if (current) void releaseSlotAction(slotId, current.token);
    };
  }, [slotId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hold || phase === "submitting") return;

    setPhase("submitting");
    setError(null);

    const result = await confirmBookingAction({
      slotId,
      holdToken: hold.token,
      reasonForVisit: reason,
      patientNotes: notes,
      couponCode: coupon,
    });

    if (!result.ok) {
      setPhase(result.error.code === "SLOT_HOLD_EXPIRED" ? "expired" : "failed");
      setError(result.error.message);
      return;
    }

    // The hold is consumed by a successful booking; clearing the ref stops the
    // unmount cleanup from releasing a slot that is now legitimately booked.
    holdRef.current = null;
    setPhase("done");

    if (result.data.requiresPaymentAction && result.data.redirectUrl) {
      window.location.href = result.data.redirectUrl;
      return;
    }

    router.push(`/appointments/${result.data.appointmentId}?booked=1`);
  }

  if (phase === "acquiring") {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-4 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Reserving this time slot…
      </div>
    );
  }

  if (phase === "failed" && !hold) {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error ?? "This slot could not be reserved."}
        </div>
        <Button variant="outline" className="w-full" onClick={() => router.back()}>
          Choose another time
        </Button>
      </div>
    );
  }

  const expired = phase === "expired";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {hold && (
        <HoldCountdown
          expiresAt={hold.expiresAt}
          onExpire={() => setPhase((current) => (current === "done" ? current : "expired"))}
        />
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="reason">Reason for visit</Label>
        <Input
          id="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Chest pain follow-up"
          maxLength={200}
          disabled={expired}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">
          Anything the doctor should know{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          maxLength={2000}
          disabled={expired}
          placeholder="Current medication, symptoms, previous test results…"
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="coupon">Discount code</Label>
        <Input
          id="coupon"
          value={coupon}
          onChange={(event) => setCoupon(event.target.value.toUpperCase())}
          placeholder="FIRSTVISIT"
          maxLength={32}
          disabled={expired}
          className="uppercase"
        />
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <span className="text-sm text-muted-foreground">Total due</span>
        <span className="text-2xl font-semibold">{formatMoney(priceMinor, currency)}</span>
      </div>

      {expired ? (
        <Button type="button" className="w-full" size="lg" onClick={() => router.back()}>
          Choose another time
        </Button>
      ) : (
        <Button type="submit" className="w-full" size="lg" disabled={phase === "submitting"}>
          {phase === "submitting" ? (
            <>
              <Loader2 aria-hidden className="animate-spin" />
              Confirming…
            </>
          ) : phase === "done" ? (
            <>
              <CheckCircle2 aria-hidden />
              Booked
            </>
          ) : (
            <>
              <Lock aria-hidden />
              Confirm and pay
            </>
          )}
        </Button>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Free cancellation up to 24 hours before your appointment.
      </p>
    </form>
  );
}
