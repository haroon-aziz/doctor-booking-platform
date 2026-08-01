"use client";

import { MapPin, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";

const CITIES = ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Peshawar", "Multan"];

/**
 * The hero search. It is a real <form> with a GET-style submit so the query
 * lands in the URL — a shared or bookmarked search must reproduce the same
 * results, and it keeps working before hydration.
 */
export function HomeSearchBar() {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [city, setCity] = React.useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (city) params.set("city", city);
    router.push(`/doctors${params.size > 0 ? `?${params}` : ""}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-xl border bg-card p-2 shadow-sm sm:flex-row sm:items-center"
    >
      <div className="flex flex-1 items-center gap-2 px-2">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Doctor, specialty or condition"
          aria-label="Search for a doctor, specialty or condition"
          className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex items-center gap-2 border-t px-2 sm:border-l sm:border-t-0">
        <MapPin aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <select
          name="city"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          aria-label="City"
          className="h-10 w-full bg-transparent text-sm outline-none sm:w-36"
        >
          <option value="">Any city</option>
          {CITIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" size="lg" className="sm:w-auto">
        Search
      </Button>
    </form>
  );
}
