import { notFound } from "next/navigation";
import { CalendarDays, CalendarArrowDown, Hotel, PlaneTakeoff } from "lucide-react";
import { formatDate, formatTime } from "@/lib/dates";
import { hasSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { SetupNotice } from "@/components/setup-notice";
import type { DayItem, DayPlan, TripBundle } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <SetupNotice />;
  }

  const { token } = await params;
  const supabase = createAdminClient();
  const { data: trip, error } = await supabase
    .from("trips")
    .select(
      `
      *,
      travel_legs(*),
      city_stops(
        *,
        spots(*),
        day_plans(*, day_items(*))
      )
    `,
    )
    .eq("share_token", token)
    .single();

  if (error || !trip) notFound();

  const bundle = trip as TripBundle;
  const stops = [...bundle.city_stops].sort((a, b) => a.order_index - b.order_index);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-5">
      <div className="mx-auto max-w-3xl">
        <header className="border border-zinc-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Shared itinerary
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
            {bundle.name}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {bundle.start_date} to {bundle.end_date} · read only
          </p>
          <a
            href={`/api/calendar/${token}`}
            className="mt-4 inline-flex h-9 items-center gap-2 border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
          >
            <CalendarArrowDown size={15} />
            Add to calendar
          </a>
        </header>

        <div className="mt-4 grid gap-4">
          {stops.map((stop) => {
            const plans = [...stop.day_plans]
              .map((plan) => ({
                ...plan,
                day_items: [...(plan.day_items as DayItem[])],
              }))
              .sort((a, b) => a.plan_date.localeCompare(b.plan_date)) as Array<
              DayPlan & { day_items: DayItem[] }
            >;

            return (
              <section key={stop.id} className="border border-zinc-200 bg-white p-5">
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
                  {stop.city}
                </h2>
                <div className="mt-4 grid gap-2 text-sm text-zinc-600">
                  {bundle.travel_legs
                    ?.filter((leg) => leg.to_city_stop_id === stop.id)
                    .map((leg) => (
                      <p key={leg.id} className="flex gap-2">
                        <PlaneTakeoff className="mt-0.5 shrink-0" size={15} />
                        {leg.origin || "Origin"} to {leg.destination || stop.city}
                        {leg.departure_date || leg.arrival_date
                          ? `, ${leg.departure_date ?? "?"} to ${leg.arrival_date ?? "?"}`
                          : ""}
                        {leg.notes ? ` - ${leg.notes}` : ""}
                      </p>
                    ))}
                  {stop.flight_notes ? (
                    <p className="flex gap-2">
                      <PlaneTakeoff className="mt-0.5 shrink-0" size={15} />
                      {stop.flight_notes}
                    </p>
                  ) : null}
                  {stop.hotel_notes ? (
                    <p className="flex gap-2">
                      <Hotel className="mt-0.5 shrink-0" size={15} />
                      {stop.hotel_notes}
                    </p>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-4">
                  {plans.map((plan) => {
                    const items = [...plan.day_items].sort(
                      (a, b) =>
                        (a.start_time ?? "99:99").localeCompare(
                          b.start_time ?? "99:99",
                        ) || a.sort_order - b.sort_order,
                    );
                    return (
                      <article key={plan.id} className="border border-zinc-100 bg-zinc-50 p-4">
                        <div className="flex items-center gap-2">
                          <CalendarDays size={16} className="text-zinc-500" />
                          <h3 className="font-semibold text-zinc-950">
                            {formatDate(plan.plan_date)}
                          </h3>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {items.map((item) => (
                            <div key={item.id} className="grid grid-cols-[88px_1fr] gap-3">
                              <p className="text-xs font-medium text-zinc-500">
                                {formatTime(item.start_time)}
                              </p>
                              <div>
                                <p className="text-sm font-medium text-zinc-950">
                                  {item.title}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  {item.item_type === "fixed_anchor"
                                    ? "Fixed"
                                    : `${item.duration_minutes} min`}
                                  {item.travel_time_from_previous_minutes
                                    ? item.travel_time_is_estimated
                                      ? ` · ~${item.travel_time_from_previous_minutes} min travel (estimated)`
                                      : ` · ${item.travel_time_from_previous_minutes} min travel`
                                    : ""}
                                </p>
                              </div>
                            </div>
                          ))}
                          {!items.length ? (
                            <p className="text-sm text-zinc-500">No planned items yet.</p>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
