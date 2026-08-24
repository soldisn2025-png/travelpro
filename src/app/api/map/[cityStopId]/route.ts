import { requireApiUser } from "@/lib/api";
import { DAY_MARKER_COLORS, HOTEL_MARKER_COLOR } from "@/lib/map";
import type { DayItem, DayPlan, Spot } from "@/lib/types";

// The static map URL has to carry the API key, so the image is fetched here and
// streamed back. That keeps a server-only key off the client.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cityStopId: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return Response.json({ error: "GOOGLE_MAPS_API_KEY is missing." }, { status: 501 });
  }

  const { cityStopId } = await params;
  const { supabase } = auth;

  // RLS keeps this to city stops the signed-in user owns.
  const { data: stop, error } = await supabase
    .from("city_stops")
    .select(
      "id, hotel_latitude, hotel_longitude, spots(*), day_plans(plan_date, day_items(spot_id))",
    )
    .eq("id", cityStopId)
    .single();

  if (error || !stop) {
    return Response.json({ error: "City stop not found." }, { status: 404 });
  }

  const plans = [...((stop.day_plans ?? []) as Array<DayPlan & { day_items: DayItem[] }>)]
    .sort((a, b) => a.plan_date.localeCompare(b.plan_date));

  // Which day each spot sits on, so markers can be coloured and numbered by day.
  const dayIndexBySpot = new Map<string, number>();
  plans.forEach((plan, index) => {
    for (const item of plan.day_items ?? []) {
      if (item.spot_id) dayIndexBySpot.set(item.spot_id, index);
    }
  });

  const spots = ((stop.spots ?? []) as Spot[]).filter(
    (spot) =>
      spot.verification_status === "verified" &&
      spot.latitude !== null &&
      spot.longitude !== null,
  );

  const hasHotel =
    stop.hotel_latitude !== null && stop.hotel_longitude !== null;

  if (!spots.length && !hasHotel) {
    return Response.json({ error: "Nothing to map yet." }, { status: 404 });
  }

  // One markers parameter per colour group.
  const groups = new Map<string, string[]>();
  const addMarker = (color: string, label: string, lat: number, lng: number) => {
    const style = `color:0x${color}|label:${label}`;
    const points = groups.get(style) ?? [];
    points.push(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    groups.set(style, points);
  };

  if (hasHotel) {
    addMarker(
      HOTEL_MARKER_COLOR,
      "H",
      stop.hotel_latitude as number,
      stop.hotel_longitude as number,
    );
  }

  for (const spot of spots) {
    const dayIndex = dayIndexBySpot.get(spot.id);
    const color =
      dayIndex === undefined
        ? "9e9e9e"
        : DAY_MARKER_COLORS[dayIndex % DAY_MARKER_COLORS.length];
    // Static Maps labels accept a single character only.
    const label = dayIndex === undefined ? "0" : String((dayIndex % 9) + 1);
    addMarker(color, label, spot.latitude as number, spot.longitude as number);
  }

  const markerParams = [...groups.entries()]
    .map(([style, points]) => `markers=${encodeURIComponent(style)}|${points.join("|")}`)
    .join("&");

  // Omitting center and zoom makes Google fit the viewport to the markers.
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?size=640x420&scale=2&maptype=roadmap&${markerParams}&key=${key}`;

  const image = await fetch(url);
  if (!image.ok) {
    return Response.json({ error: await image.text() }, { status: image.status });
  }

  return new Response(image.body, {
    headers: {
      "Content-Type": image.headers.get("Content-Type") ?? "image/png",
      // Private: the image reveals where this user's trip goes.
      "Cache-Control": "private, max-age=300",
    },
  });
}
