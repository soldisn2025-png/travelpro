import { BedDouble, MapPin } from "lucide-react";
import { dateRange, formatDate, formatTime } from "@/lib/dates";
import type { DayItem, DayPlan, TripBundle } from "@/lib/types";

// The whole trip on one screen, dates running left to right. Replaces the
// calendar grid people otherwise build by hand in a spreadsheet.
export function TripOverview({ bundle }: { bundle: TripBundle }) {
  const dates = dateRange(bundle.start_date, bundle.end_date);
  if (!dates.length) return null;

  const stops = [...(bundle.city_stops ?? [])].sort(
    (a, b) => a.order_index - b.order_index,
  );

  const columns = dates.map((date) => {
    const stop = stops.find(
      (candidate) =>
        candidate.arrival_date &&
        candidate.departure_date &&
        date >= candidate.arrival_date &&
        date <= candidate.departure_date,
    );

    const plan = stop
      ? ((stop.day_plans ?? []) as Array<DayPlan & { day_items: DayItem[] }>).find(
          (candidate) => candidate.plan_date === date,
        )
      : undefined;

    const items = [...(plan?.day_items ?? [])].sort(
      (a, b) =>
        (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99") ||
        a.sort_order - b.sort_order,
    );

    return { date, stop, items };
  });

  const plannedSpots = columns.reduce(
    (total, column) =>
      total + column.items.filter((item) => item.item_type === "spot").length,
    0,
  );
  const emptyDays = columns.filter(
    (column) => !column.items.some((item) => item.item_type === "spot"),
  ).length;

  return (
    <section className="border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-950">Whole trip</h2>
        <p className="text-xs text-zinc-500">
          {dates.length} days · {stops.length} cit{stops.length === 1 ? "y" : "ies"} ·{" "}
          {plannedSpots} spot{plannedSpots === 1 ? "" : "s"} planned
          {emptyDays ? ` · ${emptyDays} day${emptyDays === 1 ? "" : "s"} still empty` : ""}
        </p>
      </div>

      <div className="mt-4 flex snap-x gap-2 overflow-x-auto pb-3">
        {columns.map(({ date, stop, items }) => {
          const spots = items.filter((item) => item.item_type === "spot");

          return (
            <div
              key={date}
              className={`flex w-[172px] shrink-0 snap-start flex-col border p-2 ${
                spots.length ? "border-zinc-200 bg-white" : "border-dashed border-zinc-200 bg-zinc-50"
              }`}
            >
              <p className="text-xs font-semibold text-zinc-950">
                {formatDate(date)}
              </p>

              {stop ? (
                <>
                  <p className="mt-1 flex items-center gap-1 text-xs text-zinc-600">
                    <MapPin size={11} className="shrink-0 text-zinc-400" />
                    <span className="truncate">{stop.city}</span>
                  </p>
                  {stop.hotel_name ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                      <BedDouble size={11} className="shrink-0 text-zinc-400" />
                      <span className="truncate">{stop.hotel_name}</span>
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-xs text-amber-700">No city set</p>
              )}

              <div className="mt-2 grid gap-1 border-t border-zinc-100 pt-2">
                {items.length ? (
                  items.map((item) => (
                    <p key={item.id} className="text-xs leading-4 text-zinc-700">
                      <span className="text-zinc-400">
                        {item.start_time ? formatTime(item.start_time) : "--"}
                      </span>{" "}
                      <span className="text-zinc-900">{item.title}</span>
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-zinc-400">Nothing planned</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
