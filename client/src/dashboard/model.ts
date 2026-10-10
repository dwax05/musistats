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
  plays?: number;
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

export type ChartSeries = {
  labels: string[];
  values: number[];
};

export type RankedMetric = {
  name: string;
  value: number;
};

export type StatsData = {
  topArtistsByPlays: RankedMetric[];
  listeningDistribution: ChartSeries;
  topArtistsByMinutes: RankedMetric[];
  songsListened: ChartSeries;
  artistsListened: ChartSeries;
};

export type StatsResponse = ApiResponse & { stats: StatsData };
export type TopData = DashboardData["top"][TimeRange];
export type TopResponse = ApiResponse & { top: TopData };

export type GenreShare = { name: string; weight: number };
export type TasteReplayFrame = { capturedAt: string; genres: GenreShare[] };
export type TasteReplayStatus = "ready" | "no_snapshots" | "no_genre_data" | "provider_not_configured" | "loading_genres" | "genre_lookup_failed";
export type TasteReplaySource = "imported_history" | "spotify_snapshots";
export type TasteReplayData = ApiResponse & {
  range: TimeRange;
  status: TasteReplayStatus;
  source: TasteReplaySource;
  intervalDays: number;
  frames: TasteReplayFrame[];
};

export type TodayStats = {
  songs: number;
  minutes: number | null;
  minutesComplete: boolean;
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
    && typeof value.minutesComplete === "boolean"
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

function isChartSeries(value: unknown): value is ChartSeries {
  return isRecord(value)
    && Array.isArray(value.labels)
    && value.labels.every((label) => typeof label === "string")
    && Array.isArray(value.values)
    && value.values.length === value.labels.length
    && value.values.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0);
}

function isRankedMetric(value: unknown): value is RankedMetric {
  return isRecord(value) && typeof value.name === "string" && typeof value.value === "number" && Number.isFinite(value.value) && value.value >= 0;
}

function isTopData(value: unknown): value is TopData {
  if (!isRecord(value)) return false;
  const item = (entry: unknown) => isRecord(entry)
    && typeof entry.id === "string"
    && typeof entry.name === "string"
    && Array.isArray(entry.artists)
    && entry.artists.every((artist) => typeof artist === "string")
    && (typeof entry.imageUrl === "string" || entry.imageUrl === null)
    && typeof entry.externalUrl === "string"
    && (entry.plays === undefined || typeof entry.plays === "number" && Number.isInteger(entry.plays) && entry.plays >= 0);
  return Array.isArray(value.artists) && value.artists.every(item)
    && Array.isArray(value.tracks) && value.tracks.every(item)
    && (value.albums === undefined || Array.isArray(value.albums) && value.albums.every(item));
}

export function isStatsData(value: ApiResponse): value is StatsResponse {
  if (value.error !== "" || !isRecord(value.stats)) return false;
  const stats = value.stats;
  return Array.isArray(stats.topArtistsByPlays)
    && stats.topArtistsByPlays.every(isRankedMetric)
    && isChartSeries(stats.listeningDistribution)
    && Array.isArray(stats.topArtistsByMinutes)
    && stats.topArtistsByMinutes.every(isRankedMetric)
    && isChartSeries(stats.songsListened)
    && isChartSeries(stats.artistsListened);
}

export function isTopDataResponse(value: ApiResponse): value is TopResponse {
  return value.error === "" && isTopData(value.top);
}

export function isTasteReplayData(value: ApiResponse): value is TasteReplayData {
  return value.error === ""
    && (Object.keys(RANGE_LABELS) as TimeRange[]).includes(value.range as TimeRange)
    && (value.status === "ready"
      || value.status === "no_snapshots"
      || value.status === "no_genre_data"
      || value.status === "provider_not_configured"
      || value.status === "loading_genres"
      || value.status === "genre_lookup_failed")
    && (value.source === "imported_history" || value.source === "spotify_snapshots")
    && typeof value.intervalDays === "number"
    && Number.isInteger(value.intervalDays)
    && value.intervalDays >= 1
    && Array.isArray(value.frames)
    && value.frames.every((frame) => isRecord(frame)
      && typeof frame.capturedAt === "string"
      && Number.isFinite(Date.parse(frame.capturedAt))
      && Array.isArray(frame.genres)
      && frame.genres.every((genre) => isRecord(genre)
        && typeof genre.name === "string"
        && typeof genre.weight === "number"
        && Number.isFinite(genre.weight)
        && genre.weight >= 0
        && genre.weight <= 1));
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
    minutesComplete: false,
    artists: artists.size,
    topArtist: highlight(mostPlayed(artists), artistImages),
    topTrack: highlight(mostPlayed(tracks), trackImages),
    playsByHour,
  };
}
