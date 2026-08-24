"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { PlanningMode } from "@/lib/types";

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
    setElapsedSeconds(0);
    setIsGenerating(true);
    const controller = new AbortController();
    // Generation plus a Places lookup per suggestion takes longer than
    // generation alone did.
    const timeout = window.setTimeout(() => controller.abort(), 70000);

    try {
      const response = await fetch("/api/ai/spots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          cityStopId,
          city,
          country,
          planningMode,
          desiredCount: planningMode === "fast_walker" ? 10 : 6,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "AI spot generation failed.");
        return;
      }

      const parts = [`${data.verified} added and address-checked.`];
      if (data.needsReview) {
        parts.push(`${data.needsReview} need you to pick the right place below.`);
      }
      if (data.dropped) {
        parts.push(`${data.dropped} could not be found on Google and were skipped.`);
      }
      if (data.notice) parts.push(data.notice);

      setMessage(parts.join(" "));
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "AI took longer than 70 seconds. Please try again."
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
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Addresses are checked against Google automatically. You are only
            asked when the right place is genuinely unclear.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={isGenerating}
          aria-busy={isGenerating}
          className="inline-flex h-9 shrink-0 items-center gap-2 bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-400"
        >
          <Sparkles size={15} />
          {isGenerating ? "Working..." : "Suggest spots"}
        </button>
      </div>
      <div aria-live="polite">
        {isGenerating ? (
          <p className="mt-3 text-xs text-zinc-600">
            Finding places in {city} and checking each address... {elapsedSeconds}s
          </p>
        ) : null}
        {message ? <p className="mt-3 text-xs text-zinc-700">{message}</p> : null}
      </div>
    </section>
  );
}
