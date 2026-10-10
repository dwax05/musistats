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

export type Album = {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
};

export type RecentTrack = Track & { playedAt: string };

export type TodayStats = {
  songs: number;
  minutes: number | null;
  artists: number;
  topArtist: string | null;
  topTrack: string | null;
};

export type DashboardData = ApiResponse & {
  updatedAt: string | null;
  top: Record<TimeRange, { artists: Artist[]; tracks: Track[]; albums?: Album[] }>;
  recent: RecentTrack[];
  last24Hours?: TodayStats;
};

export const RANGE_LABELS: Record<TimeRange, string> = {
  short_term: "4 weeks",
  medium_term: "6 months",
  long_term: "All time",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTodayStats(value: unknown): value is TodayStats {
  return isRecord(value)
    && typeof value.songs === "number"
    && (typeof value.minutes === "number" || value.minutes === null)
    && typeof value.artists === "number"
    && (typeof value.topArtist === "string" || value.topArtist === null)
    && (typeof value.topTrack === "string" || value.topTrack === null);
}

export function isDashboardData(value: ApiResponse): value is DashboardData {
  if (value.error !== "" || !isRecord(value.top) || !Array.isArray(value.recent)) return false;
  const top = value.top;
  return (value.last24Hours === undefined || isTodayStats(value.last24Hours)) && (Object.keys(RANGE_LABELS) as TimeRange[]).every((range) => {
    const group = top[range];
    return isRecord(group) && Array.isArray(group.artists) && Array.isArray(group.tracks)
      && (group.albums === undefined || Array.isArray(group.albums));
  });
}

export function summarizeLast24Hours(recent: RecentTrack[], now = Date.now()): TodayStats {
  const cutoff = now - 24 * 60 * 60 * 1000;
  const plays = recent.filter((track) => new Date(track.playedAt).getTime() >= cutoff);
  const artists = new Map<string, number>();
  const tracks = new Map<string, number>();

  for (const track of plays) {
    tracks.set(track.name, (tracks.get(track.name) ?? 0) + 1);
    for (const artist of track.artists) artists.set(artist, (artists.get(artist) ?? 0) + 1);
  }

  const mostPlayed = (counts: Map<string, number>) => [...counts].sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  return {
    songs: plays.length,
    minutes: null,
    artists: artists.size,
    topArtist: mostPlayed(artists),
    topTrack: mostPlayed(tracks),
  };
}
