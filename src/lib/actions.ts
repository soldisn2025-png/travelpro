"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addDays, dateRange, minutesToTime, timeToMinutes } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

const tripSchema = z.object({
  name: z.string().min(2),
  start_date: z.string().min(10),
  end_date: z.string().min(10),
  planning_mode: z.enum(["easygoing", "normal", "fast_walker"]),
});

const cityStopSchema = z.object({
  trip_id: z.string().uuid(),
  city: z.string().min(2),
  country: z.string(),
  nights: z.coerce.number().int().min(1),
  arrival_date: z.string(),
  departure_date: z.string(),
  arrival_details: z.string(),
  departure_details: z.string(),
  hotel_notes: z.string(),
  flight_notes: z.string(),
});

const travelLegSchema = z.object({
  travel_leg_id: z.string().uuid(),
  trip_id: z.string().uuid(),
  origin: z.string(),
  destination: z.string(),
  departure_date: z.string(),
  arrival_date: z.string(),
  notes: z.string(),
});

const spotSchema = z.object({
  city_stop_id: z.string().uuid(),
  name: z.string().min(2),
  category: z.string().min(2),
  duration_minutes: z.coerce.number().int().min(15),
  indoor_outdoor: z.string().min(3),
});

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) redirect("/");
  return { supabase, user };
}

function eachStayDate(arrivalDate: string, departureDate: string) {
  if (!arrivalDate || !departureDate) return [];
  return dateRange(arrivalDate, departureDate);
}

async function ensureMealAnchorsForDayPlans(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dayPlanIds: string[],
) {
  if (!dayPlanIds.length) return;

  const { data: existingMeals, error: existingMealsError } = await supabase
    .from("day_items")
    .select("day_plan_id, title")
    .in("day_plan_id", dayPlanIds)
    .eq("item_type", "fixed_anchor");

  if (existingMealsError) throw new Error(existingMealsError.message);

  const existingMealsByDay = new Map<string, Set<string>>();
  for (const item of existingMeals ?? []) {
    const title = String(item.title).toLowerCase();
    if (!title.startsWith("lunch") && !title.startsWith("dinner")) continue;
    const meal = title.startsWith("dinner") ? "Dinner" : "Lunch";
    const titles = existingMealsByDay.get(item.day_plan_id) ?? new Set<string>();
    titles.add(meal);
    existingMealsByDay.set(item.day_plan_id, titles);
  }

  const mealRows = dayPlanIds.flatMap((dayPlanId) =>
    [
      {
        day_plan_id: dayPlanId,
        item_type: "fixed_anchor",
        title: "Lunch",
        start_time: "12:00:00",
        end_time: "13:00:00",
        duration_minutes: 60,
        schedule_mode: "meal",
        priority: "must",
      },
      {
        day_plan_id: dayPlanId,
        item_type: "fixed_anchor",
        title: "Dinner",
        start_time: "18:00:00",
        end_time: "19:00:00",
        duration_minutes: 60,
        schedule_mode: "meal",
        priority: "must",
      },
    ].filter(
      (meal) => !existingMealsByDay.get(dayPlanId)?.has(meal.title),
    ),
  );

  if (mealRows.length) {
    const { error } = await supabase.from("day_items").insert(mealRows);
    if (error) throw new Error(error.message);
  }
}

async function ensureMealAnchorsForDayPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dayPlanId: string,
) {
  await ensureMealAnchorsForDayPlans(supabase, [dayPlanId]);
}

async function ensureDayPlans(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cityStopId: string,
  arrivalDate: string,
  departureDate: string,
) {
  const rows = eachStayDate(arrivalDate, departureDate).map((plan_date) => ({
    city_stop_id: cityStopId,
    plan_date,
  }));

  if (!rows.length) return;

  const { error: dayPlanUpsertError } = await supabase.from("day_plans").upsert(rows, {
    onConflict: "city_stop_id,plan_date",
    ignoreDuplicates: true,
  });

  if (dayPlanUpsertError) throw new Error(dayPlanUpsertError.message);

  const { data: dayPlans, error: dayPlansError } = await supabase
    .from("day_plans")
    .select("id")
    .eq("city_stop_id", cityStopId)
    .in(
      "plan_date",
      rows.map((row) => row.plan_date),
    );

  if (dayPlansError) throw new Error(dayPlansError.message);

  await ensureMealAnchorsForDayPlans(
    supabase,
    (dayPlans ?? []).map((dayPlan) => dayPlan.id),
  );
}

async function ensureInboundTravelLeg({
  supabase,
  tripId,
  cityStopId,
  orderIndex,
  destination,
  arrivalDate,
  tripStartDate,
  origin,
  departureDate,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  tripId: string;
  cityStopId: string;
  orderIndex: number;
  destination: string;
  arrivalDate: string;
  tripStartDate: string;
  origin: string;
  departureDate: string;
}) {
  await supabase.from("travel_legs").upsert(
    {
      trip_id: tripId,
      to_city_stop_id: cityStopId,
      order_index: orderIndex,
      origin,
      destination,
      departure_date: departureDate || tripStartDate || null,
      arrival_date: arrivalDate || null,
    },
    { onConflict: "to_city_stop_id" },
  );
}

export async function createTrip(formData: FormData) {
  const { supabase, user } = await requireUser();
  const parsed = tripSchema.parse(Object.fromEntries(formData));
  const { data, error } = await supabase
    .from("trips")
    .insert({ ...parsed, owner_user_id: user.id })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  redirect(`/trip/${data.id}`);
}

export async function addCityStop(formData: FormData) {
  const { supabase } = await requireUser();
  const cityStopId = z.string().uuid().parse(formData.get("submission_id"));
  const tripId = z.string().uuid().parse(formData.get("trip_id"));
  const nights = z.coerce.number().int().min(1).parse(formData.get("nights"));
  const requestedArrival = String(formData.get("arrival_date") || "");
  const [{ data: existingStops }, { data: trip }] = await Promise.all([
    supabase
      .from("city_stops")
      .select("city, departure_date, order_index")
      .eq("trip_id", tripId)
      .order("order_index", { ascending: false })
      .limit(1),
    supabase.from("trips").select("start_date").eq("id", tripId).single(),
  ]);
  const previousStop = existingStops?.[0];
  const arrival =
    requestedArrival ||
    previousStop?.departure_date ||
    trip?.start_date ||
    "";
  const parsed = cityStopSchema.parse({
    trip_id: tripId,
    city: String(formData.get("city") ?? ""),
    country: String(formData.get("country") ?? ""),
    nights,
    arrival_date: arrival,
    departure_date: arrival ? addDays(arrival, nights) : "",
    arrival_details: "",
    departure_details: "",
    hotel_notes: String(formData.get("hotel_notes") ?? ""),
    flight_notes: String(formData.get("flight_notes") ?? ""),
  });
  const { data: cityStop, error } = await supabase
    .from("city_stops")
    .insert({
      id: cityStopId,
      ...parsed,
      order_index: (previousStop?.order_index ?? -1) + 1,
    })
    .select("id, order_index, city, arrival_date, departure_date")
    .single();

  if (error?.code === "23505") {
    const { data: existingStop } = await supabase
      .from("city_stops")
      .select("id")
      .eq("id", cityStopId)
      .eq("trip_id", parsed.trip_id)
      .maybeSingle();

    if (existingStop) {
      revalidatePath(`/trip/${parsed.trip_id}`);
      return;
    }
  }

  if (error) throw new Error(error.message);
  await Promise.all([
    ensureDayPlans(
      supabase,
      cityStop.id,
      cityStop.arrival_date ?? "",
      cityStop.departure_date ?? "",
    ),
    ensureInboundTravelLeg({
      supabase,
      tripId: parsed.trip_id,
      cityStopId: cityStop.id,
      orderIndex: cityStop.order_index,
      destination: cityStop.city,
      arrivalDate: cityStop.arrival_date ?? "",
      tripStartDate: trip?.start_date ?? "",
      origin: previousStop?.city ?? "",
      departureDate: previousStop?.departure_date ?? "",
    }),
  ]);
  revalidatePath(`/trip/${parsed.trip_id}`);
}

export async function updateCityStop(formData: FormData) {
  const { supabase } = await requireUser();
  const id = z.string().uuid().parse(formData.get("city_stop_id"));
  const tripId = z.string().uuid().parse(formData.get("trip_id"));
  const parsed = cityStopSchema.omit({ trip_id: true }).parse({
    city: String(formData.get("city") ?? ""),
    country: String(formData.get("country") ?? ""),
    nights: Number(formData.get("nights") ?? 1),
    arrival_date: String(formData.get("arrival_date") || ""),
    departure_date: String(formData.get("departure_date") || ""),
    arrival_details: String(formData.get("arrival_details") ?? ""),
    departure_details: String(formData.get("departure_details") ?? ""),
    hotel_notes: String(formData.get("hotel_notes") ?? ""),
    flight_notes: String(formData.get("flight_notes") ?? ""),
  });

  const { error } = await supabase.from("city_stops").update(parsed).eq("id", id);
  if (error) throw new Error(error.message);
  await ensureDayPlans(supabase, id, parsed.arrival_date, parsed.departure_date);
  await supabase
    .from("travel_legs")
    .update({
      destination: parsed.city,
      arrival_date: parsed.arrival_date || null,
    })
    .eq("to_city_stop_id", id);
  revalidatePath(`/trip/${tripId}`);
}

export async function updateTravelLeg(formData: FormData) {
  const { supabase } = await requireUser();
  const parsed = travelLegSchema.parse({
    travel_leg_id: formData.get("travel_leg_id"),
    trip_id: formData.get("trip_id"),
    origin: String(formData.get("origin") ?? ""),
    destination: String(formData.get("destination") ?? ""),
    departure_date: String(formData.get("departure_date") || ""),
    arrival_date: String(formData.get("arrival_date") || ""),
    notes: String(formData.get("notes") ?? ""),
  });

  const { error } = await supabase
    .from("travel_legs")
    .update({
      origin: parsed.origin,
      destination: parsed.destination,
      departure_date: parsed.departure_date || null,
      arrival_date: parsed.arrival_date || null,
      notes: parsed.notes,
    })
    .eq("id", parsed.travel_leg_id);

  if (error) throw new Error(error.message);
  revalidatePath(`/trip/${parsed.trip_id}`);
}

export async function addManualSpot(formData: FormData) {
  const { supabase } = await requireUser();
  const parsed = spotSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("spots").insert({
    ...parsed,
    verification_status: "ai_candidate",
    source_metadata: { source: "manual" },
  });

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function saveAiSpot(formData: FormData) {
  const { supabase } = await requireUser();
  const parsed = spotSchema.parse(Object.fromEntries(formData));
  const rationale = String(formData.get("rationale") ?? "");

  const { error } = await supabase.from("spots").insert({
    ...parsed,
    verification_status: "ai_candidate",
    source_metadata: { source: "anthropic", rationale },
  });

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

function parseOpeningHours(value: FormDataEntryValue | null) {
  try {
    return JSON.parse(String(value || "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function verifySpot(formData: FormData) {
  const { supabase } = await requireUser();
  const spotId = z.string().uuid().parse(formData.get("spot_id"));

  const { error } = await supabase
    .from("spots")
    .update({
      google_place_id: String(formData.get("google_place_id")),
      name: String(formData.get("name")),
      address: String(formData.get("address")),
      latitude: Number(formData.get("latitude")),
      longitude: Number(formData.get("longitude")),
      opening_hours: parseOpeningHours(formData.get("opening_hours")),
      verification_status: "verified",
    })
    .eq("id", spotId);

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function setHotel(formData: FormData) {
  const { supabase } = await requireUser();
  const cityStopId = z.string().uuid().parse(formData.get("city_stop_id"));
  const tripId = z.string().uuid().parse(formData.get("trip_id"));

  const { error } = await supabase
    .from("city_stops")
    .update({
      hotel_name: String(formData.get("hotel_name") ?? ""),
      hotel_address: String(formData.get("hotel_address") ?? ""),
      hotel_place_id: String(formData.get("hotel_place_id") ?? "") || null,
      hotel_latitude: Number(formData.get("hotel_latitude")) || null,
      hotel_longitude: Number(formData.get("hotel_longitude")) || null,
    })
    .eq("id", cityStopId);

  if (error) throw new Error(error.message);
  revalidatePath(`/trip/${tripId}`);
}

export async function clearHotel(formData: FormData) {
  const { supabase } = await requireUser();
  const cityStopId = z.string().uuid().parse(formData.get("city_stop_id"));
  const tripId = z.string().uuid().parse(formData.get("trip_id"));

  const { error } = await supabase
    .from("city_stops")
    .update({
      hotel_name: "",
      hotel_address: "",
      hotel_place_id: null,
      hotel_latitude: null,
      hotel_longitude: null,
    })
    .eq("id", cityStopId);

  if (error) throw new Error(error.message);
  revalidatePath(`/trip/${tripId}`);
}

export async function rejectSpot(formData: FormData) {
  const { supabase } = await requireUser();
  const spotId = z.string().uuid().parse(formData.get("spot_id"));
  const { error } = await supabase
    .from("spots")
    .update({ verification_status: "rejected" })
    .eq("id", spotId);

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function deleteSpot(formData: FormData) {
  const { supabase } = await requireUser();
  const spotId = z.string().uuid().parse(formData.get("spot_id"));
  const { error } = await supabase.from("spots").delete().eq("id", spotId);

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function createDayPlan(formData: FormData) {
  const { supabase } = await requireUser();
  const parsed = z
    .object({ city_stop_id: z.string().uuid(), plan_date: z.string().min(10) })
    .parse(Object.fromEntries(formData));
  const { data: dayPlan, error } = await supabase
    .from("day_plans")
    .insert(parsed)
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  await ensureMealAnchorsForDayPlan(supabase, dayPlan.id);
  revalidatePath("/trip");
}

export async function updateDayPlanTimes(formData: FormData) {
  const { supabase } = await requireUser();
  const parsed = z
    .object({
      day_plan_id: z.string().uuid(),
      start_time: z.string().min(5),
      end_time: z.string().min(5),
    })
    .parse(Object.fromEntries(formData));

  const { error } = await supabase
    .from("day_plans")
    .update({
      start_time:
        parsed.start_time.length === 5
          ? `${parsed.start_time}:00`
          : parsed.start_time,
      end_time:
        parsed.end_time.length === 5 ? `${parsed.end_time}:00` : parsed.end_time,
    })
    .eq("id", parsed.day_plan_id);

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function updateDayItemDuration(formData: FormData) {
  const { supabase } = await requireUser();
  const dayItemId = z.string().uuid().parse(formData.get("day_item_id"));
  const duration = z.coerce
    .number()
    .int()
    .min(15)
    .parse(formData.get("duration_minutes"));

  const { data: existing } = await supabase
    .from("day_items")
    .select("start_time")
    .eq("id", dayItemId)
    .single();
  const nextEndTime = existing?.start_time
    ? minutesToTime(timeToMinutes(existing.start_time) + duration)
    : null;
  const updatePayload: {
    duration_minutes: number;
    end_time?: string;
    conflict_reason: null;
  } = {
    duration_minutes: duration,
    conflict_reason: null,
  };

  if (nextEndTime) updatePayload.end_time = nextEndTime;

  const { error } = await supabase
    .from("day_items")
    .update(updatePayload)
    .eq("id", dayItemId);

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function updateDayItemPlanning(formData: FormData) {
  const { supabase } = await requireUser();
  const dayItemId = z.string().uuid().parse(formData.get("day_item_id"));
  const scheduleMode = z
    .enum(["auto", "pinned", "anchor", "meal"])
    .parse(formData.get("schedule_mode"));
  const priority = z
    .enum(["must", "nice", "maybe"])
    .parse(formData.get("priority"));

  const { error } = await supabase
    .from("day_items")
    .update({
      schedule_mode: scheduleMode,
      priority,
      conflict_reason: null,
    })
    .eq("id", dayItemId);

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function updateDayItemTitle(formData: FormData) {
  const { supabase } = await requireUser();
  const dayItemId = z.string().uuid().parse(formData.get("day_item_id"));
  const title = z.string().min(2).parse(formData.get("title"));

  const { error } = await supabase
    .from("day_items")
    .update({ title, conflict_reason: null })
    .eq("id", dayItemId);

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function addAnchor(formData: FormData) {
  const { supabase } = await requireUser();
  const parsed = z
    .object({
      day_plan_id: z.string().uuid(),
      title: z.string().min(2),
      start_time: z.string().min(5),
      end_time: z.string().min(5),
    })
    .parse(Object.fromEntries(formData));

  const { error } = await supabase.from("day_items").insert({
    ...parsed,
    start_time:
      parsed.start_time.length === 5 ? `${parsed.start_time}:00` : parsed.start_time,
    end_time: parsed.end_time.length === 5 ? `${parsed.end_time}:00` : parsed.end_time,
    item_type: "fixed_anchor",
    duration_minutes: 60,
    schedule_mode: "anchor",
    priority: "must",
  });

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function addSpotToDay(formData: FormData) {
  const { supabase } = await requireUser();
  const dayPlanId = z.string().uuid().parse(formData.get("day_plan_id"));
  const spotId = z.string().uuid().parse(formData.get("spot_id"));
  const title = String(formData.get("title"));
  const duration = z.coerce
    .number()
    .int()
    .min(15)
    .parse(formData.get("duration_minutes"));

  const { count } = await supabase
    .from("day_items")
    .select("id", { count: "exact", head: true })
    .eq("day_plan_id", dayPlanId);

  const { error } = await supabase.from("day_items").insert({
    day_plan_id: dayPlanId,
    item_type: "spot",
    spot_id: spotId,
    title,
    duration_minutes: duration,
    sort_order: count ?? 0,
    schedule_mode: "auto",
    priority: "nice",
  });

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function moveDayItemToDay(formData: FormData) {
  const { supabase } = await requireUser();
  const dayItemId = z.string().uuid().parse(formData.get("day_item_id"));
  const dayPlanId = z.string().uuid().parse(formData.get("day_plan_id"));
  const { data: existing } = await supabase
    .from("day_items")
    .select("item_type, title, schedule_mode")
    .eq("id", dayItemId)
    .single();

  const { count } = await supabase
    .from("day_items")
    .select("id", { count: "exact", head: true })
    .eq("day_plan_id", dayPlanId);

  const { error } = await supabase
    .from("day_items")
    .update({
      day_plan_id: dayPlanId,
      sort_order: count ?? 0,
      start_time: null,
      end_time: null,
      travel_time_from_previous_minutes: null,
      conflict_reason: null,
      schedule_mode:
        existing?.item_type === "fixed_anchor" ? existing.schedule_mode : "auto",
    })
    .eq("id", dayItemId);

  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}

export async function removeDayItem(formData: FormData) {
  const { supabase } = await requireUser();
  const dayItemId = z.string().uuid().parse(formData.get("day_item_id"));
  const { error } = await supabase.from("day_items").delete().eq("id", dayItemId);
  if (error) throw new Error(error.message);
  revalidatePath("/trip");
}
