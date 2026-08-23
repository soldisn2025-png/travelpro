import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Route handlers cannot redirect the way server actions do, so auth failures
// come back as a plain 401 the client can show.
export async function requireApiUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: Response.json({ error: "Please sign in again." }, { status: 401 }),
    };
  }

  return { ok: true as const, supabase, user };
}

export async function readJson<S extends z.ZodType>(request: Request, schema: S) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false as const,
      response: Response.json({ error: "Invalid JSON body." }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false as const,
      response: Response.json({ error: "Invalid request body." }, { status: 400 }),
    };
  }

  return { ok: true as const, data: parsed.data as z.infer<S> };
}
