import { normalizeForFingerprint } from "../imports/model";
import type { GenreWeight } from "./model";
import type { TasteReplayFrame } from "./model";

export type ImportedTastePlay = {
  playedAt: Date;
  durationMs: number;
  artists: string[];
};

export type ImportedTasteFrame = {
  capturedAt: string;
  genres: GenreWeight[];
};

const MAX_FRAMES = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const SMOOTHING_RADIUS = 14;
const FRAME_STEP = 7;

export function buildImportedTasteFrames(
  plays: ImportedTastePlay[],
  genresByArtist: Map<string, GenreWeight[]>,
  rangeStart: Date | null,
): { frames: TasteReplayFrame[]; intervalDays: number } {
  const dailyWeights = new Map<string, Map<string, GenreWeight>>();

  for (const play of plays) {
    if (!(play.playedAt instanceof Date) || !Number.isFinite(play.playedAt.getTime())) continue;
    if (typeof play.durationMs !== "number" || !Number.isFinite(play.durationMs) || play.durationMs <= 0) continue;

    const day = play.playedAt.toISOString().slice(0, 10);
    const weights = dailyWeights.get(day) ?? new Map<string, GenreWeight>();
    const artists = new Map<string, string>();
    for (const artist of play.artists) {
      const key = normalizeForFingerprint(artist);
      if (key && !artists.has(key)) artists.set(key, artist);
    }
    if (!artists.size) continue;
    const artistDuration = play.durationMs / artists.size;
    for (const artistKey of artists.keys()) {
      const tags = genresByArtist.get(artistKey) ?? [];
      const uniqueTags = new Map<string, GenreWeight>();
      for (const tag of tags) {
        const name = tag.name.trim();
        const key = normalizeForFingerprint(name);
        if (!key || !Number.isFinite(tag.weight) || tag.weight <= 0) continue;
        const current = uniqueTags.get(key);
        if (current) current.weight += tag.weight;
        else uniqueTags.set(key, { name, weight: tag.weight });
      }
      const totalTagWeight = [...uniqueTags.values()].reduce((sum, tag) => sum + tag.weight, 0);
      if (!totalTagWeight) continue;

      for (const [key, tag] of uniqueTags) {
        const tagWeight = artistDuration * tag.weight / totalTagWeight;
        const current = weights.get(key);
        if (current) current.weight += tagWeight;
        else weights.set(key, { name: tag.name, weight: tagWeight });
      }
    }
    dailyWeights.set(day, weights);
  }

  const days = [...dailyWeights.keys()].sort();
  if (!days.length) return { frames: [], intervalDays: 1 };

  const firstDay = Date.parse(`${days[0]}T00:00:00.000Z`);
  const lastDay = Date.parse(`${days[days.length - 1]}T00:00:00.000Z`);
  const intervalDays = Math.max(1, Math.ceil((lastDay - firstDay + DAY_MS) / (MAX_FRAMES * DAY_MS)));
  const periodCount = Math.floor((lastDay - firstDay) / (intervalDays * DAY_MS)) + 1;
  const rangeStartTime = rangeStart
    ? Date.parse(`${rangeStart.toISOString().slice(0, 10)}T00:00:00.000Z`)
    : firstDay;
  const firstOutputPeriod = Math.max(0, Math.floor((rangeStartTime - firstDay) / (intervalDays * DAY_MS)));
  const selectedPeriodCount = periodCount - firstOutputPeriod;
  const smoothingRadius = Math.min(SMOOTHING_RADIUS, Math.max(1, Math.floor(selectedPeriodCount / 6)));
  const periods = Array.from({ length: periodCount }, () => new Map<string, GenreWeight>());

  for (const day of days) {
    const dayTime = Date.parse(`${day}T00:00:00.000Z`);
    const bucket = Math.floor((dayTime - firstDay) / (intervalDays * DAY_MS));
    const period = periods[bucket];
    if (!period) continue;
    for (const [key, genre] of dailyWeights.get(day) ?? []) {
      const current = period.get(key);
      if (current) current.weight += genre.weight;
      else period.set(key, { ...genre });
    }
  }

  const frames = periods.flatMap((_, index) => {
    if (index < firstOutputPeriod) return [];
    if ((index - firstOutputPeriod) % FRAME_STEP !== 0 && index !== periodCount - 1) return [];

    const start = Math.max(0, index - smoothingRadius);
    const end = Math.min(periods.length - 1, index + smoothingRadius);
    const smoothedWeights = new Map<string, GenreWeight>();
    for (let neighbor = start; neighbor <= end; neighbor += 1) {
      for (const [key, genre] of periods[neighbor] ?? []) {
        const current = smoothedWeights.get(key);
        if (current) current.weight += genre.weight;
        else smoothedWeights.set(key, { ...genre });
      }
    }
    const total = [...smoothedWeights.values()].reduce((sum, genre) => sum + genre.weight, 0);
    const genres = [...smoothedWeights.values()]
      .map(({ name, weight }) => ({ name, weight: weight / total }))
      .sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name));
    const bucketDay = index === periodCount - 1
      ? lastDay
      : firstDay + index * intervalDays * DAY_MS;
    return genres.length
      ? [{ capturedAt: new Date(bucketDay).toISOString(), genres }]
      : [];
  });

  return { frames, intervalDays };
}
