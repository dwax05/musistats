import type { Db } from "mongodb";
import { normalizeForFingerprint } from "../imports/model";
import type { ArtistSummary } from "../spotify/client";
import type { GenreWeight } from "./model";

const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
const MAX_TAGS_PER_ARTIST = 5;
const LOOKUP_CONCURRENCY = 5;

type ArtistGenreCacheEntry = {
  normalizedName: string;
  artistName: string;
  genres: string[];
  genreWeights?: GenreWeight[];
  provider?: "spotify" | "lastfm";
  updatedAt: Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function equalGenreWeights(genres: string[]): GenreWeight[] {
  const uniqueGenres = [...new Set(genres.map((genre) => genre.trim()).filter(Boolean))];
  const weight = uniqueGenres.length ? 1 / uniqueGenres.length : 0;
  return uniqueGenres.map((name) => ({ name, weight }));
}

function normalizeGenreWeights(genres: GenreWeight[]): GenreWeight[] {
  const uniqueGenres = new Map<string, { name: string; weight: number }>();
  for (const genre of genres) {
    if (typeof genre.name !== "string" || !Number.isFinite(genre.weight) || genre.weight <= 0) continue;
    const name = genre.name.trim();
    const key = normalizeForFingerprint(name);
    if (!key) continue;
    const current = uniqueGenres.get(key);
    if (current) current.weight += genre.weight;
    else uniqueGenres.set(key, { name, weight: genre.weight });
  }
  const total = [...uniqueGenres.values()].reduce((sum, genre) => sum + genre.weight, 0);
  if (!total) return [];
  return [...uniqueGenres.values()]
    .map(({ name, weight }) => ({ name, weight: weight / total }))
    .sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name));
}

function parseTags(value: unknown): GenreWeight[] {
  const topTags = asRecord(asRecord(value)?.toptags);
  const rawTags = topTags?.tag;
  const tags = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
  const parsedTags = tags
    .map(asRecord)
    .filter((tag): tag is Record<string, unknown> => tag !== null)
    .map((tag) => ({
      name: typeof tag.name === "string" ? tag.name.trim() : "",
      count: Number(tag.count),
    }))
    .filter((tag) => tag.name && Number.isFinite(tag.count) && tag.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, MAX_TAGS_PER_ARTIST);
  const totalCount = parsedTags.reduce((sum, tag) => sum + tag.count, 0);
  return parsedTags.map(({ name, count }) => ({ name, weight: count / totalCount }));
}

export async function getLastFmArtistGenres(name: string, apiKey: string): Promise<GenreWeight[]> {
  const params = new URLSearchParams({
    method: "artist.getTopTags",
    artist: name,
    api_key: apiKey,
    format: "json",
  });
  const response = await fetch(`${LASTFM_API_URL}?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Last.fm artist-tag lookup failed (${response.status})`);
  const data: unknown = await response.json();
  const error = asRecord(data)?.error;
  if (error !== undefined) throw new Error(`Last.fm artist-tag lookup failed (${String(error)})`);
  return parseTags(data);
}

export async function getLastFmGenresByArtistName(
  db: Db,
  artistNames: string[],
  knownArtists: Pick<ArtistSummary, "name" | "genres">[] = [],
  options: { lookupMissing?: boolean } = {},
): Promise<{ genresByArtist: Map<string, GenreWeight[]>; configured: boolean; failed: boolean }> {
  const namesByKey = new Map<string, string>();
  for (const name of artistNames) {
    const trimmed = name.trim();
    const key = normalizeForFingerprint(trimmed);
    if (trimmed && !namesByKey.has(key)) namesByKey.set(key, trimmed);
  }

  const cacheCollection = db.collection<ArtistGenreCacheEntry>("ArtistNameGenreCache");
  const keys = [...namesByKey.keys()];
  const cached = keys.length
    ? await cacheCollection.find({ normalizedName: { $in: keys } }).toArray()
    : [];
  const genresByArtist = new Map<string, GenreWeight[]>();
  for (const entry of cached) {
    const weightedGenres = normalizeGenreWeights(entry.genreWeights ?? []);
    if (weightedGenres.length) {
      genresByArtist.set(entry.normalizedName, weightedGenres);
    } else if (entry.provider === "spotify" && entry.genres.length) {
      genresByArtist.set(entry.normalizedName, equalGenreWeights(entry.genres));
    }
  }
  const knownGenres = new Map<string, GenreWeight[]>();
  for (const artist of knownArtists) {
    const key = normalizeForFingerprint(artist.name);
    const genres = artist.genres?.filter((genre) => genre.trim()) ?? [];
    if (key && genres.length) {
      const weightedGenres = equalGenreWeights(genres);
      knownGenres.set(key, weightedGenres);
      genresByArtist.set(key, weightedGenres);
    }
  }

  const apiKey = process.env.LASTFM_API_KEY?.trim();
  if (!apiKey || options.lookupMissing === false) {
    return { genresByArtist, configured: Boolean(apiKey), failed: false };
  }

  if (knownGenres.size) {
    await Promise.all([...knownGenres].map(([normalizedName, genreWeights]) => {
      const artistName = namesByKey.get(normalizedName)
        ?? knownArtists.find((artist) => normalizeForFingerprint(artist.name) === normalizedName)?.name
        ?? normalizedName;
      return cacheCollection.updateOne(
        { normalizedName },
        {
          $set: {
            normalizedName,
            artistName,
            genres: genreWeights.map((genre) => genre.name),
            genreWeights,
            provider: "spotify",
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }));
  }

  const unresolved = keys.filter((key) => !genresByArtist.has(key));
  let nextIndex = 0;
  let failedLookups = 0;
  const workers = Array.from({ length: Math.min(LOOKUP_CONCURRENCY, unresolved.length) }, async () => {
    while (nextIndex < unresolved.length) {
      const key = unresolved[nextIndex];
      nextIndex += 1;
      const artistName = namesByKey.get(key);
      if (!artistName) continue;

      try {
        const genreWeights = await getLastFmArtistGenres(artistName, apiKey);
        await cacheCollection.updateOne(
          { normalizedName: key },
          {
            $set: {
              normalizedName: key,
              artistName,
              genres: genreWeights.map((genre) => genre.name),
              genreWeights,
              provider: "lastfm",
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );
        genresByArtist.set(key, genreWeights);
      } catch (error) {
        failedLookups += 1;
        console.warn(`Last.fm genre lookup failed for artist "${artistName}".`, error);
      }
    }
  });
  await Promise.all(workers);

  return { genresByArtist, configured: true, failed: failedLookups > 0 };
}
