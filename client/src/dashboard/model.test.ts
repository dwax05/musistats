import { describe, expect, it } from "vitest";
import { isDashboardData, summarizeLast24Hours } from "./model";

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
      topArtist: "Artist A",
      topTrack: "Song A",
    });
  });
});
