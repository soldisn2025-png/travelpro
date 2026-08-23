const dayMs = 24 * 60 * 60 * 1000;

// Calendar dates are anchored to UTC midnight. Building them from local
// midnight and reading them back with toISOString() shifts the date by a day
// for anyone east of UTC, which is most of where this app gets used.
function toUtcMs(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dateRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  const end = toUtcMs(endDate);

  for (let time = toUtcMs(startDate); time <= end; time += dayMs) {
    dates.push(fromUtcMs(time));
  }

  return dates;
}

export function addDays(date: string, days: number) {
  return fromUtcMs(toUtcMs(date) + days * dayMs);
}

export function minutesToTime(minutes: number) {
  const normalized = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  const hours = Math.floor(normalized / 60).toString().padStart(2, "0");
  const mins = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${mins}:00`;
}

export function timeToMinutes(time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function formatTime(time: string | null) {
  if (!time) return "Unscheduled";
  const [hours = "0", minutes = "0"] = time.split(":");
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, Number(hours), Number(minutes)));
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}
