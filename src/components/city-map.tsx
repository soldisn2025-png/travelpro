"use client";

import { useState } from "react";
import { Map as MapIcon } from "lucide-react";
import { dayColor } from "@/lib/map";
import { formatDate } from "@/lib/dates";

export function CityMap({
  cityStopId,
  city,
  dayDates,
  hasHotel,
  spotCount,
}: {
  cityStopId: string;
  city: string;
  dayDates: string[];
  hasHotel: boolean;
  spotCount: number;
}) {
  const [failed, setFailed] = useState(false);
  // Bust the cached image when the trip changes underneath it.
  const [version] = useState(() => Date.now());

  if (!spotCount && !hasHotel) return null;

  return (
    <section className="mt-4 border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <MapIcon size={16} className="text-zinc-500" />
        <h3 className="text-sm font-semibold text-zinc-950">{city} on the map</h3>
      </div>

      {failed ? (
        <p className="mt-3 text-xs text-zinc-500">
          The map could not be loaded. Verified spots need coordinates before
          they can be shown.
        </p>
      ) : (
        // next/image fetches server-side and would not carry the session
        // cookie this route requires, so a plain img is correct here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/map/${cityStopId}?v=${version}`}
          alt={`Map of verified spots in ${city}`}
          width={640}
          height={420}
          onError={() => setFailed(true)}
          className="mt-3 w-full max-w-full border border-zinc-100"
        />
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {hasHotel ? (
          <span className="flex items-center gap-1.5 text-xs text-zinc-600">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: "#111827" }}
            />
            Hotel
          </span>
        ) : null}
        {dayDates.map((date, index) => (
          <span key={date} className="flex items-center gap-1.5 text-xs text-zinc-600">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: dayColor(index) }}
            />
            {formatDate(date)}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-zinc-600">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: "#9e9e9e" }}
          />
          Not on a day yet
        </span>
      </div>
    </section>
  );
}
