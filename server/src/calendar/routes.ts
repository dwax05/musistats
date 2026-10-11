import type { Express } from "express";
import type { Db } from "mongodb";
import { authPayload, requireAuth } from "../auth/routes";

const TOP_TRACKS_PER_DAY = 5;
// UTC offsets run from -12:00 to +14:00, so this margin covers every local day in the month.
const ZONE_MARGIN_MS = 14 * 60 * 60 * 1000;

export type CalendarPlay = {
  trackId?: string | null;
  name?: string;
  artists?: string[];
  imageUrl?: string | null;
  externalUrl?: string;
  playedAt: Date;
  durationMs?: number;
};

type CalendarTrack = {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
  plays: number;
};

type TrackTally = CalendarTrack & { durationMs: number };
type DayTally = { durationMs: number; plays: number; tracks: Map<string, TrackTally> };

export function isCalendarMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function localDateFormatter(timeZone: unknown): Intl.DateTimeFormat | null {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return null;
  }
}

export function monthQueryWindow(month: string): { start: Date; end: Date } {
  const [year, monthIndex] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year!, monthIndex! - 1, 1) - ZONE_MARGIN_MS),
    end: new Date(Date.UTC(year!, monthIndex!, 1) + ZONE_MARGIN_MS),
  };
}

function knownDuration(play: CalendarPlay): number {
  return typeof play.durationMs === "number" && Number.isFinite(play.durationMs) && play.durationMs >= 0 ? play.durationMs : 0;
}

function normalizedName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

// Imported plays can lack a Spotify track ID, so fall back to the song and artist names.
function trackKey(play: CalendarPlay, artists: string[]): string | null {
  if (typeof play.trackId === "string" && play.trackId) return `id:${play.trackId}`;
  if (typeof play.name !== "string" || !play.name.trim()) return null;
  return `name:${normalizedName(play.name)}|${artists.map(normalizedName).join(",")}`;
}

export function buildCalendar(month: string, format: Intl.DateTimeFormat, plays: Iterable<CalendarPlay>) {
  const days = new Map<string, DayTally>();
  for (const play of plays) {
    if (!(play.playedAt instanceof Date) || Number.isNaN(play.playedAt.getTime())) continue;
    const date = format.format(play.playedAt);
    if (!date.startsWith(`${month}-`)) continue;

    const day = days.get(date) ?? { durationMs: 0, plays: 0, tracks: new Map() };
    const durationMs = knownDuration(play);
    day.durationMs += durationMs;
    day.plays += 1;

    const artists = Array.isArray(play.artists) ? play.artists.filter((name): name is string => typeof name === "string" && Boolean(name)) : [];
    const key = trackKey(play, artists);
    if (key) {
      const track = day.tracks.get(key) ?? {
        id: key,
        name: play.name ?? "Unknown song",
        artists,
        imageUrl: null,
        externalUrl: play.externalUrl ?? (play.trackId ? `https://open.spotify.com/track/${play.trackId}` : ""),
        plays: 0,
        durationMs: 0,
      };
      track.plays += 1;
      track.durationMs += durationMs;
      track.imageUrl ??= play.imageUrl ?? null;
      day.tracks.set(key, track);
    }
    days.set(date, day);
  }

  return [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => ({
      date,
      minutes: Math.round(day.durationMs / 60000),
      plays: day.plays,
      topTracks: [...day.tracks.values()]
        .sort((left, right) => right.plays - left.plays || right.durationMs - left.durationMs || left.name.localeCompare(right.name))
        .slice(0, TOP_TRACKS_PER_DAY)
        .map(({ durationMs: _durationMs, ...track }) => track),
    }));
}

export function registerCalendarRoutes(app: Express, db: Db) {
  app.post("/api/calendar", requireAuth, async (req, res) => {
    const month = req.body?.month;
    if (!isCalendarMonth(month)) return res.status(400).json({ error: "invalid_month" });
    const format = localDateFormatter(req.body?.timeZone);
    if (!format) return res.status(400).json({ error: "invalid_time_zone" });
    const { userId } = authPayload(req);
    const window = monthQueryWindow(month);

    try {
      const cursor = db.collection<CalendarPlay>("RecentPlays")
        .find({ userId, playedAt: { $gte: window.start, $lt: window.end } }, { projection: { trackId: 1, name: 1, artists: 1, imageUrl: 1, externalUrl: 1, playedAt: 1, durationMs: 1 } })
        .sort({ playedAt: 1 });
      res.json({ error: "", month, days: buildCalendar(month, format, await cursor.toArray()) });
    } catch (error) {
      console.error(`Calendar query failed for ${userId}:`, error);
      res.status(503).json({ error: "calendar_unavailable" });
    }
  });
}
