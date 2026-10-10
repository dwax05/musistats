import { describe, expect, it } from "vitest";
import { buildSessions, type StoredPlay } from "./routes";

function play(playedAt: string, durationMs: number | undefined, artists = ["Artist A"]): StoredPlay {
  return {
    trackId: `track-${playedAt}`,
    name: "Song",
    artists,
    artistIds: artists.map((artist) => artist.toLowerCase().replaceAll(" ", "-")),
    imageUrl: null,
    externalUrl: "https://open.spotify.com/track/test",
    playedAt: new Date(playedAt),
    durationMs,
  };
}

describe("session aggregation", () => {
  it("keeps a 45-minute gap in one session and splits at one millisecond over", () => {
    const sessions = buildSessions("user-1", [
      play("2026-10-10T12:00:00.000Z", 60_000),
      play("2026-10-10T12:46:00.000Z", 60_000),
      play("2026-10-10T13:32:00.001Z", 60_000),
    ]);

    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.songs).sort()).toEqual([1, 2]);
  });

  it("keeps repeated plays, credits collaborators once, and marks missing duration unavailable", () => {
    const sessions = buildSessions("user-1", [
      play("2026-10-10T12:00:00.000Z", 120_000, ["Lead", "Guest"]),
      play("2026-10-10T12:03:00.000Z", undefined, ["Lead", "Guest"]),
    ]);

    expect(sessions).toMatchObject([{
      songs: 2,
      artists: 2,
      minutes: null,
      topArtist: { name: "Guest" },
    }]);
  });

  it("returns the 100 longest sessions in rank order", () => {
    const sessions = buildSessions("user-1", Array.from({ length: 101 }, (_, index) => (
      play(new Date(Date.UTC(2026, 0, 1, index * 2)).toISOString(), (index + 1) * 1000)
    )));

    expect(sessions).toHaveLength(100);
    expect(sessions[0]?.minutes).toBe(2);
    expect(sessions.at(-1)?.minutes).toBe(0);
  });
});
