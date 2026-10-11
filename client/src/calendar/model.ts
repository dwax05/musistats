import type { ApiResponse } from "../auth/AuthProvider";

export type CalendarTrack = {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
  plays: number;
};

export type CalendarDay = {
  date: string;
  minutes: number;
  plays: number;
  topTracks: CalendarTrack[];
};

export type CalendarData = { error: ""; month: string; days: CalendarDay[] };
export type CalendarCell = { date: string; day: number; inMonth: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCalendarTrack(value: unknown): value is CalendarTrack {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && Array.isArray(value.artists) && value.artists.every((artist) => typeof artist === "string")
    && (value.imageUrl === null || typeof value.imageUrl === "string")
    && typeof value.externalUrl === "string"
    && isCount(value.plays);
}

export function isCalendarData(value: ApiResponse): value is CalendarData {
  return value.error === "" && typeof value.month === "string" && Array.isArray(value.days) && value.days.every((day) => isRecord(day)
    && typeof day.date === "string"
    && isCount(day.minutes)
    && isCount(day.plays)
    && Array.isArray(day.topTracks) && day.topTracks.every(isCalendarTrack));
}

// en-CA formats as YYYY-MM-DD, in the viewer's own time zone.
export function localDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function shiftMonth(month: string, by: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, monthIndex! - 1 + by, 1)).toISOString().slice(0, 7);
}

// Six Sunday-first weeks, matching the custom range picker.
export function monthGrid(month: string): CalendarCell[] {
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    return { date: day.toISOString().slice(0, 10), day: day.getUTCDate(), inMonth: day.getUTCMonth() === first.getUTCMonth() };
  });
}

// 0 = no listening, 1–4 = quartiles of the month's busiest day.
export function heatLevel(minutes: number, busiest: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0 || busiest <= 0) return 0;
  return Math.min(4, Math.ceil(minutes / busiest * 4)) as 1 | 2 | 3 | 4;
}
