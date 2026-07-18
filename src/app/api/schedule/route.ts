import { revalidatePath } from "next/cache";
import { z } from "zod";
import { minutesToTime, timeToMinutes } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import type { DayItem, DayPlan, Spot } from "@/lib/types";

const schema = z.object({
  dayPlanId: z.string().uuid(),
  mode: z.enum(["recalculate", "optimize"]).default("recalculate"),
});

type Matrix = Record<string, number>;
type TimeWindow = { start: number; end: number; title?: string };

function isMealPlaceholder(item: DayItem) {
  const title = item.title.toLowerCase();
  return (
    item.item_type === "fixed_anchor" &&
    item.schedule_mode !== "pinned" &&
    (title.includes("lunch") || title.includes("dinner"))
  );
}

function getMealWindow(item: DayItem): TimeWindow | null {
  const title = item.title.toLowerCase();
  if (title.includes("lunch")) return { start: 12 * 60, end: 14 * 60, title: "Lunch" };
  if (title.includes("dinner")) return { start: 18 * 60, end: 20 * 60, title: "Dinner" };
  return null;
}

function getOpenWindows(spot: Spot, planDate: string) {
  const periods = spot.opening_hours?.periods;
  if (!Array.isArray(periods)) return null;

  const day = new Date(`${planDate}T00:00:00`).getDay();
  const windows = periods.flatMap((period) => {
    const value = period as {
      open?: { day?: number; hour?: number; minute?: number };
      close?: { day?: number; hour?: number; minute?: number };
    };
    if (value.open?.day !== day || !value.open || !value.close) return [];

    const open = (value.open.hour ?? 0) * 60 + (value.open.minute ?? 0);
    const closesSameDay = value.close.day === undefined || value.close.day === day;
    const close = closesSameDay
      ? (value.close.hour ?? 23) * 60 + (value.close.minute ?? 59)
      : 23 * 60 + 59;

    return close > open ? [{ start: open, end: close }] : [];
  });

  const sorted = windows.sort((a, b) => a.start - b.start);
  return sorted.length ? sorted : null;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, innerIndex) => innerIndex !== index)).map(
      (rest) => [item, ...rest],
    ),
  );
}

async function getTravelMatrix(spots: Spot[]) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const usable = spots.filter(
    (spot) => spot.latitude !== null && spot.longitude !== null,
  );

  if (!key || usable.length < 2) return {};

  const waypoints = usable.map((spot) => ({
    waypoint: {
      location: {
        latLng: {
          latitude: spot.latitude,
          longitude: spot.longitude,
        },
      },
    },
  }));

  const response = await fetch(
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration",
      },
      body: JSON.stringify({
        origins: waypoints,
        destinations: waypoints,
        travelMode: "TRANSIT",
      }),
    },
  );

  if (!response.ok) return {};

  const rows = (await response.json()) as Array<{
    originIndex: number;
    destinationIndex: number;
    duration?: string;
  }>;

  return rows.reduce<Matrix>((matrix, row) => {
    const from = usable[row.originIndex]?.id;
    const to = usable[row.destinationIndex]?.id;
    const seconds = Number((row.duration ?? "0s").replace("s", ""));
    if (from && to) matrix[`${from}:${to}`] = Math.ceil(seconds / 60);
    return matrix;
  }, {});
}

function getFixedWindow(item: DayItem) {
  if (!item.start_time || !item.end_time) return null;
  if (
    item.schedule_mode === "pinned" ||
    (item.item_type === "fixed_anchor" && item.schedule_mode !== "meal")
  ) {
    return {
      id: item.id,
      start: timeToMinutes(item.start_time),
      end: timeToMinutes(item.end_time),
      title: item.title,
    };
  }

  return null;
}

type FixedWindow = NonNullable<ReturnType<typeof getFixedWindow>>;

function isFixedWindow(value: ReturnType<typeof getFixedWindow>): value is FixedWindow {
  return value !== null;
}

function findAvailableStart({
  earliest,
  duration,
  dayEnd,
  allowedWindows,
  fixedWindows,
}: {
  earliest: number;
  duration: number;
  dayEnd: number;
  allowedWindows: TimeWindow[] | null;
  fixedWindows: FixedWindow[];
}) {
  let candidate = earliest;

  while (candidate + duration <= dayEnd) {
    if (allowedWindows) {
      const window = allowedWindows.find(
        (item) => Math.max(candidate, item.start) + duration <= item.end,
      );
      if (!window) return null;
      candidate = Math.max(candidate, window.start);
    }

    const overlap = fixedWindows.find(
      (item) => candidate < item.end && candidate + duration > item.start,
    );
    if (!overlap) return candidate;
    candidate = overlap.end;
  }

  return null;
}

function scheduleAutoOrder({
  plan,
  spotItems,
  mealItems,
  fixedItems,
  spots,
  matrix,
}: {
  plan: DayPlan;
  spotItems: DayItem[];
  mealItems: DayItem[];
  fixedItems: DayItem[];
  spots: Record<string, Spot>;
  matrix: Matrix;
}) {
  const start = timeToMinutes(plan.start_time);
  const end = timeToMinutes(plan.end_time);
  const fixedWindows = fixedItems
    .map(getFixedWindow)
    .filter(isFixedWindow)
    .sort((a, b) => a.start - b.start);

  let cursor = start;
  let previousSpotId: string | null = null;
  let totalTravel = 0;
  const pendingMeals = [...mealItems].sort((a, b) => {
    const aWindow = getMealWindow(a);
    const bWindow = getMealWindow(b);
    return (aWindow?.start ?? 0) - (bWindow?.start ?? 0);
  });
  const scheduled: Array<
    DayItem & { nextStart: number; nextEnd: number; travel: number }
  > = [];

  function scheduleMeal(item: DayItem, earliest: number) {
    const mealWindow = getMealWindow(item);
    if (!mealWindow) {
      return {
        ok: false as const,
        conflict: `${item.title} does not have a meal window.`,
      };
    }

    const itemStart = findAvailableStart({
      earliest,
      duration: item.duration_minutes,
      dayEnd: end,
      allowedWindows: [mealWindow],
      fixedWindows,
    });

    if (itemStart === null) {
      return {
        ok: false as const,
        conflict: `${item.title} does not fit between ${minutesToTime(mealWindow.start).slice(0, 5)} and ${minutesToTime(mealWindow.end).slice(0, 5)}.`,
      };
    }

    scheduled.push({
      ...item,
      nextStart: itemStart,
      nextEnd: itemStart + item.duration_minutes,
      travel: 0,
    });
    cursor = itemStart + item.duration_minutes;
    return { ok: true as const };
  }

  for (const item of spotItems) {
    const spot = item.spot_id ? spots[item.spot_id] : null;
    if (!spot) {
      return {
        ok: false as const,
        conflict: `${item.title} is not verified.`,
        conflictItemId: item.id,
        items: scheduled,
        travel: totalTravel,
      };
    }

    const travel = previousSpotId ? (matrix[`${previousSpotId}:${spot.id}`] ?? 15) : 0;
    const spotEarliest = cursor + travel;
    const nextMeal = pendingMeals[0];
    const nextMealWindow = nextMeal ? getMealWindow(nextMeal) : null;
    const mealFitsAfterSpot =
      nextMeal && nextMealWindow
        ? Math.max(spotEarliest + item.duration_minutes, nextMealWindow.start) +
            nextMeal.duration_minutes <=
          nextMealWindow.end
        : true;

    if (
      nextMeal &&
      nextMealWindow &&
      (cursor >= nextMealWindow.start ||
        spotEarliest + item.duration_minutes >= nextMealWindow.end ||
        !mealFitsAfterSpot)
    ) {
      const mealResult = scheduleMeal(nextMeal, cursor);
      if (!mealResult.ok) {
        return {
          ok: false as const,
          conflict: mealResult.conflict,
          conflictItemId: nextMeal.id,
          items: scheduled,
          travel: totalTravel,
        };
      }
      pendingMeals.shift();
    }

    const openWindows = getOpenWindows(spot, plan.plan_date);
    const itemStart = findAvailableStart({
      earliest: cursor + travel,
      duration: item.duration_minutes,
      dayEnd: end,
      allowedWindows: openWindows,
      fixedWindows,
    });

    if (itemStart === null) {
      return {
        ok: false as const,
        conflict: `${spot.name} does not fit around opening hours and fixed items.`,
        conflictItemId: item.id,
        items: scheduled,
        travel: totalTravel,
      };
    }

    totalTravel += travel;
    const itemEnd = itemStart + item.duration_minutes;
    if (itemEnd > end) {
      return {
        ok: false as const,
        conflict: `${spot.name} does not fit before the day ends.`,
        conflictItemId: item.id,
        items: scheduled,
        travel: totalTravel,
      };
    }

    scheduled.push({ ...item, nextStart: itemStart, nextEnd: itemEnd, travel });
    cursor = itemEnd;
    previousSpotId = spot.id;
  }

  for (const meal of pendingMeals) {
    const mealResult = scheduleMeal(meal, cursor);
    if (!mealResult.ok) {
      return {
        ok: false as const,
        conflict: mealResult.conflict,
        conflictItemId: meal.id,
        items: scheduled,
        travel: totalTravel,
      };
    }
  }

  return {
    ok: true as const,
    items: scheduled,
    travel: totalTravel,
    conflict: null,
  };
}

function chooseOptimizedOrder({
  plan,
  spotItems,
  mealItems,
  fixedItems,
  spots,
  matrix,
}: {
  plan: DayPlan;
  spotItems: DayItem[];
  mealItems: DayItem[];
  fixedItems: DayItem[];
  spots: Record<string, Spot>;
  matrix: Matrix;
}) {
  const candidates = permutations(spotItems).slice(0, 720);
  let best: ReturnType<typeof scheduleAutoOrder> | null = null;
  let conflict = "No route fits this day window and fixed items.";
  let conflictItemId: string | null = null;

  for (const order of candidates) {
    const result = scheduleAutoOrder({
      plan,
      spotItems: order,
      mealItems,
      fixedItems,
      spots,
      matrix,
    });

    if (result.ok && (!best || result.travel < best.travel)) {
      best = result;
    } else if (!result.ok) {
      conflict = result.conflict;
      conflictItemId = result.conflictItemId ?? null;
    }
  }

  return best ?? { ok: false as const, items: [], travel: 0, conflict, conflictItemId };
}

export async function POST(request: Request) {
  const { dayPlanId, mode } = schema.parse(await request.json());
  const supabase = await createClient();

  const { data: plan, error: planError } = await supabase
    .from("day_plans")
    .select("*")
    .eq("id", dayPlanId)
    .single();
  if (planError) return Response.json({ error: planError.message }, { status: 400 });

  const { data: items, error: itemError } = await supabase
    .from("day_items")
    .select("*")
    .eq("day_plan_id", dayPlanId);
  if (itemError) return Response.json({ error: itemError.message }, { status: 400 });

  const spotIds = (items as DayItem[])
    .map((item) => item.spot_id)
    .filter(Boolean) as string[];
  const { data: spotRows, error: spotError } = spotIds.length
    ? await supabase
        .from("spots")
        .select("*")
        .in("id", spotIds)
        .eq("verification_status", "verified")
    : { data: [], error: null };
  if (spotError) return Response.json({ error: spotError.message }, { status: 400 });

  const spots = (spotRows as Spot[]).reduce<Record<string, Spot>>((acc, spot) => {
    acc[spot.id] = spot;
    return acc;
  }, {});
  const allItems = items as DayItem[];
  const matrix = await getTravelMatrix(Object.values(spots));
  const fixedItems = allItems.filter(
    (item) =>
      item.schedule_mode === "pinned" ||
      (item.item_type === "fixed_anchor" && !isMealPlaceholder(item)),
  );
  const spotItems = allItems
    .filter((item) => item.item_type === "spot" && item.schedule_mode !== "pinned")
    .sort((a, b) => a.sort_order - b.sort_order);
  const mealItems = allItems.filter(isMealPlaceholder);
  const result = mode === "optimize"
    ? chooseOptimizedOrder({
        plan: plan as DayPlan,
        spotItems,
        mealItems,
        fixedItems,
        spots,
        matrix,
      })
    : scheduleAutoOrder({
        plan: plan as DayPlan,
        spotItems,
        mealItems,
        fixedItems,
        spots,
        matrix,
      });

  if (!result.ok) {
    await supabase
      .from("day_items")
      .update({ conflict_reason: null })
      .eq("day_plan_id", dayPlanId);

    await supabase
      .from("day_items")
      .update({ conflict_reason: result.conflict })
      .eq("id", result.conflictItemId ?? "");

    revalidatePath("/trip");
    return Response.json({ ok: false, conflict: result.conflict });
  }

  await supabase
    .from("day_items")
    .update({ conflict_reason: null })
    .eq("day_plan_id", dayPlanId);

  await Promise.all(
    result.items.map((item, index) =>
      supabase
        .from("day_items")
        .update({
          start_time: minutesToTime(item.nextStart),
          end_time: minutesToTime(item.nextEnd),
          sort_order: mode === "optimize" ? index : item.sort_order,
          travel_time_from_previous_minutes: item.travel,
          conflict_reason: null,
        })
        .eq("id", item.id),
    ),
  );

  const dayStart = timeToMinutes((plan as DayPlan).start_time);
  const firstStart = result.items[0]?.nextStart;
  const warning =
    firstStart && firstStart > dayStart
      ? `First auto item starts at ${minutesToTime(firstStart).slice(0, 5)} because earlier time is blocked by opening hours or fixed items.`
      : null;

  revalidatePath("/trip");
  return Response.json({ ok: true, warning });
}
