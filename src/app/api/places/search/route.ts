import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api";

const schema = z.object({
  query: z.string().min(2),
  city: z.string().min(2),
});

function normalizePlace(place: Record<string, unknown>) {
  const displayName = place.displayName as { text?: string } | undefined;
  const location = place.location as
    | { latitude?: number; longitude?: number }
    | undefined;

  return {
    placeId: String(place.id ?? ""),
    name: displayName?.text ?? "",
    address: String(place.formattedAddress ?? ""),
    latitude: location?.latitude ?? 0,
    longitude: location?.longitude ?? 0,
    openingHours: place.regularOpeningHours ?? {},
  };
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = await readJson(request, schema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!key) {
    return Response.json(
      { error: "GOOGLE_MAPS_API_KEY is missing." },
      { status: 501 },
    );
  }

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.regularOpeningHours",
    },
    body: JSON.stringify({
      textQuery: `${body.query} ${body.city}`,
      languageCode: "en",
    }),
  });

  if (!response.ok) {
    return Response.json({ error: await response.text() }, { status: response.status });
  }

  const data = (await response.json()) as { places?: Record<string, unknown>[] };
  return Response.json({
    places: (data.places ?? []).slice(0, 5).map(normalizePlace),
  });
}
