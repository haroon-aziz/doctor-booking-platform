"use client";

import { AlertCircle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { saveScheduleAction } from "@/features/doctor-portal/actions/schedule.actions";
import type { AvailabilityRuleRow } from "@/features/doctor-portal/repositories/doctor-portal.repository";
import { cn } from "@/lib/utils/cn";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MODE_LABEL: Record<string, string> = {
  IN_PERSON: "In person",
  VIDEO: "Video",
  PHONE: "Phone",
};

interface EditableRule {
  key: string;
  clinicId: string | null;
  mode: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  slotDurationMinutes: number;
  breakStartMinute: number | null;
  breakEndMinute: number | null;
}

function toTimeValue(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

function fromTimeValue(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

interface ScheduleEditorProps {
  initialRules: AvailabilityRuleRow[];
  clinics: { id: string; name: string }[];
  supportedModes: string[];
}

export function ScheduleEditor({ initialRules, clinics, supportedModes }: ScheduleEditorProps) {
  const [rules, setRules] = React.useState<EditableRule[]>(() =>
    initialRules.map((rule, index) => ({
      key: `${rule.id}-${index}`,
      clinicId: rule.clinicId,
      mode: rule.mode,
      dayOfWeek: rule.dayOfWeek,
      startMinute: rule.startMinute,
      endMinute: rule.endMinute,
      slotDurationMinutes: rule.slotDurationMinutes,
      breakStartMinute: rule.breakStartMinute,
      breakEndMinute: rule.breakEndMinute,
    })),
  );

  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState<
    { kind: "ok"; message: string } | { kind: "error"; message: string } | null
  >(null);

  function update(key: string, patch: Partial<EditableRule>) {
    setRules((current) =>
      current.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)),
    );
    setFeedback(null);
  }

  function addRule(dayOfWeek: number) {
    setRules((current) => [
      ...current,
      {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        clinicId: supportedModes[0] === "IN_PERSON" ? (clinics[0]?.id ?? null) : null,
        mode: supportedModes[0] ?? "IN_PERSON",
        dayOfWeek,
        startMinute: 9 * 60,
        endMinute: 13 * 60,
        slotDurationMinutes: 30,
        breakStartMinute: null,
        breakEndMinute: null,
      },
    ]);
    setFeedback(null);
  }

  async function save() {
    setSaving(true);
    setFeedback(null);

    const result = await saveScheduleAction({
      rules: rules.map((rule) => ({
        clinicId: rule.mode === "IN_PERSON" ? rule.clinicId : null,
        mode: rule.mode,
        dayOfWeek: rule.dayOfWeek,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        slotDurationMinutes: rule.slotDurationMinutes,
        breakStartMinute: rule.breakStartMinute,
        breakEndMinute: rule.breakEndMinute,
      })),
    });

    setSaving(false);

    if (!result.ok) {
      setFeedback({ kind: "error", message: result.error.message });
      return;
    }

    setFeedback({
      kind: "ok",
      message: `Schedule saved. ${result.data.slots} bookable slots generated for the next 60 days.`,
    });
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            feedback.kind === "ok"
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {feedback.kind === "ok" ? (
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          {feedback.message}
        </div>
      )}

      <div className="space-y-4">
        {DAYS.map((dayName, dayIndex) => {
          const dayRules = rules.filter((rule) => rule.dayOfWeek === dayIndex);

          return (
            <div key={dayName} className="rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{dayName}</h3>
                  {dayRules.length === 0 ? (
                    <Badge variant="secondary">Not working</Badge>
                  ) : (
                    <Badge variant="success">
                      {dayRules.length} period{dayRules.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => addRule(dayIndex)}>
                  <Plus aria-hidden />
                  Add hours
                </Button>
              </div>

              {dayRules.length > 0 && (
                <ul className="divide-y">
                  {dayRules.map((rule) => (
                    <li key={rule.key} className="grid gap-3 p-4 sm:grid-cols-[repeat(5,1fr)_auto]">
                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">Type</span>
                        <select
                          value={rule.mode}
                          onChange={(event) => update(rule.key, { mode: event.target.value })}
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        >
                          {supportedModes.map((mode) => (
                            <option key={mode} value={mode}>
                              {MODE_LABEL[mode] ?? mode}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">From</span>
                        <input
                          type="time"
                          value={toTimeValue(rule.startMinute)}
                          onChange={(event) =>
                            update(rule.key, { startMinute: fromTimeValue(event.target.value) })
                          }
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        />
                      </label>

                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">To</span>
                        <input
                          type="time"
                          value={toTimeValue(rule.endMinute)}
                          onChange={(event) =>
                            update(rule.key, { endMinute: fromTimeValue(event.target.value) })
                          }
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        />
                      </label>

                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">Slot length</span>
                        <select
                          value={rule.slotDurationMinutes}
                          onChange={(event) =>
                            update(rule.key, { slotDurationMinutes: Number(event.target.value) })
                          }
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        >
                          {[10, 15, 20, 30, 45, 60].map((minutes) => (
                            <option key={minutes} value={minutes}>
                              {minutes} min
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">Break</span>
                        <div className="flex gap-1">
                          <input
                            type="time"
                            value={
                              rule.breakStartMinute === null
                                ? ""
                                : toTimeValue(rule.breakStartMinute)
                            }
                            onChange={(event) =>
                              update(rule.key, {
                                breakStartMinute: event.target.value
                                  ? fromTimeValue(event.target.value)
                                  : null,
                              })
                            }
                            className="h-9 w-full rounded-md border bg-background px-1 text-xs"
                          />
                          <input
                            type="time"
                            value={
                              rule.breakEndMinute === null ? "" : toTimeValue(rule.breakEndMinute)
                            }
                            onChange={(event) =>
                              update(rule.key, {
                                breakEndMinute: event.target.value
                                  ? fromTimeValue(event.target.value)
                                  : null,
                              })
                            }
                            className="h-9 w-full rounded-md border bg-background px-1 text-xs"
                          />
                        </div>
                      </label>

                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${dayName} period`}
                        onClick={() =>
                          setRules((current) => current.filter((item) => item.key !== rule.key))
                        }
                        className="self-end text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4">
        <p className="text-sm text-muted-foreground">
          Saving regenerates your open slots for the next 60 days. Booked and reserved
          appointments are never removed.
        </p>
        <Button onClick={() => void save()} disabled={saving} size="lg">
          {saving && <Loader2 aria-hidden className="animate-spin" />}
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}
