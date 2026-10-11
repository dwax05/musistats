export const TIME_RANGES = ["short_term", "medium_term", "long_term"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];
export const CUSTOM_TIME_RANGE = "custom";
export type AnalyticsRange = TimeRange | typeof CUSTOM_TIME_RANGE;
export type RangeBounds = { start: Date | null; end: Date | null };

const DAY_MS = 24 * 60 * 60 * 1000;

export function isTimeRange(value: unknown): value is TimeRange {
  return typeof value === "string" && (TIME_RANGES as readonly string[]).includes(value);
}

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return isTimeRange(value) || value === CUSTOM_TIME_RANGE;
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
export function rangeStart(range: TimeRange, now: Date): Date {
  if (range === "short_term") return new Date(now.getTime() - 28 * DAY_MS);
  return utcMonthsEarlier(now, range === "medium_term" ? 6 : 12);
}

function dateAtUtcMidnight(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function rangeBounds(range: AnalyticsRange, now: Date, startDate?: unknown, endDate?: unknown): RangeBounds | null {
  if (range !== CUSTOM_TIME_RANGE) return { start: rangeStart(range, now), end: null };
  const start = dateAtUtcMidnight(startDate);
  const end = dateAtUtcMidnight(endDate);
  if (!start || !end || end < start) return null;
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
