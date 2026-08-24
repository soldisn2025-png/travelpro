import { Trash2, Wallet } from "lucide-react";
import { addTripCost, deleteTripCost } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";
import type { CityStop, CostCategory, TripCost } from "@/lib/types";

const CATEGORY_LABELS: Record<CostCategory, string> = {
  flight: "Flights",
  lodging: "Lodging",
  car: "Car / rental",
  food: "Food",
  activity: "Activities",
  other: "Other",
};

const ORDER: CostCategory[] = [
  "flight",
  "lodging",
  "car",
  "food",
  "activity",
  "other",
];

function money(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function TripCosts({
  tripId,
  costs,
  stops,
  nights,
}: {
  tripId: string;
  costs: TripCost[];
  stops: CityStop[];
  nights: number;
}) {
  const total = costs.reduce((sum, cost) => sum + Number(cost.amount), 0);

  const byCategory = ORDER.map((category) => ({
    category,
    total: costs
      .filter((cost) => cost.category === category)
      .reduce((sum, cost) => sum + Number(cost.amount), 0),
  })).filter((entry) => entry.total > 0);

  return (
    <section className="border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-zinc-500" />
          <h2 className="text-lg font-semibold text-zinc-950">Costs</h2>
        </div>
        <p className="text-sm text-zinc-600">
          <span className="font-semibold text-zinc-950">{money(total)}</span>
          {nights > 0 ? (
            <span className="text-zinc-500"> · {money(total / nights)} per night</span>
          ) : null}
        </p>
      </div>

      {byCategory.length ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {byCategory.map((entry) => (
            <p key={entry.category} className="text-xs text-zinc-600">
              {CATEGORY_LABELS[entry.category]}{" "}
              <span className="font-medium text-zinc-900">{money(entry.total)}</span>
            </p>
          ))}
        </div>
      ) : null}

      <form
        action={addTripCost}
        className="mt-4 grid gap-2 sm:grid-cols-[120px_1fr_110px_auto]"
      >
        <input type="hidden" name="trip_id" value={tripId} />
        <select
          name="category"
          defaultValue="lodging"
          className="h-9 border border-zinc-200 px-2 text-sm"
          aria-label="Cost category"
        >
          {ORDER.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <input
          name="label"
          placeholder="What was it for"
          className="h-9 min-w-0 border border-zinc-200 px-2 text-sm"
        />
        <input
          name="amount"
          type="number"
          min={0}
          step="0.01"
          required
          placeholder="0"
          className="h-9 border border-zinc-200 px-2 text-sm"
          aria-label="Amount"
        />
        <select
          name="city_stop_id"
          defaultValue=""
          className="h-9 border border-zinc-200 px-2 text-sm"
          aria-label="Which city"
        >
          <option value="">Whole trip</option>
          {stops.map((stop) => (
            <option key={stop.id} value={stop.id}>
              {stop.city}
            </option>
          ))}
        </select>
        <SubmitButton
          pendingText="Adding..."
          className="h-9 bg-zinc-950 px-4 text-sm font-medium text-white disabled:bg-zinc-400 sm:col-span-4 sm:justify-self-start"
        >
          Add cost
        </SubmitButton>
      </form>

      {costs.length ? (
        <div className="mt-4 grid gap-1">
          {costs.map((cost) => {
            const stop = stops.find((entry) => entry.id === cost.city_stop_id);
            return (
              <div
                key={cost.id}
                className="flex items-center justify-between gap-3 border border-zinc-100 bg-zinc-50 px-3 py-2"
              >
                <p className="min-w-0 text-sm text-zinc-800">
                  <span className="text-zinc-500">
                    {CATEGORY_LABELS[cost.category]}
                  </span>{" "}
                  {cost.label}
                  {stop ? (
                    <span className="text-zinc-400"> · {stop.city}</span>
                  ) : null}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-medium text-zinc-950">
                    {money(Number(cost.amount))}
                  </span>
                  <form action={deleteTripCost}>
                    <input type="hidden" name="cost_id" value={cost.id} />
                    <input type="hidden" name="trip_id" value={tripId} />
                    <button
                      title="Remove cost"
                      className="inline-flex h-7 w-7 items-center justify-center border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          No costs yet. Add flights, lodging and the car to see the trip total.
        </p>
      )}
    </section>
  );
}
