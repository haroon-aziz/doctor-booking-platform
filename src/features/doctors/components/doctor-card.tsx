import { Clock, MapPin, ShieldCheck, Star, Video } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DoctorSummary } from "@/features/doctors/domain/doctor";
import { formatMoney } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";

const MODE_LABEL: Record<string, string> = {
  IN_PERSON: "In person",
  VIDEO: "Video",
  PHONE: "Phone",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** "in 4 hours" / "Tomorrow" / "Thu 14 Aug" — whichever is most useful. */
function formatAvailability(iso: string | null): string {
  if (!iso) return "No open slots";

  const target = new Date(iso);
  const hours = (target.getTime() - Date.now()) / 3_600_000;

  if (hours < 1) return "Available now";
  if (hours < 24) return `Today, ${target.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  if (hours < 48) return `Tomorrow, ${target.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

  return target.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function DoctorCard({ doctor }: { doctor: DoctorSummary }) {
  const available = doctor.isAcceptingPatients && doctor.nextAvailableAt !== null;

  return (
    <Card className="flex flex-col gap-4 p-5 transition-shadow hover:shadow-md sm:flex-row sm:items-start">
      <div
        aria-hidden
        className="grid size-16 shrink-0 place-items-center rounded-xl bg-accent text-lg font-semibold text-accent-foreground"
      >
        {initials(doctor.fullName)}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-base font-semibold">
            <Link href={`/doctors/${doctor.slug}`} className="hover:underline">
              {doctor.title} {doctor.fullName}
            </Link>
          </h3>
          {doctor.isVerified && (
            <Badge variant="success" title="Credentials verified by MediBook">
              <ShieldCheck aria-hidden />
              Verified
            </Badge>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{doctor.headline}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1 font-medium">
            <Star aria-hidden className="size-4 fill-warning text-warning" />
            {doctor.ratingAverage.toFixed(1)}
            <span className="font-normal text-muted-foreground">({doctor.ratingCount})</span>
          </span>
          <span className="text-muted-foreground">{doctor.yearsOfExperience} yrs experience</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MapPin aria-hidden className="size-4" />
            {doctor.city}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {doctor.specialties.slice(0, 3).map((specialty) => (
            <Badge key={specialty} variant="secondary">
              {specialty}
            </Badge>
          ))}
          {doctor.modes.includes("VIDEO") && (
            <Badge variant="outline">
              <Video aria-hidden />
              {MODE_LABEL.VIDEO}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-44 sm:items-end sm:text-right">
        <div>
          <p className="text-xs text-muted-foreground">From</p>
          <p className="text-lg font-semibold">
            {formatMoney(doctor.fromFeeMinor, doctor.currency)}
          </p>
        </div>

        <p
          className={cn(
            "inline-flex items-center gap-1 text-xs sm:justify-end",
            available ? "text-success" : "text-muted-foreground",
          )}
        >
          <Clock aria-hidden className="size-3.5" />
          {doctor.isAcceptingPatients ? formatAvailability(doctor.nextAvailableAt) : "Not accepting patients"}
        </p>

        <Button asChild size="sm" disabled={!available} className="w-full sm:w-auto">
          <Link href={`/doctors/${doctor.slug}${available ? "#book" : ""}`}>
            {available ? "Book appointment" : "View profile"}
          </Link>
        </Button>
      </div>
    </Card>
  );
}
