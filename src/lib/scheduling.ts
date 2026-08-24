// Pure day-scheduling logic, lifted out of the route handler so it can be
// tested directly. Nothing here touches the network or the database.
import { formatDate, minutesToTime, timeToMinutes } from "@/lib/dates";
import type { DayItem, DayPlan, Spot } from "@/lib/types";

export type Matrix = Record<string, number>;

export type TimeWindow = { start: number; end: number; title?: string };

export const DEFAULT_TRAVEL_MINUTES = 15;

const MAX_EVALUATIONS = 300;

export function isMealPlaceholder(item: DayItem) {
  const title = item.title.toLowerCase();
  return (
    item.item_type === "fixed_anchor" &&
    item.schedule_mode !== "pinned" &&
    (title.includes("lunch") || title.includes("dinner"))
  );
}

export function getMealWindow(item: DayItem): TimeWindow | null {
  const title = item.title.toLowerCase();
  if (title.includes("lunch")) return { start: 12 * 60, end: 14 * 60, title: "Lunch" };
  if (title.includes("dinner")) return { start: 18 * 60, end: 20 * 60, title: "Dinner" };
  return null;
}

// Three explicit states. "unknown" means Google gave us no hours and we stay
// permissive; "closed" means the place is shut on this date and must block.
export type OpenHours =
  | { status: "unknown" }

  | { status: "closed" }

  | { status: "open"; windows: TimeWindow[] };

export function getOpenHours(spot: Spot, planDate: string): OpenHours {
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

function travelFrom(fromNodeId: string | null, to: DayItem, matrix: Matrix) {
  if (!fromNodeId || !to.spot_id) return DEFAULT_TRAVEL_MINUTES;
  return matrix[`${fromNodeId}:${to.spot_id}`] ?? DEFAULT_TRAVEL_MINUTES;
}

// Starts from the hotel when one is set, so the first stop of the day is the
// one nearest where the traveller wakes up rather than an arbitrary pick.
export function nearestNeighborOrder(
  spotItems: DayItem[],
  matrix: Matrix,
  startNodeId: string | null,
) {
  if (spotItems.length < 3) return spotItems;

  const remaining = [...spotItems];
  const order: DayItem[] = [];
  let currentId = startNodeId;

  while (remaining.length) {
    let bestIndex = 0;

    if (currentId) {
      let bestTravel = Infinity;
      remaining.forEach((candidate, index) => {
        const travel = travelFrom(currentId, candidate, matrix);
        if (travel < bestTravel) {
          bestTravel = travel;
          bestIndex = index;
        }
      });
    }

    const next = remaining.splice(bestIndex, 1)[0];
    order.push(next);
    currentId = next.spot_id;
  }

  return order;
}

export function reverseSegment(order: DayItem[], from: number, to: number) {
  return [
    ...order.slice(0, from),
    ...order.slice(from, to + 1).reverse(),
    ...order.slice(to + 1),
  ];
}

// The hotel joins the travel matrix as an ordinary node so the walk from bed to
// first stop is costed like any other leg.
export const HOTEL_NODE_ID = "hotel";

export type MatrixNode = { id: string; latitude: number | null; longitude: number | null };

export function lookupTravel(matrix: Matrix, fromSpotId: string | null, toSpotId: string) {
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

export function findAvailableStart({
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

export function scheduleAutoOrder({
  plan,
  spotItems,
  mealItems,
  fixedItems,
  spots,
  matrix,
  startNodeId,
}: {
  plan: DayPlan;
  spotItems: DayItem[];
  mealItems: DayItem[];
  fixedItems: DayItem[];
  spots: Record<string, Spot>;
  matrix: Matrix;
  startNodeId: string | null;
}) {
  const start = timeToMinutes(plan.start_time);
  const end = timeToMinutes(plan.end_time);
  const fixedWindows = fixedItems
    .map(getFixedWindow)
    .filter(isFixedWindow)
    .sort((a, b) => a.start - b.start);

  let cursor = start;
  // Day one leg is hotel to first stop when a hotel is set.
  let previousSpotId: string | null = startNodeId;
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

export function chooseOptimizedOrder({
  plan,
  spotItems,
  mealItems,
  fixedItems,
  spots,
  matrix,
  startNodeId,
}: {
  plan: DayPlan;
  spotItems: DayItem[];
  mealItems: DayItem[];
  fixedItems: DayItem[];
  spots: Record<string, Spot>;
  matrix: Matrix;
  startNodeId: string | null;
}) {
  const evaluate = (order: DayItem[]) =>
    scheduleAutoOrder({
      plan,
      spotItems: order,
      mealItems,
      fixedItems,
      spots,
      matrix,
      startNodeId,
    });

  // Seed with a nearest-neighbour route, then improve it with 2-opt segment
  // reversals. Bounded work, unlike enumerating every permutation.
  let evaluations = 1;
  let bestOrder = nearestNeighborOrder(spotItems, matrix, startNodeId);
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

// Dropped in this order when the day will not fit. "must" is never dropped.
const DROPPABLE_PRIORITIES = ["maybe", "nice"] as const;

// A single closed or oversized spot used to fail the whole day. Instead, retry
// without the lowest-priority spots until something fits, and report what was
// left out rather than returning nothing.
export function scheduleWithDegradation({
  plan,
  spotItems,
  mealItems,
  fixedItems,
  spots,
  matrix,
  mode,
  startNodeId,
}: {
  plan: DayPlan;
  spotItems: DayItem[];
  mealItems: DayItem[];
  fixedItems: DayItem[];
  spots: Record<string, Spot>;
  matrix: Matrix;
  mode: "recalculate" | "optimize";
  startNodeId: string | null;
}) {
  const run = (candidates: DayItem[]) =>
    mode === "optimize"
      ? chooseOptimizedOrder({
          plan,
          spotItems: candidates,
          mealItems,
          fixedItems,
          spots,
          matrix,
          startNodeId,
        })
      : scheduleAutoOrder({
          plan,
          spotItems: candidates,
          mealItems,
          fixedItems,
          spots,
          matrix,
          startNodeId,
        });

  let candidates = spotItems;
  const dropped: DayItem[] = [];
  let result = run(candidates);
  // Keep the reason the full day failed; it explains the drops that follow.
  const firstConflict = result.ok ? null : result.conflict;

  for (const tier of DROPPABLE_PRIORITIES) {
    if (result.ok) break;

    const droppable = candidates.filter((item) => (item.priority ?? "nice") === tier);
    if (!droppable.length) continue;

    candidates = candidates.filter((item) => (item.priority ?? "nice") !== tier);
    dropped.push(...droppable);
    result = run(candidates);
  }

  return { result, dropped, firstConflict };
}
