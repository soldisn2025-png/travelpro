import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api";
import { searchPlaces } from "@/lib/places";

const schema = z.object({
  query: z.string().min(2),
  city: z.string().min(2),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = await readJson(request, schema);
  if (!parsed.ok) return parsed.response;

  const result = await searchPlaces(parsed.data.query, parsed.data.city);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({ places: result.places });
}
