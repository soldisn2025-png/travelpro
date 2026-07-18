import Link from "next/link";
import { PlaneTakeoff } from "lucide-react";
import { createTrip } from "@/lib/actions";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { SignInButton } from "@/components/sign-in-button";
import { SubmitButton } from "@/components/submit-button";
import type { Trip } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-5 py-12">
        <div className="max-w-xl">
          <div className="inline-flex h-10 w-10 items-center justify-center bg-zinc-950 text-white">
            <PlaneTakeoff size={20} />
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-zinc-950">
            Your Travel Pro
          </h1>
          <p className="mt-4 text-base leading-7 text-zinc-600">
            Build a multi-city itinerary canvas, verify AI spot ideas with Google
            Places, schedule real days, and send SK a clean read-only link.
          </p>
          <div className="mt-8">
            <SignInButton />
          </div>
        </div>
      </main>
    );
  }

  const { data: trips } = await supabase
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[360px_1fr]">
        <section className="border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Travel canvas
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
                New trip
              </h1>
            </div>
            <form action="/auth/sign-out" method="post">
              <button className="text-xs font-medium text-zinc-500 hover:text-zinc-950">
                Sign out
              </button>
            </form>
          </div>
          <form action={createTrip} className="mt-6 grid gap-4">
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Trip name
              <input
                name="name"
                required
                placeholder="Europe 2026 Fall"
                className="h-10 border border-zinc-200 px-3 font-normal"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium text-zinc-700">
                Start
                <input
                  name="start_date"
                  type="date"
                  required
                  className="h-10 min-w-0 w-full border border-zinc-200 px-3 font-normal"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-zinc-700">
                End
                <input
                  name="end_date"
                  type="date"
                  required
                  className="h-10 min-w-0 w-full border border-zinc-200 px-3 font-normal"
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Planning mode
              <select
                name="planning_mode"
                className="h-10 border border-zinc-200 px-3 font-normal"
                defaultValue="normal"
              >
                <option value="easygoing">Easygoing</option>
                <option value="normal">Normal</option>
                <option value="fast_walker">Fast walker</option>
              </select>
            </label>
            <SubmitButton pendingText="Creating trip..." className="h-10 bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-400">
              Create trip
            </SubmitButton>
          </form>
        </section>
        <section className="border border-zinc-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-zinc-950">Saved trips</h2>
          <div className="mt-4 grid gap-3">
            {(trips as Trip[] | null)?.length ? (
              (trips as Trip[]).map((trip) => (
                <Link
                  key={trip.id}
                  href={`/trip/${trip.id}`}
                  className="grid gap-2 border border-zinc-100 bg-zinc-50 p-4 hover:border-zinc-300"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium text-zinc-950">{trip.name}</p>
                    <span className="text-xs uppercase tracking-wide text-zinc-500">
                      {trip.status}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-500">
                    {trip.start_date} to {trip.end_date} ·{" "}
                    {trip.planning_mode.replace("_", " ")}
                  </p>
                </Link>
              ))
            ) : (
              <p className="text-sm text-zinc-500">
                No trips yet. Create the first real planning canvas.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
