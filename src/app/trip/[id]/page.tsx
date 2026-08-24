import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { CalendarArrowDown, Copy, ExternalLink, Plane, Plus, Trash2 } from "lucide-react";
import {
  addCityStop,
  addManualSpot,
  createDayPlan,
  deleteSpot,
  refreshStopHours,
  updateSpotReference,
  updateCityStop,
  updateTravelLeg,
  updateTripTravelMode,
} from "@/lib/actions";
import { dateRange, formatDate } from "@/lib/dates";
import { getSiteUrl, hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { AiSpotGenerator } from "@/components/ai-spot-generator";
import { DayPlanner } from "@/components/day-planner";
import { HotelPicker } from "@/components/hotel-picker";
import { CityMap } from "@/components/city-map";
import { TripOverview } from "@/components/trip-overview";
import { TripCosts } from "@/components/trip-costs";
import { LegDistance } from "@/components/leg-distance";
import { PlaceVerifier } from "@/components/place-verifier";
import { SubmitButton } from "@/components/submit-button";
import type { DayItem, DayPlan, Spot, TripBundle, TripCost } from "@/lib/types";

export const dynamic = "force-dynamic";

const STALE_HOURS_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = await createClient();
  const { data: trip, error } = await supabase
    .from("trips")
    .select(
      `
      *,
      travel_legs(*),
      trip_costs(*),
      city_stops(
        *,
        spots(*),
        day_plans(*, day_items(*))
      )
    `,
    )
    .eq("id", id)
    .single();

  if (error || !trip) notFound();

  const bundle = trip as TripBundle;
  const stops = [...(bundle.city_stops ?? [])].sort(
    (a, b) => a.order_index - b.order_index,
  );
  const nextStopArrival =
    stops[stops.length - 1]?.departure_date ?? bundle.start_date;

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-5 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link href="/" className="text-xs font-medium text-zinc-500 hover:text-zinc-950">
                Back to trips
              </Link>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
                {bundle.name}
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                {bundle.start_date} to {bundle.end_date} ·{" "}
                {bundle.planning_mode.replace("_", " ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/calendar/${bundle.share_token}`}
                className="inline-flex h-9 items-center gap-2 border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
              >
                <CalendarArrowDown size={15} />
                Add to calendar
              </a>
              <Link
                href={`/share/${bundle.share_token}`}
                className="inline-flex h-9 items-center gap-2 border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
              >
                <ExternalLink size={15} />
                Share view
              </Link>
            </div>
          </div>
          <form
            action={updateTripTravelMode}
            className="mt-4 flex flex-wrap items-center gap-2 border border-zinc-100 bg-zinc-50 p-3"
          >
            <input type="hidden" name="trip_id" value={bundle.id} />
            <label className="text-xs font-medium text-zinc-600">
              How you get around
            </label>
            <select
              name="travel_mode"
              defaultValue={bundle.travel_mode ?? "transit"}
              className="h-8 border border-zinc-200 bg-white px-2 text-xs"
            >
              <option value="walk">Mostly walking</option>
              <option value="transit">Public transit</option>
              <option value="drive">Driving</option>
            </select>
            <SubmitButton
              pendingText="Saving..."
              className="h-8 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400"
            >
              Save
            </SubmitButton>
            <span className="text-xs text-zinc-500">
              Travel times between spots are calculated this way.
            </span>
          </form>
          <div className="mt-3 flex items-center gap-2 border border-zinc-100 bg-zinc-50 p-3 text-xs text-zinc-500">
            <Copy size={14} />
            {`${getSiteUrl()}/share/${bundle.share_token}`}
          </div>
        </header>

        <TripOverview bundle={bundle} />

        <TripCosts
          tripId={bundle.id}
          costs={[...((bundle.trip_costs ?? []) as TripCost[])].sort((a, b) =>
            a.created_at.localeCompare(b.created_at),
          )}
          stops={stops}
          nights={stops.reduce((total, stop) => total + stop.nights, 0)}
        />

        <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <aside className="grid content-start gap-5">
            <section className="border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-950">Add city stop</h2>
              <form action={addCityStop} className="mt-4 grid gap-3">
                <input type="hidden" name="trip_id" value={bundle.id} />
                <input type="hidden" name="submission_id" value={randomUUID()} />
                <input name="city" required placeholder="Barcelona" className="h-10 border border-zinc-200 px-3 text-sm" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium text-zinc-500">
                    Starts
                    <input name="arrival_date" type="date" defaultValue={nextStopArrival} className="h-10 min-w-0 w-full border border-zinc-200 px-3 text-sm text-zinc-950" />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-zinc-500">
                    Nights
                  <input name="nights" type="number" min={1} defaultValue={3} className="h-10 border border-zinc-200 px-3 text-sm" />
                  </label>
                </div>
                <textarea name="flight_notes" placeholder="Flight notes or booking links" className="min-h-20 border border-zinc-200 p-3 text-sm" />
                <textarea name="hotel_notes" placeholder="Hotel notes or booking links" className="min-h-20 border border-zinc-200 p-3 text-sm" />
                <SubmitButton
                  pendingText="Adding stop..."
                  className="inline-flex h-10 items-center justify-center gap-2 bg-zinc-950 px-4 text-sm font-medium text-white disabled:bg-zinc-400"
                >
                  <Plus size={15} />
                  Add stop
                </SubmitButton>
              </form>
            </section>
            <section className="border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-950">Trip days</h2>
              <div className="mt-3 grid gap-2">
                {dateRange(bundle.start_date, bundle.end_date).map((date) => (
                  <p key={date} className="text-sm text-zinc-600">
                    {formatDate(date)}
                  </p>
                ))}
              </div>
            </section>
          </aside>

          <div className="grid gap-5">
            {stops.map((stop) => {
              const verified = stop.spots.filter(
                (spot) => spot.verification_status === "verified",
              );
              const scheduledSpotIds = new Set(
                stop.day_plans.flatMap((plan) =>
                  (plan.day_items as DayItem[])
                    .map((item) => item.spot_id)
                    .filter(Boolean),
                ),
              );
              const unscheduledVerified = verified.filter(
                (spot) => !scheduledSpotIds.has(spot.id),
              );
              const candidates = stop.spots.filter(
                (spot) => spot.verification_status === "ai_candidate",
              );
              const staleHours = verified.filter((spot) => {
                if (!spot.google_place_id) return false;
                if (!spot.hours_verified_at) return true;
                return (
                  Date.now() - Date.parse(spot.hours_verified_at) >
                  STALE_HOURS_AFTER_MS
                );
              });
              const dayPlans = [...stop.day_plans]
                .map((plan) => ({
                  ...plan,
                  day_items: [...(plan.day_items as DayItem[])],
                }))
                .sort((a, b) => a.plan_date.localeCompare(b.plan_date)) as Array<
                DayPlan & { day_items: DayItem[] }
              >;

              return (
                <section key={stop.id} className="border border-zinc-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        {stop.nights} nights
                      </p>
                      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
                        {stop.city}
                      </h2>
                    </div>
                    <form action={createDayPlan} className="flex gap-2">
                      <input type="hidden" name="city_stop_id" value={stop.id} />
                      <input name="plan_date" type="date" defaultValue={stop.arrival_date ?? bundle.start_date} className="h-9 border border-zinc-200 px-2 text-sm" />
                      <SubmitButton pendingText="Adding..." className="h-9 border border-zinc-200 bg-white px-3 text-sm font-medium disabled:text-zinc-400">
                        Add day
                      </SubmitButton>
                    </form>
                  </div>

                  {(() => {
                    const leg = bundle.travel_legs?.find(
                      (travelLeg) => travelLeg.to_city_stop_id === stop.id,
                    );

                    if (!leg) return null;

                    return (
                      <form
                        action={updateTravelLeg}
                        className="mt-4 grid gap-3 border border-sky-100 bg-sky-50 p-3"
                      >
                        <input type="hidden" name="travel_leg_id" value={leg.id} />
                        <input type="hidden" name="trip_id" value={bundle.id} />
                        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                          Travel to {stop.city}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <input
                            name="origin"
                            defaultValue={leg.origin}
                            placeholder="From, e.g. IAD"
                            className="h-9 border border-sky-200 px-2 text-sm"
                          />
                          <input
                            name="destination"
                            defaultValue={leg.destination || stop.city}
                            placeholder="To, e.g. ICN"
                            className="h-9 border border-sky-200 px-2 text-sm"
                          />
                          <input
                            name="departure_date"
                            type="date"
                            defaultValue={leg.departure_date ?? ""}
                            className="h-9 border border-sky-200 px-2 text-sm"
                            title="Flight departure date"
                          />
                          <input
                            name="arrival_date"
                            type="date"
                            defaultValue={leg.arrival_date ?? stop.arrival_date ?? ""}
                            className="h-9 border border-sky-200 px-2 text-sm"
                            title="Flight arrival date"
                          />
                        </div>
                        <textarea
                          name="notes"
                          defaultValue={leg.notes}
                          placeholder="Flight number, airport transfer, overnight/time-zone notes"
                          className="min-h-16 border border-sky-200 p-2 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <SubmitButton pendingText="Saving..." className="h-9 bg-white px-3 text-sm font-medium ring-1 ring-sky-200 disabled:text-zinc-400">
                            Save travel leg
                          </SubmitButton>
                          <LegDistance leg={leg} />
                        </div>
                      </form>
                    );
                  })()}

                  <form action={updateCityStop} className="mt-4 grid gap-3 border border-zinc-100 bg-zinc-50 p-3">
                    <input type="hidden" name="trip_id" value={bundle.id} />
                    <input type="hidden" name="city_stop_id" value={stop.id} />
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <input name="city" required minLength={2} defaultValue={stop.city} className="h-9 border border-zinc-200 px-2 text-sm" />
                      <input type="hidden" name="country" value="" />
                      <input name="nights" type="number" min={1} defaultValue={stop.nights} className="h-9 border border-zinc-200 px-2 text-sm" />
                      <input name="arrival_date" type="date" defaultValue={stop.arrival_date ?? ""} className="h-9 border border-zinc-200 px-2 text-sm" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input name="departure_date" type="date" defaultValue={stop.departure_date ?? ""} className="h-9 border border-zinc-200 px-2 text-sm" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <textarea name="flight_notes" defaultValue={stop.flight_notes} placeholder="Flight notes" className="min-h-20 border border-zinc-200 p-2 text-sm" />
                      <textarea name="hotel_notes" defaultValue={stop.hotel_notes} placeholder="Hotel notes" className="min-h-20 border border-zinc-200 p-2 text-sm" />
                    </div>
                    <SubmitButton pendingText="Saving..." className="h-9 justify-self-start bg-white px-3 text-sm font-medium ring-1 ring-zinc-200 disabled:text-zinc-400">
                      Save stop
                    </SubmitButton>
                  </form>

                  {staleHours.length ? (
                    <form
                      action={refreshStopHours}
                      className="mt-4 flex flex-wrap items-center gap-3 border border-amber-200 bg-amber-50 p-3"
                    >
                      <input type="hidden" name="city_stop_id" value={stop.id} />
                      <input type="hidden" name="trip_id" value={bundle.id} />
                      <p className="text-xs leading-5 text-amber-900">
                        {staleHours.length} spot
                        {staleHours.length === 1 ? "" : "s"} last checked over 30
                        days ago. Opening hours change seasonally.
                      </p>
                      <SubmitButton
                        pendingText="Refreshing..."
                        className="h-8 border border-amber-300 bg-white px-3 text-xs font-medium disabled:text-zinc-400"
                      >
                        Refresh hours
                      </SubmitButton>
                    </form>
                  ) : null}

                  <HotelPicker stop={stop} tripId={bundle.id} />

                  <CityMap
                    cityStopId={stop.id}
                    city={stop.city}
                    dayDates={dayPlans.map((plan) => plan.plan_date)}
                    hasHotel={stop.hotel_latitude !== null}
                    spotCount={verified.length}
                  />

                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    <AiSpotGenerator
                      cityStopId={stop.id}
                      city={stop.city}
                      country={stop.country}
                      planningMode={bundle.planning_mode}
                    />
                    <section className="border border-zinc-200 bg-zinc-50 p-4">
                      <h3 className="text-sm font-semibold text-zinc-950">Add manual spot</h3>
                      <form action={addManualSpot} className="mt-3 grid gap-2 sm:grid-cols-2">
                        <input type="hidden" name="city_stop_id" value={stop.id} />
                        <input
                          name="name"
                          required
                          minLength={2}
                          placeholder="Spot name"
                          className="h-9 border border-zinc-200 px-2 text-sm"
                        />
                        <select
                          name="category"
                          defaultValue="sight"
                          className="h-9 border border-zinc-200 px-2 text-sm"
                        >
                          <option value="sight">Sight</option>
                          <option value="museum">Museum</option>
                          <option value="food">Food</option>
                          <option value="outdoor">Outdoor</option>
                          <option value="shopping">Shopping</option>
                          <option value="other">Other</option>
                        </select>
                        <input name="duration_minutes" type="number" min={15} defaultValue={90} className="h-9 border border-zinc-200 px-2 text-sm" />
                        <select name="indoor_outdoor" defaultValue="indoor" className="h-9 border border-zinc-200 px-2 text-sm">
                          <option value="indoor">Indoor</option>
                          <option value="outdoor">Outdoor</option>
                        </select>
                        <SubmitButton pendingText="Saving..." className="h-9 bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400 sm:col-span-2">
                          Save candidate
                        </SubmitButton>
                      </form>
                    </section>
                  </div>

                  {candidates.length ? (
                    <section className="mt-5">
                      <h3 className="text-sm font-semibold text-zinc-950">Pick the right place</h3>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        {candidates.map((spot: Spot) => (
                          <PlaceVerifier key={spot.id} spot={spot} city={stop.city} />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {unscheduledVerified.length ? (
                    <section className="mt-5">
                      <h3 className="text-sm font-semibold text-zinc-950">
                        Unplanned verified spots
                      </h3>
                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        {unscheduledVerified.map((spot: Spot) => (
                          <div
                            key={spot.id}
                            className="flex items-start justify-between gap-3 border border-zinc-100 bg-zinc-50 p-3"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-zinc-950">
                                {spot.name}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {spot.category} - {spot.duration_minutes} min
                              </p>
                              {spot.reference_url ? (
                                <a
                                  href={spot.reference_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-block truncate text-xs text-zinc-600 underline"
                                >
                                  Reference link
                                </a>
                              ) : null}
                              <form
                                action={updateSpotReference}
                                className="mt-2 flex flex-wrap items-center gap-1"
                              >
                                <input type="hidden" name="spot_id" value={spot.id} />
                                <input type="hidden" name="trip_id" value={bundle.id} />
                                <input
                                  name="reference_url"
                                  type="url"
                                  defaultValue={spot.reference_url}
                                  placeholder="Reference link"
                                  className="h-7 min-w-0 flex-1 border border-zinc-200 bg-white px-2 text-xs"
                                />
                                <SubmitButton
                                  pendingText="..."
                                  className="h-7 border border-zinc-200 bg-white px-2 text-xs font-medium disabled:text-zinc-400"
                                >
                                  Save
                                </SubmitButton>
                              </form>
                            </div>
                            <form action={deleteSpot}>
                              <input type="hidden" name="spot_id" value={spot.id} />
                              <button
                                title="Delete spot"
                                className="inline-flex h-8 w-8 items-center justify-center border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100"
                              >
                                <Trash2 size={14} />
                              </button>
                            </form>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="mt-5">
                    <h3 className="mb-3 text-sm font-semibold text-zinc-950">Day planner</h3>
                    {dayPlans.length ? (
                      <DayPlanner
                        dayPlans={dayPlans}
                        verifiedSpots={unscheduledVerified}
                        allSpots={stop.spots}
                        hotel={
                          stop.hotel_latitude !== null
                            ? {
                                latitude: stop.hotel_latitude,
                                longitude: stop.hotel_longitude,
                              }
                            : null
                        }
                        city={stop.city}
                        arrivalDate={stop.arrival_date}
                        departureDate={stop.departure_date}
                      />
                    ) : (
                      <p className="border border-zinc-100 bg-zinc-50 p-4 text-sm text-zinc-500">
                        Add a day, then drag verified spots into it.
                      </p>
                    )}
                  </section>
                </section>
              );
            })}

            {!stops.length ? (
              <section className="border border-zinc-200 bg-white p-8 text-center">
                <Plane className="mx-auto text-zinc-400" size={28} />
                <h2 className="mt-3 text-lg font-semibold text-zinc-950">
                  Start with the known cities.
                </h2>
                <p className="mt-2 text-sm text-zinc-500">
                  Add your first city stop, then generate and verify spots.
                </p>
              </section>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
