"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cancelAppointmentAction } from "@/features/booking/actions/booking.actions";

/**
 * Cancellation, with the refund consequence stated before the click rather
 * than discovered afterwards.
 */
export function CancelAppointment({
  appointmentId,
  hoursUntilStart,
  freeWindowHours,
}: {
  appointmentId: string;
  hoursUntilStart: number;
  freeWindowHours: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const refundable = hoursUntilStart >= freeWindowHours;

  async function cancel() {
    setPending(true);
    setError(null);

    const result = await cancelAppointmentAction({ appointmentId, reason });
    setPending(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    router.refresh();
  }

  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        Cancel appointment
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div>
        <p className="font-medium">Cancel this appointment?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {refundable
            ? "You are within the free cancellation window, so you will be refunded in full."
            : `Cancellations inside ${freeWindowHours} hours of the start time are not automatically refunded. You can contact support to request one.`}
        </p>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          Reason <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div className="flex gap-2">
        <Button variant="destructive" onClick={() => void cancel()} disabled={pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Yes, cancel it
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          Keep appointment
        </Button>
      </div>
    </div>
  );
}
