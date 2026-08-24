// Minimal RFC 5545 writer. Times are written as floating local time (no Z, no
// TZID) so an event stays at 09:00 in the destination city regardless of the
// phone's timezone, which is what a traveller actually wants.

export type CalendarEvent = {
  uid: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
};

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Content lines are limited to 75 octets; continuations start with a space.
function foldLine(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;

  while (start < bytes.length) {
    const limit = start === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);

    // Never split a multi-byte character.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }

    parts.push(
      (start === 0 ? "" : " ") + bytes.subarray(start, end).toString("utf8"),
    );
    start = end;
  }

  return parts.join("\r\n");
}

function toLocalStamp(date: string, time: string) {
  return `${date.replace(/-/g, "")}T${time.slice(0, 8).replace(/:/g, "")}`;
}

function toUtcStamp(value: Date) {
  return `${value.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

export function buildCalendar(name: string, events: CalendarEvent[]) {
  const stamp = toUtcStamp(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Travelpro//Itinerary//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toLocalStamp(event.date, event.startTime)}`,
      `DTEND:${toLocalStamp(event.date, event.endTime)}`,
      `SUMMARY:${escapeText(event.title)}`,
    );

    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
