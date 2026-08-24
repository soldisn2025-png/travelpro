"use client";

import { useState, useTransition } from "react";
import { MapPin, X } from "lucide-react";
import { deleteSpot, verifySpot } from "@/lib/actions";
import type { PlaceCandidate, Spot } from "@/lib/types";
import { SubmitButton } from "@/components/submit-button";

function storedAlternates(spot: Spot): PlaceCandidate[] {
  const alternates = (spot.source_metadata as { alternates?: unknown })?.alternates;
  return Array.isArray(alternates) ? (alternates as PlaceCandidate[]) : [];
}

export function PlaceVerifier({ spot, city }: { spot: Spot; city: string }) {
  // Generation already fetched the options, so show them straight away rather
  // than making the user press Search first.
  const [places, setPlaces] = useState<PlaceCandidate[]>(() =>
    storedAlternates(spot),
  );
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function search() {
    setError("");
    const response = await fetch("/api/places/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: spot.name, city }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Place search failed.");
      return;
    }
    setPlaces(data.places ?? []);
  }

  return (
    <div className="border border-zinc-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-950">{spot.name}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {spot.category} · {spot.duration_minutes} min · {spot.indoor_outdoor}
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Google returned more than one likely match. Pick the right one.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => startTransition(search)}
            className="inline-flex h-8 items-center gap-1 bg-zinc-950 px-2 text-xs font-medium text-white"
          >
            <MapPin size={14} />
            {isPending ? "Searching..." : "Search again"}
          </button>
          <form action={deleteSpot}>
            <input type="hidden" name="spot_id" value={spot.id} />
            <button
              title="Delete candidate"
              className="inline-flex h-8 w-8 items-center justify-center border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100"
            >
              <X size={14} />
            </button>
          </form>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <div className="mt-3 grid gap-2">
        {places.map((place) => (
          <form
            key={place.placeId}
            action={verifySpot}
            className="flex items-start justify-between gap-3 border border-zinc-100 bg-zinc-50 p-2"
          >
            <input type="hidden" name="spot_id" value={spot.id} />
            <input type="hidden" name="google_place_id" value={place.placeId} />
            <input type="hidden" name="name" value={place.name} />
            <input type="hidden" name="address" value={place.address} />
            <input type="hidden" name="latitude" value={place.latitude} />
            <input type="hidden" name="longitude" value={place.longitude} />
            <input
              type="hidden"
              name="opening_hours"
              value={JSON.stringify(place.openingHours)}
            />
            <div>
              <p className="text-xs font-medium text-zinc-950">{place.name}</p>
              <p className="mt-1 text-xs leading-4 text-zinc-500">{place.address}</p>
            </div>
            <SubmitButton pendingText="Saving..." className="h-7 bg-white px-2 text-xs font-medium ring-1 ring-zinc-200 disabled:text-zinc-400">
              Use
            </SubmitButton>
          </form>
        ))}
      </div>
      {isPending ? <p className="mt-2 text-xs text-zinc-500">Searching...</p> : null}
    </div>
  );
}
