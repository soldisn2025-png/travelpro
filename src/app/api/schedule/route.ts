import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api";
import { minutesToTime, timeToMinutes } from "@/lib/dates";
import {
  DEFAULT_TRAVEL_MINUTES,
  HOTEL_NODE_ID,
  isMealPlaceholder,
  scheduleWithDegradation,
  type Matrix,
  type MatrixNode,
} from "@/lib/scheduling";
import type { DayItem, DayPlan, Spot, TravelMode } from "@/lib/types";

const schema = z.object({
  dayPlanId: z.string().uuid(),
  mode: z.enum(["recalculate", "optimize"]).default("recalculate"),
});

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const ROUTES_TRAVEL_MODE: Record<TravelMode, string> = {
  walk: "WALK",
  transit: "TRANSIT",
  drive: "DRIVE",
};

// Only TRANSIT is capped at 100 elements; the others allow far more, but one
// conservative chunk size keeps the request shape identical across modes.
const MATRIX_CHUNK_SIZE = 10;

const MATRIX_CACHE_DAYS = 7;

function toWaypoint(node: MatrixNode) {
  return {
    waypoint: {
      location: {
        latLng: { latitude: node.latitude, longitude: node.longitude },
      },
    },
  };
}

// plan_date and start_time are local to the destination city, but the Routes
// API wants an absolute UTC instant. Without the city's offset a 09:00 local
// departure can land in the middle of the night and return no transit at all.
async function getUtcOffsetSeconds(node: MatrixNode, planDate: string, key: string) {
  const timestamp = Math.floor(Date.parse(`${planDate}T12:00:00Z`) / 1000);
  const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${node.latitude},${node.longitude}&timestamp=${timestamp}&key=${key}`;

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

function buildCacheKey(
  nodes: MatrixNode[],
  travelMode: TravelMode,
  departureTime: string | null,
) {
  // Coordinates rather than ids, so moving a hotel or re-verifying a spot
  // produces a different key rather than a stale hit.
  const points = nodes
    .map((node) => `${node.latitude?.toFixed(5)},${node.longitude?.toFixed(5)}`)
    .sort()
    .join("|");

  return `${travelMode}:${departureTime ?? "no-departure"}:${points}`;
}

type MatrixResult = { matrix: Matrix; error: string | null };

async function fetchTravelMatrix({
  usable,
  key,
  travelMode,
  departureTime,
}: {
  usable: MatrixNode[];
  key: string;
  travelMode: TravelMode;
  departureTime: string | null;
}): Promise<MatrixResult> {
  const matrix: Matrix = {};
  const errors: string[] = [];
  const groups = chunk(usable, MATRIX_CHUNK_SIZE);

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
              travelMode: ROUTES_TRAVEL_MODE[travelMode],
              // departureTime is only meaningful where schedules or traffic
              // matter; WALK routes are the same at any hour.
              ...(departureTime && travelMode !== "walk"
                ? { departureTime }
                : {}),
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
    : departureTime === null && travelMode !== "walk"
      ? "Travel times are not date-accurate because the trip date or city timezone could not be resolved."
      : null;

  return { matrix, error };
}

// Reads a cached matrix before calling Google, so repeatedly pressing
// "Auto-plan day" does not re-bill the Routes API for the same journeys.
async function getTravelMatrix({
  supabase,
  nodes,
  plan,
  travelMode,
}: {
  supabase: SupabaseClient;
  nodes: MatrixNode[];
  plan: DayPlan;
  travelMode: TravelMode;
}): Promise<MatrixResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const usable = nodes.filter(
    (node) => node.latitude !== null && node.longitude !== null,
  );

  if (!key) return { matrix: {}, error: "GOOGLE_MAPS_API_KEY is missing." };
  if (usable.length < 2) return { matrix: {}, error: null };

  const offsetSeconds = await getUtcOffsetSeconds(usable[0], plan.plan_date, key);
  const departureTime =
    offsetSeconds === null
      ? null
      : toDepartureTime(plan.plan_date, plan.start_time, offsetSeconds);
  const cacheKey = buildCacheKey(usable, travelMode, departureTime);
  const freshAfter = new Date(
    Date.now() - MATRIX_CACHE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: cached } = await supabase
    .from("travel_matrices")
    .select("matrix")
    .eq("cache_key", cacheKey)
    .gte("created_at", freshAfter)
    .maybeSingle();

  if (cached?.matrix) {
    return { matrix: cached.matrix as Matrix, error: null };
  }

  const result = await fetchTravelMatrix({ usable, key, travelMode, departureTime });

  // Only cache a clean result; a partial matrix would pin bad data for a week.
  if (!result.error && Object.keys(result.matrix).length) {
    await supabase
      .from("travel_matrices")
      .upsert(
        { cache_key: cacheKey, matrix: result.matrix, created_at: new Date().toISOString() },
        { onConflict: "cache_key" },
      );
  }

  return result;
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = await readJson(request, schema);
  if (!parsed.ok) return parsed.response;

  const { dayPlanId, mode } = parsed.data;
  // RLS scopes every read and write below to trips this user owns.
  const { supabase } = auth;

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

  // The hotel anchors the first leg of the day, so it joins the travel matrix.
  const { data: cityStop } = await supabase
    .from("city_stops")
    .select("trip_id, hotel_name, hotel_latitude, hotel_longitude")
    .eq("id", (plan as DayPlan).city_stop_id)
    .single();

  const { data: trip } = cityStop?.trip_id
    ? await supabase
        .from("trips")
        .select("travel_mode")
        .eq("id", cityStop.trip_id)
        .single()
    : { data: null };

  const travelMode = (trip?.travel_mode ?? "transit") as TravelMode;

  const hotel =
    cityStop?.hotel_latitude !== null && cityStop?.hotel_latitude !== undefined
      ? {
          id: HOTEL_NODE_ID,
          latitude: cityStop.hotel_latitude as number,
          longitude: cityStop.hotel_longitude as number,
          name: String(cityStop.hotel_name ?? "your hotel"),
        }
      : null;

  const { matrix, error: matrixError } = await getTravelMatrix({
    supabase,
    nodes: hotel ? [...Object.values(spots), hotel] : Object.values(spots),
    plan: plan as DayPlan,
    travelMode,
  });
  const fixedItems = allItems.filter(
    (item) =>
      item.schedule_mode === "pinned" ||
      (item.item_type === "fixed_anchor" && !isMealPlaceholder(item)),
  );
  const spotItems = allItems
    .filter((item) => item.item_type === "spot" && item.schedule_mode !== "pinned")
    .sort((a, b) => a.sort_order - b.sort_order);
  const mealItems = allItems.filter(isMealPlaceholder);
  const { result, dropped, firstConflict } = scheduleWithDegradation({
    plan: plan as DayPlan,
    spotItems,
    mealItems,
    fixedItems,
    spots,
    matrix,
    mode,
    startNodeId: hotel ? HOTEL_NODE_ID : null,
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
      // firstConflict is the original blocker; result.conflict comes from the
      // most degraded attempt and is usually less useful.
      conflict: firstConflict ?? result.conflict,
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

  // Dropped items stay on the day, unscheduled, with the reason attached so
  // they can be re-prioritised or moved rather than quietly disappearing.
  await Promise.all(
    dropped.map((item) =>
      supabase
        .from("day_items")
        .update({
          start_time: null,
          end_time: null,
          travel_time_from_previous_minutes: null,
          travel_time_is_estimated: false,
          conflict_reason: `Left out to make the day fit (priority: ${item.priority ?? "nice"}).${firstConflict ? ` ${firstConflict}` : ""}`,
        })
        .eq("id", item.id),
    ),
  );

  const dayStart = timeToMinutes((plan as DayPlan).start_time);
  const firstStart = result.items[0]?.nextStart;
  const bufferWarning =
    firstStart && firstStart > dayStart
      ? `First auto item starts at ${minutesToTime(firstStart).slice(0, 5)} because earlier time is blocked by opening hours or fixed items.`
      : null;

  const droppedWarning = dropped.length
    ? `Scheduled ${spotItems.length - dropped.length} of ${spotItems.length} spots. Left out: ${dropped
        .map((item) => item.title)
        .join(", ")}.${firstConflict ? ` ${firstConflict}` : ""}`
    : null;

  // The walk back is not scheduled as an item, but it decides whether the last
  // stop actually fits before the day ends.
  const lastItem = result.items[result.items.length - 1];
  const returnMinutes =
    hotel && lastItem?.spot_id
      ? matrix[`${lastItem.spot_id}:${HOTEL_NODE_ID}`]
      : undefined;
  const returnWarning =
    returnMinutes === undefined
      ? null
      : `Back to ${hotel?.name} about ${returnMinutes} min after the last stop (${minutesToTime(lastItem.nextEnd + returnMinutes).slice(0, 5)}).`;

  const warning =
    [droppedWarning, bufferWarning, returnWarning].filter(Boolean).join(" ") || null;

  const estimatedCount = result.items.filter((item) => item.travelEstimated).length;
  const travelWarning =
    matrixError ??
    (estimatedCount
      ? `${estimatedCount} travel time${estimatedCount === 1 ? "" : "s"} could not be routed and use a ${DEFAULT_TRAVEL_MINUTES} min estimate.`
      : null);

  revalidatePath("/trip");
  return Response.json({ ok: true, warning, travelWarning });
}
