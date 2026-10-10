export const TIME_RANGES = ["short_term", "medium_term", "long_term"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function isTimeRange(value: unknown): value is TimeRange {
  return typeof value === "string" && (TIME_RANGES as readonly string[]).includes(value);
}

function utcMonthsEarlier(now: Date, months: number): Date {
  const month = now.getUTCMonth() - months;
  const year = now.getUTCFullYear() + Math.floor(month / 12);
  const normalizedMonth = (month % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(year, normalizedMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(
    year,
    normalizedMonth,
    Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  ));
}

// Capture `now` once per request so all queries and derived values agree.
export function rangeStart(range: TimeRange, now: Date): Date | null {
  if (range === "short_term") return new Date(now.getTime() - 28 * DAY_MS);
  if (range === "medium_term") return utcMonthsEarlier(now, 6);
  return null;
}
