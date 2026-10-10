import { ObjectId, type Db } from "mongodb";
import type { Express } from "express";
import { authPayload, requireAuth } from "../auth/routes";

const EMPTY_TOP = {
  short_term: { artists: [], tracks: [] },
  medium_term: { artists: [], tracks: [] },
  long_term: { artists: [], tracks: [] },
};

type DashboardPlay = {
  trackId?: string;
  name?: string;
  artists?: string[];
  imageUrl?: string | null;
  playedAt: Date;
  durationMs?: number;
};

function knownDuration(play: DashboardPlay): number | null {
  return typeof play.durationMs === "number" && Number.isFinite(play.durationMs) && play.durationMs >= 0
    ? play.durationMs
    : null;
}

function mostPlayed(values: Map<string, { count: number; imageUrl: string | null }>) {
  return [...values].sort(([leftName, left], [rightName, right]) => right.count - left.count || leftName.localeCompare(rightName))[0]?.[0] ?? null;
}

export function summarizeLast24Hours(plays: DashboardPlay[]) {
  const artists = new Map<string, { count: number; imageUrl: string | null }>();
  const tracks = new Map<string, { count: number; imageUrl: string | null }>();
  const minutesByHour = Array.from({ length: 24 }, () => 0);
  let totalDurationMs = 0;
  let hasUnknownDuration = false;

  for (const play of plays) {
    const imageUrl = typeof play.imageUrl === "string" ? play.imageUrl : null;
    const trackName = typeof play.name === "string" ? play.name : "";
    if (trackName) {
      const track = tracks.get(trackName) ?? { count: 0, imageUrl };
      track.count += 1;
      tracks.set(trackName, track);
    }
    for (const artistName of Array.isArray(play.artists) ? play.artists : []) {
      if (typeof artistName !== "string" || !artistName) continue;
      const artist = artists.get(artistName) ?? { count: 0, imageUrl };
      artist.count += 1;
      artists.set(artistName, artist);
    }
    const durationMs = knownDuration(play);
    if (durationMs === null) {
      hasUnknownDuration = true;
      continue;
    }
    totalDurationMs += durationMs;
    minutesByHour[play.playedAt.getUTCHours()]! += durationMs / 60000;
  }

  const highlight = (name: string | null, values: Map<string, { count: number; imageUrl: string | null }>) => (
    name ? { name, imageUrl: values.get(name)?.imageUrl ?? null } : null
  );
  const topArtist = mostPlayed(artists);
  const topTrack = mostPlayed(tracks);
  const completeDuration = !hasUnknownDuration;

  return {
    songs: plays.length,
    minutes: completeDuration ? Math.round(totalDurationMs / 60000) : null,
    artists: artists.size,
    topArtist: highlight(topArtist, artists),
    topTrack: highlight(topTrack, tracks),
    ...(completeDuration ? { minutesByHour: minutesByHour.map(Math.round) } : {}),
    playsByHour: plays.reduce((hours, play) => {
      hours[play.playedAt.getUTCHours()]! += 1;
      return hours;
    }, Array.from({ length: 24 }, () => 0)),
  };
}

export function registerDashboardRoutes(app: Express, db: Db) {
  app.post("/api/dashboard", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: "unauthorized" });

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [user, snapshot, plays, last24Hours] = await Promise.all([
      db.collection("Users").findOne({ _id: new ObjectId(userId) }),
      db.collection("TopSnapshots").findOne({ userId }, { sort: { capturedAt: -1 } }),
      db.collection("RecentPlays").find({ userId }).sort({ playedAt: -1 }).limit(5).toArray(),
      db.collection<DashboardPlay>("RecentPlays")
        .find({ userId, playedAt: { $gte: cutoff } })
        .project<DashboardPlay>({ _id: 0, trackId: 1, name: 1, artists: 1, imageUrl: 1, playedAt: 1, durationMs: 1 })
        .toArray(),
    ]);
    if (!user) return res.status(401).json({ error: "unauthorized" });

    res.json({
      error: "",
      updatedAt: user.lastSyncedAt ?? snapshot?.capturedAt ?? null,
      top: snapshot?.top ?? EMPTY_TOP,
      last24Hours: summarizeLast24Hours(last24Hours),
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
}
