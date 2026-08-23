"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { saveAiSpot } from "@/lib/actions";
import type { PlanningMode } from "@/lib/types";
import { SubmitButton } from "@/components/submit-button";

type Candidate = {
  name: string;
  category: string;
  duration_minutes: number;
  indoor_outdoor: string;
  rationale?: string;
};

export function AiSpotGenerator({
  cityStopId,
  city,
  country,
  planningMode,
}: {
  cityStopId: string;
  city: string;
  country: string;
  planningMode: PlanningMode;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isGenerating]);

  async function generate() {
    setMessage("");
    setCandidates([]);
    setElapsedSeconds(0);
    setIsGenerating(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 40000);

    try {
      const response = await fetch("/api/ai/spots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          city,
          country,
          planningMode,
          desiredCount: planningMode === "fast_walker" ? 10 : 6,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setCandidates([]);
        setMessage(data.error ?? "AI spot generation failed.");
        return;
      }

      if (!Array.isArray(data.spots) || !data.spots.length) {
        setMessage("AI returned no spot ideas. Please try again.");
        return;
      }

      setCandidates(data.spots);
      if (data.notice) setMessage(data.notice);
    } catch (error) {
      setCandidates([]);
      setMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "AI took longer than 40 seconds. Please try again."
          : error instanceof Error
            ? error.message
            : "AI spot generation failed.",
      );
    } finally {
      window.clearTimeout(timeout);
      setIsGenerating(false);
    }
  }

  return (
    <section className="border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">AI spot ideas</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Save candidates here, then verify them with Google Places.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={isGenerating}
          aria-busy={isGenerating}
          className="inline-flex h-9 items-center gap-2 bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-400"
        >
          <Sparkles size={15} />
          {isGenerating ? "Generating..." : "Generate"}
        </button>
      </div>
      <div aria-live="polite">
        {isGenerating ? (
          <p className="mt-3 text-xs text-zinc-600">
            Finding specific places for {city}... {elapsedSeconds}s
          </p>
        ) : null}
        {message ? <p className="mt-3 text-xs text-amber-700">{message}</p> : null}
      </div>
      <div className="mt-4 grid gap-2">
        {candidates.map((candidate) => (
          <form
            key={`${candidate.name}-${candidate.category}`}
            action={async (formData) => {
              await saveAiSpot(formData);
              setCandidates((current) =>
                current.filter(
                  (item) =>
                    item.name !== candidate.name ||
                    item.category !== candidate.category,
                ),
              );
              router.refresh();
            }}
            className="border border-zinc-100 bg-zinc-50 p-3"
          >
            <input type="hidden" name="city_stop_id" value={cityStopId} />
            <input type="hidden" name="name" value={candidate.name} />
            <input type="hidden" name="category" value={candidate.category} />
            <input
              type="hidden"
              name="duration_minutes"
              value={candidate.duration_minutes ?? 90}
            />
            <input
              type="hidden"
              name="indoor_outdoor"
              value={candidate.indoor_outdoor ?? "indoor"}
            />
            <input type="hidden" name="rationale" value={candidate.rationale ?? ""} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-950">{candidate.name}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {candidate.category} - {candidate.duration_minutes ?? 90} min -{" "}
                  {candidate.indoor_outdoor ?? "indoor"}
                </p>
                {candidate.rationale ? (
                  <p className="mt-2 text-xs leading-5 text-zinc-600">
                    {candidate.rationale}
                  </p>
                ) : null}
              </div>
              <SubmitButton pendingText="Saving..." className="h-8 bg-white px-3 text-xs font-medium text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-100 disabled:text-zinc-400">
                Save
              </SubmitButton>
            </div>
          </form>
        ))}
      </div>
    </section>
  );
}
