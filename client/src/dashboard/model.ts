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

export type ListeningHighlight = {
  name: string;
  imageUrl: string | null;
};

export type ListeningSession = {
  id: string;
  startedAt: string;
  endedAt: string;
  minutes: number | null;
  songs: number;
  artists: number;
  topArtist: ListeningHighlight | null;
  tracks: RecentTrack[];
};

export type SessionsData = ApiResponse & { sessions: ListeningSession[] };

export type TodayStats = {
  songs: number;
  minutes: number | null;
  artists: number;
  topArtist: ListeningHighlight | null;
  topTrack: ListeningHighlight | null;
  minutesByHour?: number[];
  playsByHour?: number[];
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
    && (isListeningHighlight(value.topArtist) || value.topArtist === null)
    && (isListeningHighlight(value.topTrack) || value.topTrack === null)
    && (value.minutesByHour === undefined || isHourlySeries(value.minutesByHour))
    && (value.playsByHour === undefined || isHourlySeries(value.playsByHour));
}

function isListeningHighlight(value: unknown): value is ListeningHighlight {
  return isRecord(value) && typeof value.name === "string" && (typeof value.imageUrl === "string" || value.imageUrl === null);
}

function isHourlySeries(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 24 && value.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0);
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

export function isSessionsData(value: ApiResponse): value is SessionsData {
  return value.error === "" && Array.isArray(value.sessions) && value.sessions.every((session) => isRecord(session)
    && typeof session.id === "string"
    && typeof session.startedAt === "string"
    && typeof session.endedAt === "string"
    && (session.minutes === null || typeof session.minutes === "number" && Number.isFinite(session.minutes) && session.minutes >= 0)
    && typeof session.songs === "number" && Number.isInteger(session.songs) && session.songs >= 0
    && typeof session.artists === "number" && Number.isInteger(session.artists) && session.artists >= 0
    && (isListeningHighlight(session.topArtist) || session.topArtist === null)
    && Array.isArray(session.tracks));
}

export function summarizeLast24Hours(recent: RecentTrack[], now = Date.now()): TodayStats {
  const cutoff = now - 24 * 60 * 60 * 1000;
  const plays = recent.filter((track) => new Date(track.playedAt).getTime() >= cutoff);
  const artists = new Map<string, number>();
  const tracks = new Map<string, number>();
  const artistImages = new Map<string, string | null>();
  const trackImages = new Map<string, string | null>();
  const playsByHour = Array.from({ length: 24 }, () => 0);

  for (const track of plays) {
    tracks.set(track.name, (tracks.get(track.name) ?? 0) + 1);
    trackImages.set(track.name, track.imageUrl);
    playsByHour[new Date(track.playedAt).getHours()] += 1;
    for (const artist of track.artists) {
      artists.set(artist, (artists.get(artist) ?? 0) + 1);
      artistImages.set(artist, track.imageUrl);
    }
  }

  const mostPlayed = (counts: Map<string, number>) => [...counts].sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
  const highlight = (name: string | null, images: Map<string, string | null>): ListeningHighlight | null => name ? { name, imageUrl: images.get(name) ?? null } : null;

  return {
    songs: plays.length,
    minutes: null,
    artists: artists.size,
    topArtist: highlight(mostPlayed(artists), artistImages),
    topTrack: highlight(mostPlayed(tracks), trackImages),
    playsByHour,
  };
}
