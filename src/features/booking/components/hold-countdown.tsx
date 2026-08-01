"use client";

import { Timer } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Counts a slot hold down to zero.
 *
 * Driven by an absolute expiry timestamp rather than a decrementing counter, so
 * a backgrounded tab (where browsers throttle timers to once a minute) shows
 * the correct remaining time the moment it is focused again.
 */
export function HoldCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string;
  onExpire?: () => void;
}) {
  const expiryMs = React.useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [remainingMs, setRemainingMs] = React.useState(() => expiryMs - Date.now());
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    const tick = () => {
      const next = expiryMs - Date.now();
      setRemainingMs(next);

      if (next <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    };

    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [expiryMs, onExpire]);

  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const urgent = totalSeconds <= 60;
  const expired = totalSeconds === 0;

  return (
    <div
      role="timer"
      aria-live={urgent ? "assertive" : "off"}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        expired
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : urgent
            ? "border-warning/40 bg-warning/10 text-warning"
            : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <Timer aria-hidden className="size-4 shrink-0" />
      {expired ? (
        <span>Your reservation has expired. Please choose a time again.</span>
      ) : (
        <span>
          Slot reserved for{" "}
          <strong className="tabular-nums">
            {minutes}:{seconds.toString().padStart(2, "0")}
          </strong>
        </span>
      )}
    </div>
  );
}
