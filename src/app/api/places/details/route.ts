import { z } from "zod";

const schema = z.object({
  placeId: z.string().min(4),
});

export async function POST(request: Request) {
  const { placeId } = schema.parse(await request.json());
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!key) {
    return Response.json(
      { error: "GOOGLE_MAPS_API_KEY is missing." },
      { status: 501 },
    );
  }

  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "id,displayName,formattedAddress,location,regularOpeningHours",
    },
  });

  if (!response.ok) {
    return Response.json({ error: await response.text() }, { status: response.status });
  }

  const place = (await response.json()) as Record<string, unknown>;
  const displayName = place.displayName as { text?: string } | undefined;
  const location = place.location as
    | { latitude?: number; longitude?: number }
    | undefined;

  return Response.json({
    placeId: String(place.id ?? ""),
    name: displayName?.text ?? "",
    address: String(place.formattedAddress ?? ""),
    latitude: location?.latitude ?? 0,
    longitude: location?.longitude ?? 0,
    openingHours: place.regularOpeningHours ?? {},
  });
}
