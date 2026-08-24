import { buildCalendar, type CalendarEvent } from "@/lib/ics";
import { hasSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DayItem, DayPlan, Spot, TripBundle } from "@/lib/types";

// Keyed by share token rather than session so the same URL works as a one-off
// download and as a calendar subscription, which cannot carry a login.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Supabase is not configured." }, { status: 501 });
  }

  const { token } = await params;
  const supabase = createAdminClient();
  const { data: trip, error } = await supabase
    .from("trips")
    .select(
      `
      *,
      city_stops(
        *,
        spots(*),
        day_plans(*, day_items(*))
      )
    `,
    )
    .eq("share_token", token)
    .single();

  if (error || !trip) {
    return Response.json({ error: "Trip not found." }, { status: 404 });
  }

  const bundle = trip as TripBundle;
  const events: CalendarEvent[] = [];

  for (const stop of bundle.city_stops ?? []) {
    const spots = new Map((stop.spots ?? []).map((spot: Spot) => [spot.id, spot]));

    for (const plan of (stop.day_plans ?? []) as Array<
      DayPlan & { day_items: DayItem[] }
    >) {
      for (const item of plan.day_items ?? []) {
        // Unscheduled items have no time and cannot become calendar entries.
        if (!item.start_time || !item.end_time) continue;

        const spot = item.spot_id ? spots.get(item.spot_id) : undefined;
        const details = [
          stop.city,
          item.travel_time_from_previous_minutes
            ? `${item.travel_time_is_estimated ? "~" : ""}${item.travel_time_from_previous_minutes} min from previous stop`
            : null,
        ].filter(Boolean);

        events.push({
          uid: `${item.id}@travelpro`,
          title: item.title,
          date: plan.plan_date,
          startTime: item.start_time,
          endTime: item.end_time,
          location: spot?.address || undefined,
          description: details.join(" - ") || undefined,
        });
      }
    }
  }

  const filename = `${bundle.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "trip"}.ics`;

  return new Response(buildCalendar(bundle.name, events), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
