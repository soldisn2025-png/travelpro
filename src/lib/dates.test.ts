import { describe, expect, it } from "vitest";
import { addDays, dateRange } from "@/lib/dates";

// These functions used to build a local-midnight Date and read it back with
// toISOString(), which shifted every date back a day anywhere east of UTC.
// They are now UTC-anchored, so results do not depend on the machine's zone.
describe("dateRange", () => {
  it("includes both ends", () => {
    expect(dateRange("2026-11-01", "2026-11-04")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
  });

  it("handles a single day", () => {
    expect(dateRange("2026-11-01", "2026-11-01")).toEqual(["2026-11-01"]);
  });

  it("crosses a month boundary", () => {
    expect(dateRange("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("crosses the US DST change without duplicating or skipping a day", () => {
    expect(dateRange("2026-10-31", "2026-11-02")).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("crosses the EU DST change without duplicating or skipping a day", () => {
    expect(dateRange("2026-10-24", "2026-10-26")).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
  });

  it("includes a leap day", () => {
    expect(dateRange("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("returns nothing when the range is reversed", () => {
    expect(dateRange("2026-11-04", "2026-11-01")).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(dateRange("", "")).toEqual([]);
  });
});

describe("addDays", () => {
  it("adds days", () => {
    expect(addDays("2026-11-01", 3)).toBe("2026-11-04");
  });

  it("crosses a year boundary", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("crosses a DST change", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("is a no-op for zero", () => {
    expect(addDays("2026-11-01", 0)).toBe("2026-11-01");
  });

  it("subtracts for negative values", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
