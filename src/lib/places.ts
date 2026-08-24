export type PlaceSummary = {
  placeId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  openingHours: Record<string, unknown>;
};

export type PlaceDetails = {
  placeId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  openingHours: Record<string, unknown>;
};

// Shared by the details route and the opening-hours refresh action so both read
// the same fields and normalise them the same way.
export async function fetchPlaceDetails(
  placeId: string,
): Promise<
  { ok: true; place: PlaceDetails } | { ok: false; status: number; error: string }
> {
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!key) {
    return { ok: false, status: 501, error: "GOOGLE_MAPS_API_KEY is missing." };
  }

  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "id,displayName,formattedAddress,location,regularOpeningHours",
    },
  });

  if (!response.ok) {
    return { ok: false, status: response.status, error: await response.text() };
  }

  const place = (await response.json()) as Record<string, unknown>;
  const displayName = place.displayName as { text?: string } | undefined;
  const location = place.location as
    | { latitude?: number; longitude?: number }
    | undefined;

  return {
    ok: true,
    place: {
      placeId: String(place.id ?? ""),
      name: displayName?.text ?? "",
      address: String(place.formattedAddress ?? ""),
      latitude: location?.latitude ?? 0,
      longitude: location?.longitude ?? 0,
      openingHours: (place.regularOpeningHours ?? {}) as Record<string, unknown>,
    },
  };
}

function normalizePlace(place: Record<string, unknown>): PlaceSummary {
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
    openingHours: (place.regularOpeningHours ?? {}) as Record<string, unknown>,
  };
}

// Shared by the search route and AI auto-verification so both rank the same
// set of fields.
export async function searchPlaces(
  query: string,
  city: string,
): Promise<
  { ok: true; places: PlaceSummary[] } | { ok: false; status: number; error: string }
> {
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!key) {
    return { ok: false, status: 501, error: "GOOGLE_MAPS_API_KEY is missing." };
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
      textQuery: `${query} ${city}`,
      languageCode: "en",
    }),
  });

  if (!response.ok) {
    return { ok: false, status: response.status, error: await response.text() };
  }

  const data = (await response.json()) as { places?: Record<string, unknown>[] };
  return { ok: true, places: (data.places ?? []).slice(0, 5).map(normalizePlace) };
}
