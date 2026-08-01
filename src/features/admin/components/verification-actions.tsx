"use client";

import { AlertCircle, Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  approveDoctorAction,
  rejectDoctorAction,
} from "@/features/admin/actions/verification.actions";

/**
 * Approve / reject controls for one doctor.
 *
 * Rejection opens an inline reason field rather than firing immediately: the
 * server requires a reason, and a destructive action taken on a single click
 * with no chance to reconsider is the wrong default for a decision that removes
 * someone's livelihood from the platform.
 */
export function VerificationActions({
  doctorId,
  doctorName,
}: {
  doctorId: string;
  doctorName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"idle" | "rejecting">("idle");
  const [pending, setPending] = React.useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = React.useState("");
  const [allowResubmit, setAllowResubmit] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  async function approve() {
    setPending("approve");
    setError(null);

    const result = await approveDoctorAction({ doctorId });
    setPending(null);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
  }

  async function reject() {
    setPending("reject");
    setError(null);

    const result = await rejectDoctorAction({ doctorId, reason, allowResubmit });
    setPending(null);

    if (!result.ok) {
      setError(result.error.fieldErrors?.reason?.[0] ?? result.error.message);
      return;
    }
    setMode("idle");
    setReason("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {mode === "idle" ? (
        <div className="flex gap-2">
          <Button size="sm" variant="success" onClick={() => void approve()} disabled={pending !== null}>
            {pending === "approve" ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("rejecting")} disabled={pending !== null}>
            <X aria-hidden />
            Reject
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Reason for rejecting {doctorName}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. The uploaded licence has expired. Please upload a current PMC registration certificate."
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-xs text-muted-foreground">
              This is sent to the doctor, so write it as feedback they can act on.
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowResubmit}
              onChange={(event) => setAllowResubmit(event.target.checked)}
              className="size-4 rounded border-input accent-[hsl(var(--primary))]"
            />
            Allow them to fix the issue and resubmit
          </label>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void reject()}
              disabled={pending !== null || reason.trim().length < 10}
            >
              {pending === "reject" && <Loader2 aria-hidden className="animate-spin" />}
              Confirm rejection
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode("idle");
                setError(null);
              }}
              disabled={pending !== null}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
