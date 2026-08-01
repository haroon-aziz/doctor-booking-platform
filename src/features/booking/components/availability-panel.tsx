"use client";

import { CalendarX2, Clock } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DoctorAvailability } from "@/features/booking/domain/slot";
import type { ConsultationMode } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/money";

const MODE_LABEL: Record<ConsultationMode, string> = {
  IN_PERSON: "In person",
  VIDEO: "Video",
  PHONE: "Phone",
};

interface AvailabilityPanelProps {
  doctorSlug: string;
  availability: DoctorAvailability;
  modes: ConsultationMode[];
  feesByMode: Partial<Record<ConsultationMode, number>>;
  currency: string;
}

export function AvailabilityPanel({
  doctorSlug,
  availability,
  modes,
  feesByMode,
  currency,
}: AvailabilityPanelProps) {
  const [mode, setMode] = React.useState<ConsultationMode>(modes[0] ?? "IN_PERSON");
  // `null` means "follow the first day that has availability". Landing the
  // patient on an empty today, when tomorrow is open, reads as no availability
  // at all — so an explicit pick is only stored once they make one.
  const [pickedDay, setPickedDay] = React.useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);

  const daysWithSlots = availability.days.filter((day) =>
    day.slots.some((slot) => slot.mode === mode),
  );

  const firstOpenDay = React.useMemo(
    () => availability.days.findIndex((day) => day.slots.some((slot) => slot.mode === mode)),
    [availability.days, mode],
  );

  const selectedDay = pickedDay ?? Math.max(0, firstOpenDay);
  const activeDay = availability.days[selectedDay];
  const slots = (activeDay?.slots ?? []).filter((slot) => slot.mode === mode);

  const timeFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: availability.timezone,
        hour: "2-digit",
        minute: "2-digit",
      }),
    [availability.timezone],
  );

  return (
    <div className="space-y-4">
      {modes.length > 1 && (
        <div role="tablist" aria-label="Consultation type" className="flex gap-1 rounded-lg bg-muted p-1">
          {modes.map((option) => (
            <button
              key={option}
              role="tab"
              aria-selected={mode === option}
              onClick={() => {
                setMode(option);
                setPickedDay(null);
                setSelectedSlot(null);
              }}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {MODE_LABEL[option]}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Consultation fee</span>
        <span className="text-xl font-semibold">
          {formatMoney(feesByMode[mode] ?? 0, currency)}
        </span>
      </div>

      {daysWithSlots.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center">
          <CalendarX2 aria-hidden className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No {MODE_LABEL[mode].toLowerCase()} slots open</p>
          <p className="text-xs text-muted-foreground">
            Try another consultation type, or check back tomorrow.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {availability.days.map((day, index) => {
              const count = day.slots.filter((slot) => slot.mode === mode).length;
              const disabled = count === 0;
              return (
                <button
                  key={day.dateKey}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selectedDay === index}
                  onClick={() => {
                    setPickedDay(index);
                    setSelectedSlot(null);
                  }}
                  className={cn(
                    "min-w-[4.5rem] shrink-0 rounded-lg border px-2 py-2 text-center text-xs transition-colors",
                    selectedDay === index
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                    disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                  )}
                >
                  <span className="block font-medium">{day.weekdayLabel}</span>
                  <span className="block opacity-80">{day.dayLabel}</span>
                  <span className="mt-0.5 block text-[10px] opacity-70">
                    {count > 0 ? `${count} slot${count === 1 ? "" : "s"}` : "—"}
                  </span>
                </button>
              );
            })}
          </div>

          {slots.length > 0 ? (
            <div
              role="radiogroup"
              aria-label="Available times"
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            >
              {slots.map((slot) => {
                const active = selectedSlot === slot.id;
                return (
                  <button
                    key={slot.id}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelectedSlot(slot.id)}
                    className={cn(
                      "rounded-md border py-2 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:border-primary/50 hover:bg-accent",
                    )}
                  >
                    {timeFormatter.format(new Date(slot.startsAt))}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nothing open on this day.
            </p>
          )}
        </>
      )}

      <Button asChild={Boolean(selectedSlot)} className="w-full" size="lg" disabled={!selectedSlot}>
        {selectedSlot ? (
          <a href={`/book/${doctorSlug}?slot=${selectedSlot}&mode=${mode}`}>Continue to booking</a>
        ) : (
          <span>Select a time</span>
        )}
      </Button>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Clock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Times shown in {availability.timezone.replace("_", " ")}. Your slot is held for 10 minutes
        once you continue.
      </p>

      {availability.totalOpenSlots > 0 && (
        <Badge variant="secondary" className="w-full justify-center">
          {availability.totalOpenSlots} open slots in the next {availability.days.length} days
        </Badge>
      )}
    </div>
  );
}
