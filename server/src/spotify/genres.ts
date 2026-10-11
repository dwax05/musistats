import type { Db } from "mongodb";
import { normalizeForFingerprint } from "../imports/model";
import { getArtistGenresByName, type ArtistSummary } from "./client";

type SpotifyGenreCacheEntry = {
  normalizedName: string;
  artistName: string;
  genres: string[];
  provider: "spotify";
  updatedAt: Date;
};

const LOOKUP_CONCURRENCY = 1;

export async function getSpotifyGenresByArtistName(
  db: Db,
  artistNames: string[],
  getAccessToken: () => Promise<string>,
  knownArtists: Pick<ArtistSummary, "name" | "genres">[] = [],
  options: { lookupMissing?: boolean } = {},
): Promise<Map<string, string[]>> {
  const namesByKey = new Map<string, string>();
  for (const name of artistNames) {
    const trimmed = name.trim();
    const key = normalizeForFingerprint(trimmed);
    if (trimmed && !namesByKey.has(key)) namesByKey.set(key, trimmed);
  }

  const cacheCollection = db.collection<SpotifyGenreCacheEntry>("ArtistNameGenreCache");
  const knownGenres = new Map<string, string[]>();
  for (const artist of knownArtists) {
    const key = normalizeForFingerprint(artist.name);
    const genres = artist.genres?.filter((genre) => genre.trim()) ?? [];
    if (key && genres.length) knownGenres.set(key, genres);
  }

  if (knownGenres.size) {
    await Promise.all([...knownGenres].map(([normalizedName, genres]) => {
      const artistName = namesByKey.get(normalizedName)
        ?? knownArtists.find((artist) => normalizeForFingerprint(artist.name) === normalizedName)?.name
        ?? normalizedName;
      return cacheCollection.updateOne(
        { normalizedName },
        { $set: { normalizedName, artistName, genres, provider: "spotify", updatedAt: new Date() } },
        { upsert: true },
      );
    }));
  }

  const keys = [...namesByKey.keys()];
  const cached = keys.length
    ? await cacheCollection.find({ normalizedName: { $in: keys }, provider: "spotify" }).toArray()
    : [];
  const genresByArtist = new Map(cached.map((entry) => [entry.normalizedName, entry.genres]));
  for (const [key, genres] of knownGenres) genresByArtist.set(key, genres);
  const unresolved = keys.filter((key) => !genresByArtist.has(key));
  if (!unresolved.length || options.lookupMissing === false) return genresByArtist;

  const accessToken = await getAccessToken();
  let nextIndex = 0;
  let failedLookups = 0;
  let stopLookups = false;
  let lastLookupError: unknown;
  const workers = Array.from({ length: Math.min(LOOKUP_CONCURRENCY, unresolved.length) }, async () => {
    while (!stopLookups && nextIndex < unresolved.length) {
      const key = unresolved[nextIndex];
      nextIndex += 1;
      const artistName = namesByKey.get(key);
      if (!artistName) continue;

      let genres: string[];
      try {
        genres = await getArtistGenresByName(accessToken, artistName);
      } catch (error) {
        failedLookups += 1;
        lastLookupError = error;
        stopLookups = true;
        continue;
      }
      await cacheCollection.updateOne(
        { normalizedName: key },
        { $set: { normalizedName: key, artistName, genres, provider: "spotify", updatedAt: new Date() } },
        { upsert: true },
      );
      genresByArtist.set(key, genres);
    }
  });
  await Promise.all(workers);

  if (failedLookups) {
    console.warn(`Spotify artist genre lookup failed for ${failedLookups} artists.`, lastLookupError);
  }

  return genresByArtist;
}
