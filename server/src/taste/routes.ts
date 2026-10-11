import { ObjectId, type Db } from "mongodb";
import type { Express } from "express";
import { rangeStart, isTimeRange, type TimeRange } from "../analytics/range";
import { normalizeForFingerprint } from "../imports/model";
import { authPayload, requireAuth } from "../auth/routes";
import type { ArtistSummary } from "../spotify/client";
import { getLastFmGenresByArtistName } from "./lastfm";
import { buildImportedTasteFrames, type ImportedTastePlay } from "./imported";
import { buildTasteReplay, type ArtistWithGenres } from "./model";

const MAX_REPLAY_FRAMES = 365;
const MAX_GENRE_LOOKUPS_PER_BATCH = 25;

type TasteSnapshot = {
  capturedAt?: Date;
  capturedDay: string;
  top?: Record<TimeRange, { artists: (ArtistSummary & { genres?: string[] })[] }>;
};

type ReplaySource = "imported_history" | "spotify_snapshots";
type ReplayStatus = "ready" | "no_snapshots" | "no_genre_data" | "provider_not_configured" | "loading_genres" | "genre_lookup_failed";

type GenreEnrichment = {
  active: boolean;
  failed: boolean;
  lastStartedAt: number;
};

const genreEnrichmentByUser = new Map<string, GenreEnrichment>();
const GENRE_RETRY_DELAY_MS = 30_000;

function replayStatus(
  frames: { genres: unknown[] }[],
  hasHistory: boolean,
): ReplayStatus {
  if (frames.length) return "ready";
  if (!hasHistory) return "no_snapshots";
  return "no_genre_data";
}

function rankImportedArtists(plays: ImportedTastePlay[]): string[] {
  const listeningByArtist = new Map<string, { name: string; weight: number }>();

  for (const play of plays) {
    const artists = [...new Set(play.artists.map((artist) => artist.trim()).filter(Boolean))];
    if (!artists.length) continue;
    const duration = typeof play.durationMs === "number" && play.durationMs > 0
      ? play.durationMs
      : 1;
    for (const name of artists) {
      const key = normalizeForFingerprint(name);
      if (!key) continue;
      const current = listeningByArtist.get(key);
      const weight = duration / artists.length;
      if (current) current.weight += weight;
      else listeningByArtist.set(key, { name, weight });
    }
  }

  return [...listeningByArtist.values()]
    .sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name))
    .map(({ name }) => name);
}

function scheduleGenreEnrichment(
  userId: string,
  db: Db,
  artistNames: string[],
  knownArtists: Pick<ArtistSummary, "name" | "genres">[] = [],
): ReplayStatus {
  const existing = genreEnrichmentByUser.get(userId);
  if (existing?.active) return "loading_genres";
  if (existing?.failed && Date.now() - existing.lastStartedAt < GENRE_RETRY_DELAY_MS) {
    return "genre_lookup_failed";
  }

  if (!process.env.LASTFM_API_KEY?.trim()) return "provider_not_configured";
  const state: GenreEnrichment = { active: true, failed: false, lastStartedAt: Date.now() };
  genreEnrichmentByUser.set(userId, state);
  void getLastFmGenresByArtistName(db, artistNames.slice(0, MAX_GENRE_LOOKUPS_PER_BATCH), knownArtists)
    .then(({ genresByArtist, configured, failed }) => {
      state.failed = failed || !configured;
    })
    .catch((error: unknown) => {
      state.failed = true;
      console.warn("Last.fm taste replay genre enrichment failed.", error);
    })
    .finally(() => {
      state.active = false;
    });
  return "loading_genres";
}

export function registerTasteRoutes(app: Express, db: Db) {
  app.post("/api/taste-replay", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: "unauthorized" });
    const user = await db.collection("Users").findOne({ _id: new ObjectId(userId) });
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const selectedRange: unknown = req.body?.range ?? "medium_term";
    if (!isTimeRange(selectedRange)) return res.status(400).json({ error: "invalid_range" });
    const cutoff = rangeStart(selectedRange, new Date());
    const importedPlays = await db.collection<ImportedTastePlay>("RecentPlays")
      .find({ userId, sourceImportIds: { $type: "array", $ne: [] } })
      .sort({ playedAt: 1 })
      .toArray();

    if (importedPlays.length) {
      const playsInRange = importedPlays
        .filter((play) => !cutoff || play.playedAt >= cutoff);
      const names = rankImportedArtists(playsInRange);
      const { genresByArtist, configured } = await getLastFmGenresByArtistName(db, names, [], { lookupMissing: false });
      const missingNames = [...new Set(names.filter((name) => !genresByArtist.has(normalizeForFingerprint(name))))];
      const { frames, intervalDays } = buildImportedTasteFrames(playsInRange, genresByArtist, cutoff);
      const status = missingNames.length
        ? configured
          ? scheduleGenreEnrichment(userId, db, missingNames)
          : "provider_not_configured"
        : replayStatus(frames, true);
      return res.json({
        error: "",
        range: selectedRange,
        status,
        source: "imported_history" satisfies ReplaySource,
        intervalDays,
        frames,
      });
    }

    const snapshots = await db.collection<TasteSnapshot>("TopSnapshots")
      .find({ userId })
      .sort({ capturedDay: -1 })
      .limit(MAX_REPLAY_FRAMES)
      .toArray();
    const artists = snapshots.flatMap((snapshot) => snapshot.top?.[selectedRange]?.artists ?? []);
    const { genresByArtist, configured } = await getLastFmGenresByArtistName(
      db,
      artists.map((artist) => artist.name),
      artists,
      { lookupMissing: false },
    );
    const missingArtists = artists.filter((artist) => !genresByArtist.has(normalizeForFingerprint(artist.name)));
    const frames = snapshots.reverse().flatMap((snapshot) => {
      const rankedArtists = (snapshot.top?.[selectedRange]?.artists ?? []).map((artist) => ({
        ...artist,
        genreWeights: genresByArtist.get(normalizeForFingerprint(artist.name)),
        genres: (genresByArtist.get(normalizeForFingerprint(artist.name)) ?? artist.genres?.map((name) => ({ name, weight: 1 })) ?? [])
          .map((genre) => genre.name),
      }));
      const tasteReplay = buildTasteReplay({
        short_term: [],
        medium_term: [],
        long_term: [],
        [selectedRange]: rankedArtists,
      });
      const genres = tasteReplay[selectedRange];
      return genres.length
        ? [{
          capturedAt: (snapshot.capturedAt ?? new Date(`${snapshot.capturedDay}T00:00:00.000Z`)).toISOString(),
          genres,
        }]
        : [];
    });
    const status = missingArtists.length
      ? configured
        ? scheduleGenreEnrichment(userId, db, missingArtists.map((artist) => artist.name), missingArtists)
        : "provider_not_configured"
      : replayStatus(frames, snapshots.length > 0);

    return res.json({
      error: "",
      range: selectedRange,
      status: frames.length ? status === "loading_genres" || status === "genre_lookup_failed" ? status : "ready" : status,
      source: "spotify_snapshots" satisfies ReplaySource,
      intervalDays: 1,
      frames,
    });
  });
}
