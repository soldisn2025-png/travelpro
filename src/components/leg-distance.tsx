"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car } from "lucide-react";
import type { TravelLeg } from "@/lib/types";

function describe(leg: TravelLeg) {
  if (leg.duration_minutes === null) return null;

  const hours = Math.floor(leg.duration_minutes / 60);
  const minutes = leg.duration_minutes % 60;
  const time = hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  const miles = leg.distance_meters
    ? ` · ${Math.round(leg.distance_meters / 1609)} mi`
    : "";

  return `${time} driving${miles}`;
}

export function LegDistance({ leg }: { leg: TravelLeg }) {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const summary = describe(leg);

  async function measure() {
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch(`/api/legs/${leg.id}`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not measure this leg.");
        return;
      }

      router.refresh();
    } catch {
      setError("Could not measure this leg. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={measure}
        disabled={isLoading}
        className="inline-flex h-8 items-center gap-2 border border-sky-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400"
      >
        <Car size={13} />
        {isLoading ? "Measuring..." : summary ? "Re-measure" : "Drive time"}
      </button>
      {summary ? (
        <span className="text-xs font-medium text-sky-900">{summary}</span>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
