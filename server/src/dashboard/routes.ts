import { ObjectId, type Db } from "mongodb";
import type { Express } from "express";
import { isAnalyticsRange, rangeBounds } from "../analytics/range";
import { authPayload, requireAuth } from "../auth/routes";

const EMPTY_TOP = {
  short_term: { artists: [], tracks: [], albums: [] },
  medium_term: { artists: [], tracks: [], albums: [] },
  long_term: { artists: [], tracks: [], albums: [] },
};

type DashboardPlay = {
  trackId?: string;
  name?: string;
  artists?: string[];
  imageUrl?: string | null;
  externalUrl?: string;
  albumName?: string | null;
  playedAt: Date;
  durationMs?: number;
};

type TopItem = { id: string; name: string; artists: string[]; imageUrl: string | null; externalUrl: string; plays?: number };

function searchUrl(query: string) {
  return `https://open.spotify.com/search/${encodeURIComponent(query)}`;
}

export function historyTop(plays: DashboardPlay[]) {
  const artists = new Map<string, { item: TopItem; plays: number }>();
  const tracks = new Map<string, { item: TopItem; plays: number }>();
  const albums = new Map<string, { item: TopItem; plays: number }>();
  const add = (values: Map<string, { item: TopItem; plays: number }>, key: string, item: TopItem) => {
    const value = values.get(key) ?? { item, plays: 0 };
    value.plays += 1;
    values.set(key, value);
  };
  for (const play of plays) {
    const name = typeof play.name === "string" ? play.name : "";
    const artistNames = Array.isArray(play.artists) ? play.artists.filter((artist): artist is string => typeof artist === "string" && Boolean(artist)) : [];
    const imageUrl = typeof play.imageUrl === "string" ? play.imageUrl : null;
    const trackKey = play.trackId?.startsWith("import:") ? `${name}\n${artistNames.join("\n")}` : play.trackId || `${name}\n${artistNames.join("\n")}`;
    if (name) add(tracks, trackKey, { id: play.trackId || `track:${name}`, name, artists: artistNames, imageUrl, externalUrl: typeof play.externalUrl === "string" && play.externalUrl ? play.externalUrl : searchUrl(`${name} ${artistNames.join(" ")}`) });
    for (const artist of artistNames) add(artists, artist, { id: `artist:${artist}`, name: artist, artists: [], imageUrl, externalUrl: searchUrl(artist) });
    if (typeof play.albumName === "string" && play.albumName) add(albums, `${play.albumName}\n${artistNames.join("\n")}`, { id: `album:${play.albumName}`, name: play.albumName, artists: artistNames, imageUrl, externalUrl: searchUrl(`${play.albumName} ${artistNames.join(" ")}`) });
  }
  const rank = (values: Map<string, { item: TopItem; plays: number }>, includePlays = false) => [...values.values()]
    .sort((left, right) => right.plays - left.plays || left.item.name.localeCompare(right.item.name))
    .slice(0, 10)
    .map(({ item, plays }) => includePlays ? { ...item, plays } : item);
  return { artists: rank(artists), tracks: rank(tracks, true), albums: rank(albums) };
}

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
  let hasKnownDuration = false;
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
    hasKnownDuration = true;
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
    minutes: hasKnownDuration || completeDuration ? Math.round(totalDurationMs / 60000) : null,
    minutesComplete: completeDuration,
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

  app.post("/api/dashboard/top", requireAuth, async (req, res) => {
    if (!isAnalyticsRange(req.body?.range)) return res.status(400).json({ error: "invalid_range" });
    const bounds = rangeBounds(req.body.range, new Date(), req.body?.startDate, req.body?.endDate);
    if (!bounds) return res.status(400).json({ error: "invalid_range" });
    const { userId } = authPayload(req);

    try {
      const plays = await db.collection<DashboardPlay>("RecentPlays")
        .find(bounds.start || bounds.end ? { userId, playedAt: { ...(bounds.start ? { $gte: bounds.start } : {}), ...(bounds.end ? { $lt: bounds.end } : {}) } } : { userId })
        .project<DashboardPlay>({ _id: 0, trackId: 1, name: 1, artists: 1, imageUrl: 1, externalUrl: 1, albumName: 1 })
        .toArray();
      res.json({ error: "", top: historyTop(plays) });
    } catch (error) {
      console.error(`Custom top query failed for ${userId}:`, error);
      res.status(503).json({ error: "stats_unavailable" });
    }
  });
}
