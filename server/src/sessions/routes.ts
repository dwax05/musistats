import { createHash } from "node:crypto";
import type { Express } from "express";
import type { Db } from "mongodb";
import { isAnalyticsRange, rangeBounds } from "../analytics/range";
import { authPayload, requireAuth } from "../auth/routes";

const SESSION_GAP_MS = 45 * 60 * 1000;
const MAX_SESSIONS = 100;

export type StoredPlay = {
  trackId?: string;
  name?: string;
  artists?: string[];
  imageUrl?: string | null;
  externalUrl?: string;
  playedAt: Date;
  durationMs?: number;
  artistIds?: string[];
};

type SessionTrack = {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
  playedAt: string;
};

type ArtistTally = { name: string; imageUrl: string | null; plays: number; durationMs: number };

type SessionCandidate = {
  startedAt: Date;
  endedAt: Date;
  activeDurationMs: number;
  durationAvailable: boolean;
  tracks: SessionTrack[];
  artists: Map<string, ArtistTally>;
};

function knownDuration(play: StoredPlay): number | null {
  return typeof play.durationMs === "number" && Number.isFinite(play.durationMs) && play.durationMs >= 0
    ? play.durationMs
    : null;
}

function normalizedName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function creditedArtists(play: StoredPlay): [string, string][] {
  const artists = Array.isArray(play.artists) ? play.artists.filter((name): name is string => typeof name === "string" && Boolean(name)) : [];
  const ids = Array.isArray(play.artistIds) ? play.artistIds : [];
  const credits = new Map<string, string>();
  artists.forEach((name, index) => {
    const id = ids[index];
    const key = typeof id === "string" && id ? `id:${id}` : `name:${normalizedName(name)}`;
    if (key !== "name:") credits.set(key, name);
  });
  return [...credits];
}

function startSession(play: StoredPlay): SessionCandidate {
  const durationMs = knownDuration(play);
  const candidate: SessionCandidate = {
    startedAt: play.playedAt,
    endedAt: new Date(play.playedAt.getTime() + (durationMs ?? 0)),
    activeDurationMs: durationMs ?? 0,
    durationAvailable: durationMs !== null,
    tracks: [],
    artists: new Map(),
  };
  addPlay(candidate, play);
  return candidate;
}

function addPlay(session: SessionCandidate, play: StoredPlay) {
  const durationMs = knownDuration(play);
  session.endedAt = new Date(play.playedAt.getTime() + (durationMs ?? 0));
  if (durationMs === null) session.durationAvailable = false;
  else session.activeDurationMs += session.tracks.length ? durationMs : 0;

  session.tracks.push({
    id: typeof play.trackId === "string" ? play.trackId : "",
    name: typeof play.name === "string" ? play.name : "",
    artists: Array.isArray(play.artists) ? play.artists.filter((artist): artist is string => typeof artist === "string") : [],
    imageUrl: typeof play.imageUrl === "string" ? play.imageUrl : null,
    externalUrl: typeof play.externalUrl === "string" ? play.externalUrl : "",
    playedAt: play.playedAt.toISOString(),
  });

  for (const [key, name] of creditedArtists(play)) {
    const artist = session.artists.get(key) ?? { name, imageUrl: null, plays: 0, durationMs: 0 };
    artist.plays += 1;
    artist.durationMs += durationMs ?? 0;
    session.artists.set(key, artist);
  }
}

function compareCandidates(left: SessionCandidate, right: SessionCandidate): number {
  return right.activeDurationMs - left.activeDurationMs || right.startedAt.getTime() - left.startedAt.getTime();
}

function keepCandidate(candidates: SessionCandidate[], candidate: SessionCandidate) {
  if (candidates.length < MAX_SESSIONS) {
    candidates.push(candidate);
    return;
  }

  let worstIndex = 0;
  for (let index = 1; index < candidates.length; index += 1) {
    if (compareCandidates(candidates[index], candidates[worstIndex]) > 0) worstIndex = index;
  }
  if (compareCandidates(candidate, candidates[worstIndex]) < 0) candidates[worstIndex] = candidate;
}

function sessionId(userId: string, startedAt: Date): string {
  return `ses_${createHash("sha256").update(`${userId}\n${startedAt.getTime()}`).digest("base64url")}`;
}

function serializeSession(userId: string, session: SessionCandidate) {
  const topArtist = [...session.artists.values()].sort((left, right) => (
    right.plays - left.plays || right.durationMs - left.durationMs || left.name.localeCompare(right.name)
  ))[0] ?? null;

  return {
    id: sessionId(userId, session.startedAt),
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt.toISOString(),
    minutes: session.durationAvailable ? Math.round(session.activeDurationMs / 60000) : null,
    songs: session.tracks.length,
    artists: session.artists.size,
    topArtist: topArtist && { name: topArtist.name, imageUrl: topArtist.imageUrl },
    tracks: session.tracks,
  };
}

class SessionAccumulator {
  private readonly candidates: SessionCandidate[] = [];
  private current: SessionCandidate | null = null;

  add(play: StoredPlay) {
    if (!(play.playedAt instanceof Date) || Number.isNaN(play.playedAt.getTime())) return;
    if (!this.current) {
      this.current = startSession(play);
      return;
    }
    if (play.playedAt.getTime() - this.current.endedAt.getTime() > SESSION_GAP_MS) {
      keepCandidate(this.candidates, this.current);
      this.current = startSession(play);
    } else {
      addPlay(this.current, play);
    }
  }

  result(userId: string) {
    if (this.current) keepCandidate(this.candidates, this.current);
    this.current = null;
    return this.candidates.sort(compareCandidates).map((session) => serializeSession(userId, session));
  }
}

export function buildSessions(userId: string, plays: Iterable<StoredPlay>) {
  const accumulator = new SessionAccumulator();
  for (const play of plays) accumulator.add(play);
  return accumulator.result(userId);
}

export function registerSessionRoutes(app: Express, db: Db) {
  app.post("/api/sessions", requireAuth, async (req, res) => {
    if (!isAnalyticsRange(req.body?.range)) return res.status(400).json({ error: "invalid_range" });

    const { userId } = authPayload(req);
    const now = new Date();
    const bounds = rangeBounds(req.body.range, now, req.body?.startDate, req.body?.endDate);
    if (!bounds) return res.status(400).json({ error: "invalid_range" });
    const filter = bounds.start || bounds.end ? { userId, playedAt: { ...(bounds.start ? { $gte: bounds.start } : {}), ...(bounds.end ? { $lt: bounds.end } : {}) } } : { userId };

    try {
      const cursor = db.collection<StoredPlay>("RecentPlays").find(filter).sort({ playedAt: 1 });
      const sessions = new SessionAccumulator();
      for await (const play of cursor) sessions.add(play);
      res.json({ error: "", sessions: sessions.result(userId) });
    } catch (error) {
      console.error(`Sessions query failed for ${userId}:`, error);
      res.status(503).json({ error: "stats_unavailable" });
    }
  });
}
