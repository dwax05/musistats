import { describe, expect, it } from "vitest";
import { isDashboardData, isSessionsData, isStatsData, summarizeLast24Hours } from "./model";

describe("dashboard response validation", () => {
  it("accepts the dashboard shape and rejects incomplete data", () => {
    const top = {
      short_term: { artists: [], tracks: [] },
      medium_term: { artists: [], tracks: [] },
      long_term: { artists: [], tracks: [] },
    };
    expect(isDashboardData({ error: "", top, recent: [], updatedAt: null })).toBe(true);
    expect(isDashboardData({ error: "", top: {}, recent: [] })).toBe(false);
  });

  it("summarizes the rolling last 24 hours from recent plays", () => {
    const now = Date.now();
    const recent = [
      { id: "1", name: "Song A", artists: ["Artist A"], imageUrl: null, externalUrl: "", playedAt: new Date(now - 23 * 60 * 60 * 1000).toISOString() },
      { id: "2", name: "Song A", artists: ["Artist A", "Artist B"], imageUrl: null, externalUrl: "", playedAt: new Date(now - 60 * 60 * 1000).toISOString() },
      { id: "3", name: "Song B", artists: ["Artist C"], imageUrl: null, externalUrl: "", playedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() },
    ];

    expect(summarizeLast24Hours(recent, now)).toMatchObject({
      songs: 2,
      minutes: null,
      artists: 2,
      topArtist: { name: "Artist A", imageUrl: null },
      topTrack: { name: "Song A", imageUrl: null },
    });
    expect(summarizeLast24Hours(recent, now).playsByHour?.reduce((total, plays) => total + plays, 0)).toBe(2);
  });

  it("accepts sessions returned by the sessions endpoint", () => {
    expect(isSessionsData({
      error: "",
      sessions: [{
        id: "session-1",
        startedAt: "2026-10-10T18:00:00.000Z",
        endedAt: "2026-10-10T19:00:00.000Z",
        minutes: 60,
        songs: 12,
        artists: 4,
        topArtist: { name: "Artist A", imageUrl: null },
        tracks: [],
      }],
    })).toBe(true);
    expect(isSessionsData({ error: "", sessions: [{ id: "session-1" }] })).toBe(false);
  });

  it("accepts graph data returned by the stats endpoint", () => {
    const series = { labels: ["Mon"], values: [1] };
    const metrics = [{ name: "Artist A", value: 3 }];
    expect(isStatsData({
      error: "",
      stats: {
        topArtistsByPlays: metrics,
        listeningDistribution: series,
        topArtistsByMinutes: metrics,
        songsListened: series,
        artistsListened: series,
        averageAlbumReleaseYear: series,
        averageFeaturesPerSong: series,
      },
    })).toBe(true);
    expect(isStatsData({ error: "", stats: { topArtistsByPlays: metrics } })).toBe(false);
  });
});
