import { describe, expect, it } from "vitest";
import {
  getOpenHours,
  isMealPlaceholder,
  lookupTravel,
  nearestNeighborOrder,
  reverseSegment,
  scheduleWithDegradation,
  DEFAULT_TRAVEL_MINUTES,
} from "@/lib/scheduling";
import type { DayItem, DayPlan, Spot } from "@/lib/types";

function spot(overrides: Partial<Spot> = {}): Spot {
  return {
    id: "spot-1",
    city_stop_id: "stop-1",
    name: "Somewhere",
    category: "sight",
    duration_minutes: 60,
    indoor_outdoor: "indoor",
    google_place_id: "place-1",
    address: "",
    latitude: 0,
    longitude: 0,
    opening_hours: {},
    source_metadata: {},
    hours_verified_at: null,
    reference_url: "",
    verification_status: "verified",
    ...overrides,
  };
}

function item(overrides: Partial<DayItem> = {}): DayItem {
  return {
    id: "item-1",
    day_plan_id: "plan-1",
    item_type: "spot",
    spot_id: "spot-1",
    title: "Somewhere",
    start_time: null,
    end_time: null,
    duration_minutes: 60,
    sort_order: 0,
    travel_time_from_previous_minutes: null,
    travel_time_is_estimated: false,
    conflict_reason: null,
    schedule_mode: "auto",
    priority: "nice",
    ...overrides,
  };
}

const plan: DayPlan = {
  id: "plan-1",
  city_stop_id: "stop-1",
  plan_date: "2026-11-02", // a Monday
  start_time: "09:00:00",
  end_time: "18:00:00",
};

// Periods use Google's shape: day 0 is Sunday.
const openMonday = {
  periods: [
    { open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
  ],
};

describe("getOpenHours", () => {
  it("reports unknown when Google gave no hours", () => {
    expect(getOpenHours(spot(), "2026-11-02")).toEqual({ status: "unknown" });
  });

  // The bug that started all this: closed and unknown both returned null, and
  // the caller read null as "no constraint".
  it("reports closed when the place does not open that weekday", () => {
    const sundayOnly = {
      periods: [
        { open: { day: 0, hour: 10, minute: 0 }, close: { day: 0, hour: 17, minute: 0 } },
      ],
    };
    expect(getOpenHours(spot({ opening_hours: sundayOnly }), "2026-11-02")).toEqual({
      status: "closed",
    });
  });

  it("reports the open window for that weekday", () => {
    const result = getOpenHours(spot({ opening_hours: openMonday }), "2026-11-02");
    expect(result.status).toBe("open");
    if (result.status === "open") {
      expect(result.windows).toEqual([{ start: 600, end: 1020 }]);
    }
  });

  // A 24/7 place is one period with no close; a naive rewrite calls that closed.
  it("treats an always-open place as open all day", () => {
    const alwaysOpen = { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] };
    const result = getOpenHours(spot({ opening_hours: alwaysOpen }), "2026-11-02");
    expect(result.status).toBe("open");
  });
});

describe("lookupTravel", () => {
  it("costs nothing when there is no previous stop", () => {
    expect(lookupTravel({}, null, "b")).toEqual({ minutes: 0, estimated: false });
  });

  it("uses a real duration when the matrix has one", () => {
    expect(lookupTravel({ "a:b": 22 }, "a", "b")).toEqual({
      minutes: 22,
      estimated: false,
    });
  });

  // The flag exists so the UI never shows a guess as a routed result.
  it("flags the fallback as estimated when the matrix has no entry", () => {
    expect(lookupTravel({}, "a", "b")).toEqual({
      minutes: DEFAULT_TRAVEL_MINUTES,
      estimated: true,
    });
  });
});

describe("nearestNeighborOrder", () => {
  const a = item({ id: "a", spot_id: "a" });
  const b = item({ id: "b", spot_id: "b" });
  const c = item({ id: "c", spot_id: "c" });

  it("leaves short days alone", () => {
    expect(nearestNeighborOrder([a, b], {}, null)).toEqual([a, b]);
  });

  it("starts from the hotel and takes the nearest each time", () => {
    const matrix = {
      "hotel:a": 30,
      "hotel:b": 5,
      "hotel:c": 20,
      "b:a": 10,
      "b:c": 40,
      "a:c": 8,
    };
    const order = nearestNeighborOrder([a, b, c], matrix, "hotel");
    expect(order.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps every item exactly once", () => {
    const order = nearestNeighborOrder([a, b, c], { "a:b": 1 }, "hotel");
    expect(order).toHaveLength(3);
    expect(new Set(order.map((entry) => entry.id)).size).toBe(3);
  });
});

describe("reverseSegment", () => {
  it("reverses only the chosen span", () => {
    const items = ["a", "b", "c", "d"].map((id) => item({ id, spot_id: id }));
    expect(reverseSegment(items, 1, 2).map((entry) => entry.id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("does not mutate the input", () => {
    const items = ["a", "b", "c"].map((id) => item({ id, spot_id: id }));
    reverseSegment(items, 0, 2);
    expect(items.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});

describe("isMealPlaceholder", () => {
  it("recognises a flexible lunch", () => {
    expect(
      isMealPlaceholder(
        item({ item_type: "fixed_anchor", spot_id: null, title: "Lunch", schedule_mode: "meal" }),
      ),
    ).toBe(true);
  });

  it("ignores a pinned meal, which must keep its time", () => {
    expect(
      isMealPlaceholder(
        item({ item_type: "fixed_anchor", spot_id: null, title: "Lunch", schedule_mode: "pinned" }),
      ),
    ).toBe(false);
  });

  it("ignores an ordinary anchor", () => {
    expect(
      isMealPlaceholder(
        item({ item_type: "fixed_anchor", spot_id: null, title: "Airport transfer" }),
      ),
    ).toBe(false);
  });
});

describe("scheduleWithDegradation", () => {
  const base = {
    plan,
    mealItems: [],
    fixedItems: [],
    matrix: {},
    mode: "recalculate" as const,
    startNodeId: null,
  };

  it("schedules a day that fits, dropping nothing", () => {
    const one = item({ id: "i1", spot_id: "s1" });
    const result = scheduleWithDegradation({
      ...base,
      spotItems: [one],
      spots: { s1: spot({ id: "s1" }) },
    });

    expect(result.result.ok).toBe(true);
    expect(result.dropped).toHaveLength(0);
  });

  // Before this, one closed museum left the whole day with no schedule at all.
  it("drops a maybe item rather than failing the whole day", () => {
    const keep = item({ id: "keep", spot_id: "open", priority: "must" });
    const drop = item({ id: "drop", spot_id: "closed", priority: "maybe" });
    const sundayOnly = {
      periods: [
        { open: { day: 0, hour: 10, minute: 0 }, close: { day: 0, hour: 17, minute: 0 } },
      ],
    };

    const result = scheduleWithDegradation({
      ...base,
      spotItems: [keep, drop],
      spots: {
        open: spot({ id: "open" }),
        closed: spot({ id: "closed", name: "Shut Museum", opening_hours: sundayOnly }),
      },
    });

    expect(result.result.ok).toBe(true);
    expect(result.dropped.map((entry) => entry.id)).toEqual(["drop"]);
    expect(result.firstConflict).toContain("closed");
  });

  it("never drops a must item, and reports why the day cannot work", () => {
    const sundayOnly = {
      periods: [
        { open: { day: 0, hour: 10, minute: 0 }, close: { day: 0, hour: 17, minute: 0 } },
      ],
    };
    const result = scheduleWithDegradation({
      ...base,
      spotItems: [item({ id: "must", spot_id: "closed", priority: "must" })],
      spots: { closed: spot({ id: "closed", name: "Shut Museum", opening_hours: sundayOnly }) },
    });

    expect(result.result.ok).toBe(false);
    expect(result.dropped).toHaveLength(0);
    expect(result.firstConflict).toContain("Shut Museum");
  });

  it("drops maybe before nice", () => {
    // A day too short for three 8-hour visits forces two drops.
    const long = { duration_minutes: 480 };
    const result = scheduleWithDegradation({
      ...base,
      spotItems: [
        item({ id: "must", spot_id: "a", priority: "must", ...long }),
        item({ id: "nice", spot_id: "b", priority: "nice", ...long }),
        item({ id: "maybe", spot_id: "c", priority: "maybe", ...long }),
      ],
      spots: { a: spot({ id: "a" }), b: spot({ id: "b" }), c: spot({ id: "c" }) },
    });

    expect(result.result.ok).toBe(true);
    // maybe goes first; nice only goes if still needed.
    expect(result.dropped.map((entry) => entry.id)).toContain("maybe");
  });
});
