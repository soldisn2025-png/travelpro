import { describe, expect, it } from "vitest";
import { buildCalendar, type CalendarEvent } from "@/lib/ics";

const BACKSLASH = String.fromCharCode(92);

function unfold(ics: string) {
  return ics.split("\r\n ").join("");
}

const baseEvent: CalendarEvent = {
  uid: "a@travelpro",
  title: "Sagrada Familia",
  date: "2026-11-02",
  startTime: "09:00:00",
  endTime: "11:00:00",
  location: "Carrer de Mallorca, 401, Barcelona, Spain",
  description: "Barcelona - 22 min from previous stop",
};

describe("buildCalendar structure", () => {
  const ics = buildCalendar("Europe 2026", [baseEvent]);

  it("wraps the events in a VCALENDAR", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("uses CRLF line endings throughout", () => {
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it("emits one balanced VEVENT per event", () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(1);
  });

  // Floating time keeps 09:00 showing as 09:00 in the destination city,
  // whatever timezone the traveller's phone is set to.
  it("writes floating local times with no Z and no TZID", () => {
    expect(ics).toContain("DTSTART:20261102T090000\r\n");
    expect(ics).toContain("DTEND:20261102T110000\r\n");
    expect(ics).not.toContain("TZID");
  });

  it("stamps DTSTAMP in UTC", () => {
    expect(/DTSTAMP:\d{8}T\d{6}Z\r\n/.test(ics)).toBe(true);
  });

  it("carries location and description through", () => {
    expect(unfold(ics)).toContain("LOCATION:Carrer de Mallorca");
    expect(unfold(ics)).toContain("22 min from previous stop");
  });

  it("omits optional fields when absent", () => {
    const bare = buildCalendar("Trip", [
      { ...baseEvent, location: undefined, description: undefined },
    ]);
    expect(bare).not.toContain("LOCATION:");
    expect(bare).not.toContain("DESCRIPTION:");
  });
});

describe("buildCalendar escaping", () => {
  const ics = unfold(
    buildCalendar("Trip", [
      {
        ...baseEvent,
        title: "Lunch, dinner; then rest",
        description: `Line one\nline two ${BACKSLASH} backslash`,
      },
    ]),
  );

  it("escapes commas", () => {
    expect(ics).toContain(`Lunch${BACKSLASH}, dinner`);
  });

  it("escapes semicolons", () => {
    expect(ics).toContain(`dinner${BACKSLASH};`);
  });

  it("escapes newlines as literal n rather than breaking the line", () => {
    expect(ics).toContain(`Line one${BACKSLASH}nline two`);
    expect(ics).not.toContain("DESCRIPTION:Line one\r\nline");
  });

  it("doubles backslashes", () => {
    expect(ics).toContain(`${BACKSLASH}${BACKSLASH} backslash`);
  });
});

describe("buildCalendar line folding", () => {
  const longTitle =
    "A very long itinerary entry title that comfortably exceeds the seventy-five octet content line limit set by RFC 5545";
  const korean = "경복궁 야간개장 그리고 아주 긴 한국어 제목 테스트를 위한 문자열입니다";

  it("keeps every line within 75 octets", () => {
    const ics = buildCalendar("Trip", [{ ...baseEvent, title: longTitle }]);
    for (const line of ics.split("\r\n")) {
      expect(Buffer.from(line, "utf8").length).toBeLessThanOrEqual(75);
    }
  });

  it("actually folds, and unfolds back to the original text", () => {
    const ics = buildCalendar("Trip", [{ ...baseEvent, title: longTitle }]);
    expect(ics.split("\r\n").some((line) => line.startsWith(" "))).toBe(true);
    expect(unfold(ics)).toContain(longTitle);
  });

  // Folding on a raw byte count can slice a multi-byte character in half.
  it("never splits a multi-byte character", () => {
    const ics = buildCalendar("Trip", [
      { ...baseEvent, title: korean, location: korean },
    ]);
    expect(unfold(ics)).toContain(korean);
    expect(ics).not.toContain("�");
  });
});
