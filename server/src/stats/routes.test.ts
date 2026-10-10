import { describe, expect, it } from "vitest";
import { buildStats } from "./routes";

const now = new Date("2026-10-10T00:00:00.000Z");

describe("stats aggregation", () => {
  it("keeps every graph aligned and calculates collaborators and release dates", () => {
    const stats = buildStats("short_term", now, [{
      playedAt: new Date("2026-09-12T00:00:00.000Z"),
      durationMs: 120000,
      artists: ["Lead", "Guest"],
      artistIds: ["lead", "guest"],
      albumArtistIds: ["lead"],
      albumReleaseDate: "2020-04",
      albumReleaseDatePrecision: "month",
    }, {
      playedAt: new Date("2026-09-13T00:00:00.000Z"),
      durationMs: 60000,
      artists: ["Lead"],
      artistIds: ["lead"],
      albumArtistIds: ["lead"],
      albumReleaseDate: "2010",
      albumReleaseDatePrecision: "year",
    }], null);

    expect(stats.topArtistsByPlays).toEqual([{ name: "Lead", value: 2 }, { name: "Guest", value: 1 }]);
    expect(stats.topArtistsByMinutes).toEqual([{ name: "Lead", value: 3 }, { name: "Guest", value: 2 }]);
    for (const series of Object.values(stats).filter((value): value is { labels: string[]; values: number[] } => "labels" in value)) {
      expect(series.labels).toHaveLength(28);
      expect(series.values).toHaveLength(28);
    }
    expect(stats.songsListened.values[0]).toBe(1);
    expect(stats.artistsListened.values[0]).toBe(2);
    expect(stats.averageFeaturesPerSong.values[0]).toBe(1);
    expect(stats.averageAlbumReleaseYear.values[0]).toBeGreaterThan(2020.2);
  });

  it("uses zeros for empty numeric buckets and an empty all-time history", () => {
    const stats = buildStats("short_term", now, [], null);
    expect(stats.listeningDistribution.values.every((value) => value === 0)).toBe(true);
    expect(stats.averageAlbumReleaseYear.values.every((value) => value === 0)).toBe(true);
    expect(buildStats("long_term", now, [], null).songsListened).toEqual({ labels: [], values: [] });
  });

  it("does not rank artists with no known listening duration as zero-minute results", () => {
    const stats = buildStats("short_term", now, [{
      playedAt: new Date("2026-09-12T00:00:00.000Z"),
      artists: ["Artist A"],
      artistIds: ["artist-a"],
    }], null);

    expect(stats.topArtistsByMinutes).toEqual([]);
  });

  it("only ranks the portion of a mixed legacy history with known durations", () => {
    const stats = buildStats("short_term", now, [{
      playedAt: new Date("2026-09-12T00:00:00.000Z"),
      durationMs: 720000,
      artists: ["Only Enriched Artist"],
      artistIds: ["enriched"],
    }, {
      playedAt: new Date("2026-09-13T00:00:00.000Z"),
      artists: ["Legacy Artist"],
      artistIds: ["legacy"],
    }], null);

    expect(stats.topArtistsByMinutes).toEqual([{ name: "Only Enriched Artist", value: 12 }]);
  });
});
