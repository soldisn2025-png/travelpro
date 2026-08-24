"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, X } from "lucide-react";
import { clearHotel, setHotel } from "@/lib/actions";
import type { CityStop, PlaceCandidate } from "@/lib/types";
import { SubmitButton } from "@/components/submit-button";

export function HotelPicker({
  stop,
  tripId,
}: {
  stop: CityStop;
  tripId: string;
}) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<PlaceCandidate[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const hasLocation =
    stop.hotel_latitude !== null && stop.hotel_longitude !== null;

  async function search() {
    setError("");
    setPlaces([]);

    try {
      const response = await fetch("/api/places/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, city: stop.city }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Hotel search failed.");
        return;
      }

      if (!data.places?.length) {
        setError("No matching hotel found. Try the full property name.");
        return;
      }

      setPlaces(data.places);
    } catch {
      setError("Hotel search failed. Please try again.");
    }
  }

  return (
    <section className="mt-4 border border-emerald-100 bg-emerald-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Hotel
          </p>
          {hasLocation ? (
            <>
              <p className="mt-1 text-sm font-medium text-emerald-950">
                {stop.hotel_name}
              </p>
              <p className="mt-1 text-xs leading-4 text-emerald-800">
                {stop.hotel_address}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs leading-5 text-emerald-800">
              Set the hotel to plan each day from where you actually wake up.
            </p>
          )}
        </div>
        {hasLocation ? (
          <form action={clearHotel}>
            <input type="hidden" name="city_stop_id" value={stop.id} />
            <input type="hidden" name="trip_id" value={tripId} />
            <button
              title="Clear hotel"
              className="inline-flex h-8 w-8 items-center justify-center border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-100"
            >
              <X size={14} />
            </button>
          </form>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={hasLocation ? "Change hotel" : "Hotel name"}
          className="h-9 min-w-0 flex-1 border border-emerald-200 bg-white px-2 text-sm"
        />
        <button
          type="button"
          onClick={() => startTransition(search)}
          disabled={isPending || query.trim().length < 2}
          className="inline-flex h-9 items-center gap-1 bg-emerald-700 px-3 text-xs font-medium text-white disabled:bg-emerald-300"
        >
          <BedDouble size={14} />
          {isPending ? "Searching..." : "Find"}
        </button>
      </div>

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

      <div className="mt-3 grid gap-2">
        {places.map((place) => (
          <form
            key={place.placeId}
            action={async (formData) => {
              await setHotel(formData);
              setPlaces([]);
              setQuery("");
              router.refresh();
            }}
            className="flex items-start justify-between gap-3 border border-emerald-100 bg-white p-2"
          >
            <input type="hidden" name="city_stop_id" value={stop.id} />
            <input type="hidden" name="trip_id" value={tripId} />
            <input type="hidden" name="hotel_place_id" value={place.placeId} />
            <input type="hidden" name="hotel_name" value={place.name} />
            <input type="hidden" name="hotel_address" value={place.address} />
            <input type="hidden" name="hotel_latitude" value={place.latitude} />
            <input type="hidden" name="hotel_longitude" value={place.longitude} />
            <div>
              <p className="text-xs font-medium text-emerald-950">{place.name}</p>
              <p className="mt-1 text-xs leading-4 text-emerald-800">
                {place.address}
              </p>
            </div>
            <SubmitButton
              pendingText="Saving..."
              className="h-7 border border-emerald-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400"
            >
              Use
            </SubmitButton>
          </form>
        ))}
      </div>
    </section>
  );
}
