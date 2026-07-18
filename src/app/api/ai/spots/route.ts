import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const requestSchema = z.object({
  city: z.string().min(2),
  country: z.string().optional(),
  planningMode: z.enum(["easygoing", "normal", "fast_walker"]),
  desiredCount: z.number().int().min(3).max(12).default(8),
});

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
      max_tokens: 1600,
      messages: [
        {
          role: "user",
          content: `Return only JSON. Suggest ${body.desiredCount} travel spots for ${body.city}, ${body.country ?? ""}.
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
    const jsonText = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/)?.[0] ?? text;
    const parsed = JSON.parse(jsonText) as unknown;
    const spots = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed && "spots" in parsed
        ? (parsed as { spots: unknown }).spots
        : [];

    return Response.json({ spots });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "AI spot generation failed.",
      },
      { status: 502 },
    );
  }
}
