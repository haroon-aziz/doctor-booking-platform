"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DoctorSearchResult } from "@/features/doctors/domain/doctor";
import { cn } from "@/lib/utils/cn";

/**
 * Filters are URL state, not component state. That makes every result set
 * shareable and bookmarkable, keeps the back button meaningful, and means the
 * server component re-renders with fresh data instead of the client holding a
 * divergent copy.
 */

interface DoctorFiltersProps {
  facets: DoctorSearchResult["facets"];
  total: number;
}

const RATING_OPTIONS = [
  { value: "4.5", label: "4.5+" },
  { value: "4", label: "4.0+" },
  { value: "3.5", label: "3.5+" },
];

const EXPERIENCE_OPTIONS = [
  { value: "5", label: "5+ years" },
  { value: "10", label: "10+ years" },
  { value: "15", label: "15+ years" },
];

const GENDER_OPTIONS = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
];

export function DoctorFilters({ facets, total }: DoctorFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === "" || params.get(key) === value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      // Any filter change invalidates the current page number.
      params.delete("page");
      router.push(`${pathname}?${params}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const activeCount = ["city", "specialty", "language", "mode", "gender", "minRating", "minExperience", "availableToday"].filter(
    (key) => searchParams.get(key),
  ).length;

  function FilterGroup({
    title,
    paramKey,
    options,
  }: {
    title: string;
    paramKey: string;
    options: { value: string; label: string; count?: number }[];
  }) {
    if (options.length === 0) return null;
    const current = searchParams.get(paramKey);

    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{title}</legend>
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const selected = current === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setParam(paramKey, option.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {option.label}
                {option.count !== undefined && (
                  <span className={cn("ml-1", selected ? "opacity-80" : "text-muted-foreground")}>
                    {option.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <aside className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{total}</span>{" "}
          {total === 1 ? "doctor" : "doctors"}
        </p>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(pathname, { scroll: false })}
            >
              <X aria-hidden />
              Clear
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <SlidersHorizontal aria-hidden />
            Filters
            {activeCount > 0 && <Badge variant="default">{activeCount}</Badge>}
          </Button>
        </div>
      </div>

      <div className={cn("space-y-5 rounded-xl border bg-card p-4", !open && "hidden lg:block")}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={searchParams.get("availableToday") === "true"}
            onChange={(event) => setParam("availableToday", event.target.checked ? "true" : null)}
            className="size-4 rounded border-input accent-[hsl(var(--primary))]"
          />
          Available in the next 24 hours
        </label>

        <FilterGroup title="Consultation type" paramKey="mode" options={facets.modes} />
        <FilterGroup title="Specialty" paramKey="specialty" options={facets.specialties} />
        <FilterGroup title="City" paramKey="city" options={facets.cities} />
        <FilterGroup title="Language" paramKey="language" options={facets.languages} />
        <FilterGroup title="Minimum rating" paramKey="minRating" options={RATING_OPTIONS} />
        <FilterGroup title="Experience" paramKey="minExperience" options={EXPERIENCE_OPTIONS} />
        <FilterGroup title="Doctor's gender" paramKey="gender" options={GENDER_OPTIONS} />
      </div>
    </aside>
  );
}
