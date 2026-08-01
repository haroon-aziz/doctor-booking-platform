import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Percentage change against the previous period. */
  deltaPercent?: number | null;
  hint?: string;
  /** Set when a downward move is the good outcome (cancellations, no-shows). */
  invertDelta?: boolean;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  deltaPercent,
  hint,
  invertDelta = false,
}: StatCardProps) {
  const hasDelta = deltaPercent !== undefined && deltaPercent !== null && Number.isFinite(deltaPercent);
  const rising = hasDelta && deltaPercent > 0;
  const good = invertDelta ? !rising : rising;

  return (
    <Card>
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <Icon aria-hidden className="size-4 text-muted-foreground" />
        </div>

        <p className="text-2xl font-semibold tabular-nums">{value}</p>

        {hasDelta && deltaPercent !== 0 ? (
          <p
            className={cn(
              "flex items-center gap-1 text-xs",
              good ? "text-success" : "text-destructive",
            )}
          >
            {rising ? (
              <TrendingUp aria-hidden className="size-3.5" />
            ) : (
              <TrendingDown aria-hidden className="size-3.5" />
            )}
            {Math.abs(deltaPercent).toFixed(0)}% vs last month
          </p>
        ) : (
          hint && <p className="text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
