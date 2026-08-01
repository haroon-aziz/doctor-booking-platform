"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const SORT_OPTIONS = [
  { value: "relevance", label: "Most relevant" },
  { value: "earliest_available", label: "Soonest available" },
  { value: "rating_desc", label: "Highest rated" },
  { value: "experience_desc", label: "Most experienced" },
  { value: "fee_asc", label: "Lowest fee" },
  { value: "fee_desc", label: "Highest fee" },
];

export function DoctorSort() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Sort by</span>
      <select
        value={searchParams.get("sort") ?? "relevance"}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("sort", event.target.value);
          params.delete("page");
          router.push(`${pathname}?${params}`, { scroll: false });
        }}
        className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
