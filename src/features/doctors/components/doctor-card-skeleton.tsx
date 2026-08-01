import { Card } from "@/components/ui/card";

/** Mirrors DoctorCard's geometry so the grid does not reflow on load. */
export function DoctorCardSkeleton() {
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start" aria-hidden>
      <div className="skeleton-shimmer size-16 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-3">
        <div className="skeleton-shimmer h-5 w-48 rounded" />
        <div className="skeleton-shimmer h-4 w-64 rounded" />
        <div className="skeleton-shimmer h-4 w-40 rounded" />
        <div className="flex gap-2">
          <div className="skeleton-shimmer h-5 w-20 rounded-full" />
          <div className="skeleton-shimmer h-5 w-24 rounded-full" />
        </div>
      </div>
      <div className="space-y-2 sm:w-44">
        <div className="skeleton-shimmer ml-auto h-6 w-24 rounded" />
        <div className="skeleton-shimmer ml-auto h-4 w-28 rounded" />
        <div className="skeleton-shimmer ml-auto h-9 w-full rounded-md sm:w-36" />
      </div>
    </Card>
  );
}
