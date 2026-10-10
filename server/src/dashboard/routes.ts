import { ObjectId, type Db } from "mongodb";
import type { Express } from "express";
import { authPayload, requireAuth } from "../auth/routes";

const EMPTY_TOP = {
  short_term: { artists: [], tracks: [] },
  medium_term: { artists: [], tracks: [] },
  long_term: { artists: [], tracks: [] },
};

const SESSION_GAP_MS = 45 * 60 * 1000;
const MAX_SESSION_RESULTS = 20;

type RecentPlayRow = {
  trackId: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
  playedAt: Date | string;
  durationMs?: number | null;
};

export type SessionTrack = {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
  playedAt: string;
  durationMs: number | null;
};

export type DashboardSession = {
  id: string;
  startedAt: string;
  endedAt: string;
  minutes: number | null;
  songs: number;
  artists: number;
  topArtist: { name: string; imageUrl: string | null } | null;
  tracks: SessionTrack[];
};

function trackDurationMs(play: RecentPlayRow): number | null {
  const duration = typeof play.durationMs === "number" && Number.isFinite(play.durationMs) ? play.durationMs : null;
  return duration !== null && duration >= 0 ? duration : null;
}

function normalizeTrack(play: RecentPlayRow): SessionTrack {
  return {
    id: play.trackId,
    name: play.name,
    artists: play.artists,
    imageUrl: play.imageUrl,
    externalUrl: play.externalUrl,
    playedAt: new Date(play.playedAt).toISOString(),
    durationMs: trackDurationMs(play),
  };
}

function topArtistForSession(tracks: SessionTrack[]) {
  const artistCounts = new Map<string, { name: string; imageUrl: string | null; count: number }>();

  for (const track of tracks) {
    for (const artist of track.artists) {
      const current = artistCounts.get(artist);
      if (current) current.count += 1;
      else artistCounts.set(artist, { name: artist, imageUrl: track.imageUrl, count: 1 });
    }
  }

  const winner = [...artistCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0];
  return winner ? { name: winner.name, imageUrl: winner.imageUrl } : null;
}

export function buildSessionsFromRecentPlays(plays: RecentPlayRow[], limit = MAX_SESSION_RESULTS): DashboardSession[] {
  const sorted = [...plays]
    .filter((play) => Number.isFinite(new Date(play.playedAt).getTime()))
    .sort((a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime());

  if (!sorted.length) return [];

  const sessions: DashboardSession[] = [];
  let current: RecentPlayRow[] = [];
  let previousTrackEndMs: number | null = null;

  const flushCurrent = () => {
    if (!current.length) return;

    const tracks = current.map(normalizeTrack);
    const durations = tracks.map((track) => track.durationMs).filter((duration): duration is number => duration !== null && Number.isFinite(duration));
    const minutes = durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / 60000) : null;

    sessions.push({
      id: `${tracks[0].playedAt}-${tracks[tracks.length - 1].playedAt}`,
      startedAt: tracks[0].playedAt,
      endedAt: tracks[tracks.length - 1].playedAt,
      minutes,
      songs: tracks.length,
      artists: new Set(tracks.flatMap((track) => track.artists)).size,
      topArtist: topArtistForSession(tracks),
      tracks,
    });

    current = [];
    previousTrackEndMs = null;
  };

  for (const play of sorted) {
    const playedAt = new Date(play.playedAt).getTime();
    if (!Number.isFinite(playedAt)) continue;

    const durationMs = trackDurationMs(play);
    const endMs = durationMs !== null ? playedAt + durationMs : playedAt;

    if (current.length && previousTrackEndMs !== null && playedAt - previousTrackEndMs > SESSION_GAP_MS) {
      flushCurrent();
    }

    current.push(play);
    previousTrackEndMs = endMs;
  }

  flushCurrent();

  return sessions
    .sort((a, b) => {
      const minutesComparison = (b.minutes ?? 0) - (a.minutes ?? 0);
      if (minutesComparison !== 0) return minutesComparison;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    })
    .slice(0, limit);
}

export function registerDashboardRoutes(app: Express, db: Db) {
  app.post("/api/dashboard", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: "unauthorized" });

    const [user, snapshot, plays] = await Promise.all([
      db.collection("Users").findOne({ _id: new ObjectId(userId) }),
      db.collection("TopSnapshots").findOne({ userId }, { sort: { capturedAt: -1 } }),
      db.collection("RecentPlays").find({ userId }).sort({ playedAt: -1 }).limit(5).toArray(),
    ]);
    if (!user) return res.status(401).json({ error: "unauthorized" });

    res.json({
      error: "",
      updatedAt: user.lastSyncedAt ?? snapshot?.capturedAt ?? null,
      top: snapshot?.top ?? EMPTY_TOP,
      recent: plays.map((play) => ({
        id: play.trackId,
        name: play.name,
        artists: play.artists,
        imageUrl: play.imageUrl,
        externalUrl: play.externalUrl,
        playedAt: play.playedAt,
      })),
    });
  });

  app.post("/api/sessions", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: "unauthorized" });

    const user = await db.collection("Users").findOne({ _id: new ObjectId(userId) });
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const plays = await db.collection("RecentPlays").find({ userId }).sort({ playedAt: -1 }).toArray();
    res.json({
      error: "",
      sessions: buildSessionsFromRecentPlays(plays.map((play) => ({
        trackId: play.trackId,
        name: play.name,
        artists: play.artists,
        imageUrl: play.imageUrl,
        externalUrl: play.externalUrl,
        playedAt: play.playedAt,
        durationMs: typeof play.durationMs === "number" && Number.isFinite(play.durationMs) ? Number(play.durationMs) : null,
      }))),
    });
  });
}
