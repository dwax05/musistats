import type { ArtistSummary, TimeRange } from "../spotify/client";

export type GenreWeight = { name: string; weight: number };
export type ArtistWithGenres = ArtistSummary & { genres: string[]; genreWeights?: GenreWeight[] };
export type TasteReplayFrame = { capturedAt: string; genres: GenreWeight[] };
export type TasteReplay = Record<TimeRange, GenreWeight[]>;

export function buildTasteReplay(artistsByRange: Record<TimeRange, ArtistWithGenres[]>): TasteReplay {
  return Object.fromEntries(
    Object.entries(artistsByRange).map(([range, artists]) => {
      const weights = new Map<string, { name: string; weight: number }>();

      artists.forEach((artist, index) => {
        const uniqueGenres = new Map<string, { name: string; weight: number }>();
        if (artist.genreWeights?.length) {
          for (const genre of artist.genreWeights) {
            const name = genre.name.trim();
            const key = name.toLowerCase();
            if (!key || !Number.isFinite(genre.weight) || genre.weight <= 0) continue;
            const current = uniqueGenres.get(key);
            if (current) current.weight += genre.weight;
            else uniqueGenres.set(key, { name, weight: genre.weight });
          }
        } else {
          for (const rawGenre of artist.genres) {
            const name = rawGenre.trim();
            const key = name.toLowerCase();
            if (key && !uniqueGenres.has(key)) uniqueGenres.set(key, { name, weight: 0 });
          }
          const weight = uniqueGenres.size ? 1 / uniqueGenres.size : 0;
          for (const genre of uniqueGenres.values()) genre.weight = weight;
        }
        const artistGenreTotal = [...uniqueGenres.values()].reduce((sum, genre) => sum + genre.weight, 0);
        const genres = [...uniqueGenres.entries()];
        if (!genres.length) return;
        const artistWeight = artists.length - index;

        for (const [key, genre] of genres) {
          const current = weights.get(key);
          const genreWeight = artistWeight * genre.weight / artistGenreTotal;
          if (current) current.weight += genreWeight;
          else weights.set(key, { name: genre.name, weight: genreWeight });
        }
      });

      const totalWeight = [...weights.values()].reduce((total, genre) => total + genre.weight, 0);
      const normalized = [...weights.values()]
        .map(({ name, weight }) => ({ name, weight: weight / totalWeight }))
        .sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name));

      return [range, normalized];
    }),
  ) as TasteReplay;
}
