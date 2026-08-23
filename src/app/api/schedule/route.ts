import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatDate, minutesToTime, timeToMinutes } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import type { DayItem, DayPlan, Spot } from "@/lib/types";

const schema = z.object({
  dayPlanId: z.string().uuid(),
  mode: z.enum(["recalculate", "optimize"]).default("recalculate"),
});

type Matrix = Record<string, number>;
type TimeWindow = { start: number; end: number; title?: string };

const DEFAULT_TRAVEL_MINUTES = 15;
const MAX_EVALUATIONS = 300;

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

// Three explicit states. "unknown" means Google gave us no hours and we stay
// permissive; "closed" means the place is shut on this date and must block.
type OpenHours =
  | { status: "unknown" }
  | { status: "closed" }
  | { status: "open"; windows: TimeWindow[] };

function getOpenHours(spot: Spot, planDate: string): OpenHours {
  const periods = spot.opening_hours?.periods;
  if (!Array.isArray(periods) || !periods.length) return { status: "unknown" };

  // Google represents an always-open place as one period with no close.
  if (periods.length === 1 && !(periods[0] as { close?: unknown }).close) {
    return { status: "open", windows: [{ start: 0, end: 23 * 60 + 59 }] };
  }

  const day = new Date(`${planDate}T00:00:00`).getDay();
  const windows = periods.flatMap((period) => {
    const value = period as {
      open?: { day?: number; hour?: number; minute?: number };
      close?: { day?: number; hour?: number; minute?: number };
    };
    if (!value.open || !value.close || value.open.day !== day) return [];

    const open = (value.open.hour ?? 0) * 60 + (value.open.minute ?? 0);
    const closesSameDay = value.close.day === undefined || value.close.day === day;
    const close = closesSameDay
      ? (value.close.hour ?? 23) * 60 + (value.close.minute ?? 59)
      : 23 * 60 + 59;

    return close > open ? [{ start: open, end: close }] : [];
  });

  if (!windows.length) return { status: "closed" };
  return { status: "open", windows: windows.sort((a, b) => a.start - b.start) };
}

function travelBetween(from: DayItem, to: DayItem, matrix: Matrix) {
  if (!from.spot_id || !to.spot_id) return DEFAULT_TRAVEL_MINUTES;
  return matrix[`${from.spot_id}:${to.spot_id}`] ?? DEFAULT_TRAVEL_MINUTES;
}

function nearestNeighborOrder(spotItems: DayItem[], matrix: Matrix) {
  if (spotItems.length < 3) return spotItems;

  const remaining = spotItems.slice(1);
  const order = [spotItems[0]];

  while (remaining.length) {
    const previous = order[order.length - 1];
    let bestIndex = 0;
    let bestTravel = Infinity;

    remaining.forEach((candidate, index) => {
      const travel = travelBetween(previous, candidate, matrix);
      if (travel < bestTravel) {
        bestTravel = travel;
        bestIndex = index;
      }
    });

    order.push(remaining.splice(bestIndex, 1)[0]);
  }

  return order;
}

function reverseSegment(order: DayItem[], from: number, to: number) {
  return [
    ...order.slice(0, from),
    ...order.slice(from, to + 1).reverse(),
    ...order.slice(to + 1),
  ];
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toWaypoint(spot: Spot) {
  return {
    waypoint: {
      location: {
        latLng: { latitude: spot.latitude, longitude: spot.longitude },
      },
    },
  };
}

// plan_date and start_time are local to the destination city, but the Routes
// API wants an absolute UTC instant. Without the city's offset a 09:00 local
// departure can land in the middle of the night and return no transit at all.
async function getUtcOffsetSeconds(spot: Spot, planDate: string, key: string) {
  const timestamp = Math.floor(Date.parse(`${planDate}T12:00:00Z`) / 1000);
  const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${spot.latitude},${spot.longitude}&timestamp=${timestamp}&key=${key}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      status?: string;
      rawOffset?: number;
      dstOffset?: number;
    };
    if (data.status !== "OK") return null;

    return (data.rawOffset ?? 0) + (data.dstOffset ?? 0);
  } catch {
    return null;
  }
}

function toDepartureTime(planDate: string, startTime: string, offsetSeconds: number) {
  const [year, month, day] = planDate.split("-").map(Number);
  const utcMs =
    Date.UTC(year, month - 1, day, 0, timeToMinutes(startTime)) -
    offsetSeconds * 1000;

  // The Routes API rejects a departureTime in the past.
  if (utcMs <= Date.now()) return null;
  return new Date(utcMs).toISOString();
}

async function getTravelMatrix(spots: Spot[], plan: DayPlan) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const usable = spots.filter(
    (spot) => spot.latitude !== null && spot.longitude !== null,
  );

  if (!key) return { matrix: {} as Matrix, error: "GOOGLE_MAPS_API_KEY is missing." };
  if (usable.length < 2) return { matrix: {} as Matrix, error: null };

  const offsetSeconds = await getUtcOffsetSeconds(usable[0], plan.plan_date, key);
  const departureTime =
    offsetSeconds === null
      ? null
      : toDepartureTime(plan.plan_date, plan.start_time, offsetSeconds);

  const matrix: Matrix = {};
  const errors: string[] = [];
  // Transit matrices are capped at 100 elements per request.
  const groups = chunk(usable, 10);

  for (const origins of groups) {
    for (const destinations of groups) {
      try {
        const response = await fetch(
          "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": key,
              "X-Goog-FieldMask":
                "originIndex,destinationIndex,duration,condition",
            },
            body: JSON.stringify({
              origins: origins.map(toWaypoint),
              destinations: destinations.map(toWaypoint),
              travelMode: "TRANSIT",
              ...(departureTime ? { departureTime } : {}),
            }),
          },
        );

        if (!response.ok) {
          errors.push(await response.text());
          continue;
        }

        const rows = (await response.json()) as Array<{
          originIndex: number;
          destinationIndex: number;
          duration?: string;
          condition?: string;
        }>;

        for (const row of rows) {
          // Anything other than ROUTE_EXISTS has no usable duration.
          if (row.condition !== "ROUTE_EXISTS" || !row.duration) continue;

          const from = origins[row.originIndex]?.id;
          const to = destinations[row.destinationIndex]?.id;
          if (!from || !to || from === to) continue;

          const seconds = Number(row.duration.replace("s", ""));
          if (!Number.isFinite(seconds)) continue;

          matrix[`${from}:${to}`] = Math.ceil(seconds / 60);
        }
      } catch (routeError) {
        errors.push(
          routeError instanceof Error ? routeError.message : "Route matrix failed.",
        );
      }
    }
  }

  const error = errors.length
    ? `Google could not return travel times (${errors[0].slice(0, 160)}).`
    : departureTime === null
      ? "Travel times are not date-accurate because the trip date or city timezone could not be resolved."
      : null;

  return { matrix, error };
}

function lookupTravel(matrix: Matrix, fromSpotId: string | null, toSpotId: string) {
  if (!fromSpotId) return { minutes: 0, estimated: false };

  const minutes = matrix[`${fromSpotId}:${toSpotId}`];
  return minutes === undefined
    ? { minutes: DEFAULT_TRAVEL_MINUTES, estimated: true }
    : { minutes, estimated: false };
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
    DayItem & {
      nextStart: number;
      nextEnd: number;
      travel: number;
      travelEstimated: boolean;
    }
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
      travelEstimated: false,
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

    const { minutes: travel, estimated: travelEstimated } = lookupTravel(
      matrix,
      previousSpotId,
      spot.id,
    );
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

    const openHours = getOpenHours(spot, plan.plan_date);

    if (openHours.status === "closed") {
      return {
        ok: false as const,
        conflict: `${spot.name} is closed on ${formatDate(plan.plan_date)}.`,
        conflictItemId: item.id,
        items: scheduled,
        travel: totalTravel,
      };
    }

    const itemStart = findAvailableStart({
      earliest: cursor + travel,
      duration: item.duration_minutes,
      dayEnd: end,
      allowedWindows: openHours.status === "open" ? openHours.windows : null,
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

    scheduled.push({
      ...item,
      nextStart: itemStart,
      nextEnd: itemEnd,
      travel,
      travelEstimated,
    });
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
  const evaluate = (order: DayItem[]) =>
    scheduleAutoOrder({ plan, spotItems: order, mealItems, fixedItems, spots, matrix });

  // Seed with a nearest-neighbour route, then improve it with 2-opt segment
  // reversals. Bounded work, unlike enumerating every permutation.
  let evaluations = 1;
  let bestOrder = nearestNeighborOrder(spotItems, matrix);
  let best = evaluate(bestOrder);
  let bestFailure = best.ok ? null : best;

  if (!best.ok) {
    const original = evaluate(spotItems);
    evaluations += 1;

    if (original.ok) {
      best = original;
      bestOrder = spotItems;
    } else if (original.items.length > (bestFailure?.items.length ?? -1)) {
      bestFailure = original;
    }
  }

  let improved = best.ok;

  while (improved && evaluations < MAX_EVALUATIONS) {
    improved = false;

    for (let i = 0; i < bestOrder.length - 1 && evaluations < MAX_EVALUATIONS; i += 1) {
      for (let j = i + 1; j < bestOrder.length && evaluations < MAX_EVALUATIONS; j += 1) {
        const candidateOrder = reverseSegment(bestOrder, i, j);
        const candidate = evaluate(candidateOrder);
        evaluations += 1;

        if (candidate.ok && (!best.ok || candidate.travel < best.travel)) {
          best = candidate;
          bestOrder = candidateOrder;
          improved = true;
        }
      }
    }
  }

  if (best.ok) return best;

  return (
    bestFailure ?? {
      ok: false as const,
      items: [],
      travel: 0,
      conflict: "No route fits this day window and fixed items.",
      conflictItemId: null,
    }
  );
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
  const { matrix, error: matrixError } = await getTravelMatrix(
    Object.values(spots),
    plan as DayPlan,
  );
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
    return Response.json({
      ok: false,
      conflict: result.conflict,
      travelWarning: matrixError,
    });
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
          travel_time_is_estimated: item.travelEstimated,
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

  const estimatedCount = result.items.filter((item) => item.travelEstimated).length;
  const travelWarning =
    matrixError ??
    (estimatedCount
      ? `${estimatedCount} travel time${estimatedCount === 1 ? "" : "s"} could not be routed and use a ${DEFAULT_TRAVEL_MINUTES} min estimate.`
      : null);

  revalidatePath("/trip");
  return Response.json({ ok: true, warning, travelWarning });
}
