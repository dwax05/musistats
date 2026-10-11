import type { Express } from "express";
import type { Db } from "mongodb";
import { CUSTOM_TIME_RANGE, isAnalyticsRange, rangeBounds, rangeStart, type AnalyticsRange, type RangeBounds, type TimeRange } from "../analytics/range";
import { authPayload, requireAuth } from "../auth/routes";

type StoredPlay = {
  playedAt: Date;
  durationMs?: number;
  artists?: string[];
  artistIds?: string[];
};

type Bucket = { start: Date; end: Date; label: string };
type ArtistTally = { name: string; plays: number; durationMs: number; hasKnownDuration: boolean };
type BucketTally = {
  durationMs: number;
  songs: number;
  artists: Set<string>;
};

function normalizedName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function creditedArtists(play: StoredPlay): [string, string][] {
  const names = Array.isArray(play.artists) ? play.artists.filter((name): name is string => typeof name === "string" && Boolean(name)) : [];
  const ids = Array.isArray(play.artistIds) ? play.artistIds : [];
  const artists = new Map<string, string>();
  names.forEach((name, index) => {
    const id = ids[index];
    const key = typeof id === "string" && id ? `id:${id}` : `name:${normalizedName(name)}`;
    if (key !== "name:") artists.set(key, name);
  });
  return [...artists];
}

function knownDuration(play: StoredPlay): number | null {
  return typeof play.durationMs === "number" && Number.isFinite(play.durationMs) && play.durationMs >= 0 ? play.durationMs : null;
}

function labelFor(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
  const span = end.getTime() - start.getTime();
  if (span <= 24 * 60 * 60 * 1000) return day.format(start);
  if (span < 32 * 24 * 60 * 60 * 1000) return `${day.format(start)}–${day.format(new Date(end.getTime() - 1))}`;
  return month.format(start);
}

function buildBuckets(range: AnalyticsRange, now: Date, firstPlay: Date | null, bounds?: RangeBounds): Bucket[] {
  const start = range === CUSTOM_TIME_RANGE ? bounds?.start ?? null : rangeStart(range, now);
  const end = range === CUSTOM_TIME_RANGE ? bounds?.end ?? now : now;
  if (range === "long_term" && !firstPlay) return [];
  const first = range === "long_term" ? firstPlay! : start!;
  const days = (end.getTime() - first.getTime()) / (24 * 60 * 60 * 1000);
  const count = range === "short_term" ? 28 : range === "medium_term" ? 90 : range === "long_term" ? 120 : days <= 31 ? Math.max(1, Math.ceil(days)) : days <= 180 ? 90 : 120;
  const width = (end.getTime() - first.getTime()) / count;
  return Array.from({ length: count }, (_, index) => {
    const bucketStart = new Date(first.getTime() + index * width);
    const bucketEnd = index === count - 1 ? end : new Date(first.getTime() + (index + 1) * width);
    return { start: bucketStart, end: bucketEnd, label: labelFor(bucketStart, bucketEnd) };
  });
}

function bucketFor(buckets: Bucket[], playedAt: Date): number | null {
  if (!buckets.length || playedAt < buckets[0]!.start || playedAt > buckets.at(-1)!.end) return null;
  const start = buckets[0]!.start.getTime();
  const width = (buckets.at(-1)!.end.getTime() - start) / buckets.length;
  if (width === 0) return buckets.length - 1;
  return Math.min(buckets.length - 1, Math.floor((playedAt.getTime() - start) / width));
}

class StatsAccumulator {
  private readonly buckets: Bucket[];
  private readonly tallies: BucketTally[];
  private readonly artists = new Map<string, ArtistTally>();
  private songs = 0;
  private listeningDurationMs = 0;
  private listeningDurationComplete = true;

  constructor(range: AnalyticsRange, now: Date, firstPlay: Date | null, bounds?: RangeBounds) {
    this.buckets = buildBuckets(range, now, firstPlay, bounds);
    this.tallies = this.buckets.map(() => ({ durationMs: 0, songs: 0, artists: new Set() }));
  }

  add(play: StoredPlay) {
    if (!(play.playedAt instanceof Date) || Number.isNaN(play.playedAt.getTime())) return;
    const bucketIndex = bucketFor(this.buckets, play.playedAt);
    if (bucketIndex === null) return;
    const tally = this.tallies[bucketIndex]!;
    const durationMs = knownDuration(play);
    this.songs += 1;
    if (durationMs === null) this.listeningDurationComplete = false;
    else this.listeningDurationMs += durationMs;
    tally.durationMs += durationMs ?? 0;
    tally.songs += 1;
    for (const [key, name] of creditedArtists(play)) {
      tally.artists.add(key);
      const artist = this.artists.get(key) ?? { name, plays: 0, durationMs: 0, hasKnownDuration: false };
      artist.plays += 1;
      artist.durationMs += durationMs ?? 0;
      artist.hasKnownDuration ||= durationMs !== null;
      this.artists.set(key, artist);
    }
  }

  result() {
    const labels = this.buckets.map((bucket) => bucket.label);
    const rank = (value: "plays" | "durationMs") => [...this.artists.values()]
      .filter((artist) => value !== "durationMs" || artist.hasKnownDuration)
      .sort((left, right) => right[value] - left[value] || (value === "plays" ? right.durationMs - left.durationMs : 0) || left.name.localeCompare(right.name))
      .slice(0, 10)
      .map((artist) => ({ name: artist.name, value: value === "durationMs" ? Math.round(artist.durationMs / 60000) : artist.plays }));
    const series = (values: number[]) => ({ labels, values });

    return {
      summary: {
        songs: this.songs,
        artists: this.artists.size,
        listeningMinutes: Math.round(this.listeningDurationMs / 60000),
        listeningMinutesComplete: this.listeningDurationComplete,
      },
      topArtistsByPlays: rank("plays"),
      listeningDistribution: series(this.tallies.map((tally) => Math.round(tally.durationMs / 60000))),
      topArtistsByMinutes: rank("durationMs"),
      songsListened: series(this.tallies.map((tally) => tally.songs)),
      artistsListened: series(this.tallies.map((tally) => tally.artists.size)),
    };
  }
}

export function buildStats(range: AnalyticsRange, now: Date, plays: Iterable<StoredPlay>, firstPlay: Date | null, bounds?: RangeBounds) {
  const accumulator = new StatsAccumulator(range, now, firstPlay, bounds);
  for (const play of plays) accumulator.add(play);
  return accumulator.result();
}

export function registerStatsRoutes(app: Express, db: Db) {
  app.post("/api/stats", requireAuth, async (req, res) => {
    if (!isAnalyticsRange(req.body?.range)) return res.status(400).json({ error: "invalid_range" });
    const { userId } = authPayload(req);
    const now = new Date();
    const bounds = rangeBounds(req.body.range, now, req.body?.startDate, req.body?.endDate);
    if (!bounds) return res.status(400).json({ error: "invalid_range" });
    const filter = bounds.start || bounds.end ? { userId, playedAt: { ...(bounds.start ? { $gte: bounds.start } : {}), ...(bounds.end ? { $lt: bounds.end } : {}) } } : { userId };

    try {
      const first = req.body.range === "long_term"
        ? await db.collection<StoredPlay>("RecentPlays").findOne(filter, { sort: { playedAt: 1 }, projection: { playedAt: 1 } })
        : null;
      const cursor = db.collection<StoredPlay>("RecentPlays").find(filter).sort({ playedAt: 1 });
      const stats = new StatsAccumulator(req.body.range, bounds.end ?? now, first?.playedAt ?? null, bounds);
      for await (const play of cursor) stats.add(play);
      res.json({ error: "", stats: stats.result() });
    } catch (error) {
      console.error(`Stats query failed for ${userId}:`, error);
      res.status(503).json({ error: "stats_unavailable" });
    }
  });
}
