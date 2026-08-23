import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  }

  const body = requestSchema.parse(await request.json());

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({
      spots: fallbackSpots.map((spot) => ({
        ...spot,
        name: `${body.city} ${spot.name}`,
      })),
      notice: "ANTHROPIC_API_KEY is missing, so fallback candidates were returned.",
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

    const parsed = resultSchema.parse(JSON.parse(text));

    return Response.json({ spots: parsed.spots });
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
