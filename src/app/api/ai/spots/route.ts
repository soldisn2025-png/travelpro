import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api";
import { resolveMatch } from "@/lib/matching";
import { searchPlaces } from "@/lib/places";

const requestSchema = z.object({
  cityStopId: z.string().uuid(),
  city: z.string().min(2),
  country: z.string().optional(),
  planningMode: z.enum(["easygoing", "normal", "fast_walker"]),
  desiredCount: z.number().int().min(3).max(12).default(8),
});

const candidateSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(2),
  duration_minutes: z.number().int().min(15).max(480),
  indoor_outdoor: z.string().min(3),
  rationale: z.string().min(5),
});

const resultSchema = z.object({
  spots: z.array(candidateSchema).min(1).max(12),
});

const outputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    spots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          duration_minutes: { type: "integer" },
          indoor_outdoor: { type: "string" },
          rationale: { type: "string" },
        },
        required: [
          "name",
          "category",
          "duration_minutes",
          "indoor_outdoor",
          "rationale",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["spots"],
  additionalProperties: false,
};

const fallbackSpots = [
  {
    name: "Historic center walk",
    category: "outdoor",
    duration_minutes: 90,
    indoor_outdoor: "outdoor",
    rationale: "A flexible first-pass anchor for understanding the city on foot.",
  },
  {
    name: "Main art museum",
    category: "museum",
    duration_minutes: 120,
    indoor_outdoor: "indoor",
    rationale: "A reliable indoor anchor that usually works in bad weather.",
  },
  {
    name: "Local market",
    category: "food",
    duration_minutes: 75,
    indoor_outdoor: "indoor",
    rationale: "Good for low-commitment food discovery and neighborhood texture.",
  },
];

type Candidate = z.infer<typeof candidateSchema>;

type SpotInsert = {
  city_stop_id: string;
  name: string;
  category: string;
  duration_minutes: number;
  indoor_outdoor: string;
  verification_status: "verified" | "ai_candidate";
  source_metadata: Record<string, unknown>;
  google_place_id?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  opening_hours?: Record<string, unknown>;
  hours_verified_at?: string;
};

// Resolves every AI suggestion against Google Places before the user sees it.
// Confident matches are saved already verified; only genuine ambiguity is left
// for a human, with the options already fetched so resolving is one click.
async function verifyAndSave({
  supabase,
  cityStopId,
  city,
  candidates,
}: {
  supabase: SupabaseClient;
  cityStopId: string;
  city: string;
  candidates: Candidate[];
}) {
  const resolved = await Promise.all(
    candidates.map(async (candidate) => {
      const search = await searchPlaces(candidate.name, city);
      if (!search.ok) return { candidate, match: { status: "not_found" } as const };
      return { candidate, match: resolveMatch(candidate.name, search.places) };
    }),
  );

  const now = new Date().toISOString();
  const rows: SpotInsert[] = resolved.flatMap(({ candidate, match }): SpotInsert[] => {
    const base = {
      city_stop_id: cityStopId,
      name: candidate.name,
      category: candidate.category,
      duration_minutes: candidate.duration_minutes,
      indoor_outdoor: candidate.indoor_outdoor,
    };

    if (match.status === "verified") {
      return [
        {
          ...base,
          name: match.place.name,
          google_place_id: match.place.placeId,
          address: match.place.address,
          latitude: match.place.latitude,
          longitude: match.place.longitude,
          opening_hours: match.place.openingHours,
          hours_verified_at: now,
          verification_status: "verified",
          source_metadata: {
            source: "anthropic",
            rationale: candidate.rationale,
            auto_verified: true,
            match_score: match.score,
            suggested_name: candidate.name,
          },
        },
      ];
    }

    if (match.status === "ambiguous") {
      return [
        {
          ...base,
          verification_status: "ai_candidate",
          source_metadata: {
            source: "anthropic",
            rationale: candidate.rationale,
            auto_verified: false,
            match_score: match.score,
            // Stored so the picker can render choices without searching again.
            alternates: match.alternates,
          },
        },
      ];
    }

    // Nothing on Google matched, so the name is probably wrong or the place is
    // gone. Dropping it is better than making the user disprove it.
    return [];
  });

  if (rows.length) {
    const { error } = await supabase.from("spots").insert(rows);
    if (error) throw new Error(error.message);
  }

  return {
    verified: resolved.filter((entry) => entry.match.status === "verified").length,
    needsReview: resolved.filter((entry) => entry.match.status === "ambiguous").length,
    dropped: resolved.filter((entry) => entry.match.status === "not_found").length,
  };
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = await readJson(request, requestSchema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;

  if (!process.env.ANTHROPIC_API_KEY) {
    const saved = await verifyAndSave({
      supabase: auth.supabase,
      cityStopId: body.cityStopId,
      city: body.city,
      candidates: fallbackSpots.map((spot) => ({
        ...spot,
        name: `${body.city} ${spot.name}`,
      })),
    });

    return Response.json({
      ...saved,
      notice: "ANTHROPIC_API_KEY is missing, so fallback candidates were used.",
    });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

    const response = await anthropic.messages.create({
      model,
      max_tokens: 2400,
      thinking: { type: "disabled" },
      output_config: {
        format: {
          type: "json_schema",
          schema: outputSchema,
        },
      },
      messages: [
        {
          role: "user",
          content: `Suggest ${body.desiredCount} travel spots for ${body.city}, ${body.country ?? ""}.
Planning mode: ${body.planningMode}.
Each spot must have name, category, duration_minutes, indoor_outdoor, rationale.
Prefer specific places that can be verified in Google Places later. Do not invent addresses.`,
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (response.stop_reason === "max_tokens") {
      throw new Error("AI response reached its output limit. Please try again.");
    }

    if (!text) {
      throw new Error("AI returned no spot ideas. Please try again.");
    }

    const generated = resultSchema.parse(JSON.parse(text));
    const saved = await verifyAndSave({
      supabase: auth.supabase,
      cityStopId: body.cityStopId,
      city: body.city,
      candidates: generated.spots,
    });

    return Response.json(saved);
  } catch (error) {
    const apiError = error as {
      name?: string;
      message?: string;
      status?: number;
      request_id?: string;
    };
    console.error("AI spot generation failed", {
      name: apiError.name,
      message: apiError.message,
      status: apiError.status,
      requestId: apiError.request_id,
    });

    const message =
      apiError.status === 401
        ? "The Anthropic API key was rejected. Update it in Vercel."
        : apiError.status === 429
          ? "Anthropic is temporarily rate-limited. Please try again shortly."
          : apiError.message?.startsWith("AI ")
            ? apiError.message
            : "AI spot generation failed. Please try again.";

    return Response.json(
      { error: message },
      { status: 502 },
    );
  }
}
