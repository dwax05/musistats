import type { ApiResponse } from "../auth/AuthProvider";

export type TimeRange = "short_term" | "medium_term" | "long_term";

export type Artist = {
  id: string;
  name: string;
  imageUrl: string | null;
  externalUrl: string;
};

export type Track = {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
};

export type RecentTrack = Track & { playedAt: string };

export type DashboardData = ApiResponse & {
  updatedAt: string | null;
  top: Record<TimeRange, { artists: Artist[]; tracks: Track[] }>;
  recent: RecentTrack[];
};

export const RANGE_LABELS: Record<TimeRange, string> = {
  short_term: "4 weeks",
  medium_term: "6 months",
  long_term: "All time",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDashboardData(value: ApiResponse): value is DashboardData {
  if (value.error !== "" || !isRecord(value.top) || !Array.isArray(value.recent)) return false;
  const top = value.top;
  return (Object.keys(RANGE_LABELS) as TimeRange[]).every((range) => {
    const group = top[range];
    return isRecord(group) && Array.isArray(group.artists) && Array.isArray(group.tracks);
  });
}
