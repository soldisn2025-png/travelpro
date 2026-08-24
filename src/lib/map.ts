import type { Spot } from "@/lib/types";

// Marker colours, reused by the static map and the on-page day legend so a day's
// colour means the same thing in both.
export const DAY_MARKER_COLORS = [
  "1f77b4",
  "d62728",
  "2ca02c",
  "9467bd",
  "ff7f0e",
  "17becf",
  "8c564b",
  "e377c2",
  "7f7f7f",
];

export const HOTEL_MARKER_COLOR = "111827";

export function dayColor(index: number) {
  return `#${DAY_MARKER_COLORS[index % DAY_MARKER_COLORS.length]}`;
}

type Point = { latitude: number | null; longitude: number | null };

function hasCoords(point: Point | null | undefined): point is {
  latitude: number;
  longitude: number;
} {
  return (
    !!point && point.latitude !== null && point.longitude !== null
  );
}

// A Google Maps directions link for one day, starting and ending at the hotel
// when there is one. Uses coordinates rather than names so it cannot resolve to
// the wrong place.
export function buildDirectionsUrl({
  spots,
  hotel,
}: {
  spots: Spot[];
  hotel?: Point | null;
}) {
  const stops = spots.filter(hasCoords).map((spot) => `${spot.latitude},${spot.longitude}`);
  if (!stops.length) return null;

  const start = hasCoords(hotel) ? `${hotel.latitude},${hotel.longitude}` : stops[0];
  const end = hasCoords(hotel) ? `${hotel.latitude},${hotel.longitude}` : stops[stops.length - 1];
  const waypoints = hasCoords(hotel) ? stops : stops.slice(1, -1);

  const params = new URLSearchParams({
    api: "1",
    origin: start,
    destination: end,
  });

  // Google caps waypoints on a shared directions link.
  if (waypoints.length) {
    params.set("waypoints", waypoints.slice(0, 9).join("|"));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
