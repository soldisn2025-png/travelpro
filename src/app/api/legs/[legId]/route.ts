import { requireApiUser } from "@/lib/api";
import { searchPlaces } from "@/lib/places";

type Point = { latitude: number; longitude: number };
type StopRow = {
  id: string;
  city: string;
  hotel_latitude: number | null;
  hotel_longitude: number | null;
};

// Prefers the hotel's coordinates, falling back to geocoding the city name, so
// a leg can be measured before lodging is chosen.
async function resolvePoint(
  stop: StopRow | null,
  fallbackCity: string,
): Promise<Point | null> {
  if (stop && stop.hotel_latitude !== null && stop.hotel_longitude !== null) {
    return { latitude: stop.hotel_latitude, longitude: stop.hotel_longitude };
  }

  const city = stop?.city || fallbackCity;
  if (city.length < 2) return null;

  const search = await searchPlaces(city, "");
  if (!search.ok || !search.places.length) return null;

  return {
    latitude: search.places[0].latitude,
    longitude: search.places[0].longitude,
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ legId: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return Response.json({ error: "GOOGLE_MAPS_API_KEY is missing." }, { status: 501 });
  }

  const { legId } = await params;
  const { supabase } = auth;

  // RLS scopes this to the signed-in user's own trips.
  const { data: leg } = await supabase
    .from("travel_legs")
    .select("id, trip_id, origin, destination, to_city_stop_id")
    .eq("id", legId)
    .single();

  if (!leg) return Response.json({ error: "Leg not found." }, { status: 404 });

  const { data: stops } = await supabase
    .from("city_stops")
    .select("id, city, order_index, hotel_latitude, hotel_longitude")
    .eq("trip_id", leg.trip_id)
    .order("order_index", { ascending: true });

  const ordered = (stops ?? []) as StopRow[];
  const toIndex = ordered.findIndex((stop) => stop.id === leg.to_city_stop_id);
  const toStop = toIndex >= 0 ? ordered[toIndex] : null;
  const fromStop = toIndex > 0 ? ordered[toIndex - 1] : null;

  const from = await resolvePoint(fromStop, leg.origin);
  const to = await resolvePoint(toStop, leg.destination);

  if (!from || !to) {
    return Response.json(
      {
        error:
          "Could not locate both ends of this leg. Set the city names or hotels first.",
      },
      { status: 422 },
    );
  }

  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: from } },
        destination: { location: { latLng: to } },
        travelMode: "DRIVE",
      }),
    },
  );

  if (!response.ok) {
    return Response.json({ error: await response.text() }, { status: response.status });
  }

  const data = (await response.json()) as {
    routes?: Array<{ duration?: string; distanceMeters?: number }>;
  };
  const route = data.routes?.[0];

  if (!route?.duration) {
    return Response.json(
      { error: "No driving route exists between these cities." },
      { status: 422 },
    );
  }

  const minutes = Math.round(Number(route.duration.replace("s", "")) / 60);

  const { error } = await supabase
    .from("travel_legs")
    .update({
      duration_minutes: minutes,
      distance_meters: route.distanceMeters ?? null,
      route_mode: "drive",
    })
    .eq("id", legId);

  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({
    ok: true,
    durationMinutes: minutes,
    distanceMeters: route.distanceMeters ?? null,
  });
}
