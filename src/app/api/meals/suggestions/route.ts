import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api";

const schema = z.object({
  city: z.string().min(2),
  meal: z.string().min(2),
});

function normalizePlace(place: Record<string, unknown>) {
  const displayName = place.displayName as { text?: string } | undefined;
  return {
    name: displayName?.text ?? "",
    address: String(place.formattedAddress ?? ""),
    googleMapsUri:
      typeof place.googleMapsUri === "string" ? place.googleMapsUri : null,
    userRatingCount:
      typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    rating:
      typeof place.rating === "number"
        ? place.rating
        : null,
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
        "places.displayName,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({
      textQuery: `${body.meal} restaurants in ${body.city}`,
      languageCode: "en",
    }),
  });

  if (!response.ok) {
    return Response.json({ error: await response.text() }, { status: response.status });
  }

  const data = (await response.json()) as { places?: Record<string, unknown>[] };
  return Response.json({
    suggestions: (data.places ?? []).slice(0, 3).map(normalizePlace),
  });
}
