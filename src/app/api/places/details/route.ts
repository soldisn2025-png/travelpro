import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api";
import { fetchPlaceDetails } from "@/lib/places";

const schema = z.object({
  placeId: z.string().min(4),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = await readJson(request, schema);
  if (!parsed.ok) return parsed.response;

  const result = await fetchPlaceDetails(parsed.data.placeId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.place);
}
