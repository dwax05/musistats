import type { Db } from "mongodb";
import { normalizeForFingerprint } from "../imports/model";
import type { ArtistSummary } from "./client";

type SpotifyGenreCacheEntry = {
  normalizedName: string;
  artistName: string;
  genres: string[];
  provider: "spotify";
  updatedAt: Date;
};

export async function getSpotifyGenresByArtistName(
  db: Db,
  artistNames: string[],
  knownArtists: Pick<ArtistSummary, "name" | "genres">[] = [],
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
  return genresByArtist;
}
