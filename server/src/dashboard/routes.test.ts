import { describe, expect, it } from "vitest";
import { buildSessionsFromRecentPlays } from "./routes";

describe("dashboard sessions grouping", () => {
  it("groups nearby plays into the same session and creates a new session after a 45 minute gap", () => {
    const plays = [
      { playedAt: "2024-01-01T10:00:00.000Z", trackId: "a", name: "Song A", artists: ["Artist A"], imageUrl: null, externalUrl: "https://example.com/a", durationMs: 180000 },
      { playedAt: "2024-01-01T10:05:00.000Z", trackId: "b", name: "Song B", artists: ["Artist B"], imageUrl: null, externalUrl: "https://example.com/b", durationMs: 180000 },
      { playedAt: "2024-01-01T10:55:00.000Z", trackId: "c", name: "Song C", artists: ["Artist C"], imageUrl: null, externalUrl: "https://example.com/c", durationMs: 180000 },
    ];

    const [first, second] = buildSessionsFromRecentPlays(plays);

    expect(first).toMatchObject({
      startedAt: "2024-01-01T10:00:00.000Z",
      endedAt: "2024-01-01T10:05:00.000Z",
      minutes: 6,
      songs: 2,
      artists: 2,
      topArtist: { name: "Artist A", imageUrl: null },
      tracks: [
        { id: "a", playedAt: "2024-01-01T10:00:00.000Z" },
        { id: "b", playedAt: "2024-01-01T10:05:00.000Z" },
      ],
    });

    expect(second).toMatchObject({
      startedAt: "2024-01-01T10:55:00.000Z",
      endedAt: "2024-01-01T10:55:00.000Z",
      minutes: 3,
      songs: 1,
      artists: 1,
      topArtist: { name: "Artist C", imageUrl: null },
      tracks: [{ id: "c", playedAt: "2024-01-01T10:55:00.000Z" }],
    });
  });

  it("sorts sessions by active minutes descending and then most recent start time", () => {
    const plays = [
      { playedAt: "2024-01-01T09:00:00.000Z", trackId: "a", name: "Short", artists: ["A"], imageUrl: null, externalUrl: "https://example.com/a", durationMs: 180000 },
      { playedAt: "2024-01-01T09:05:00.000Z", trackId: "b", name: "Short 2", artists: ["A"], imageUrl: null, externalUrl: "https://example.com/b", durationMs: 180000 },
      { playedAt: "2024-01-01T12:00:00.000Z", trackId: "c", name: "Long", artists: ["B"], imageUrl: null, externalUrl: "https://example.com/c", durationMs: 1200000 },
      { playedAt: "2024-01-01T12:10:00.000Z", trackId: "d", name: "Long 2", artists: ["B"], imageUrl: null, externalUrl: "https://example.com/d", durationMs: 900000 },
    ];

    expect(buildSessionsFromRecentPlays(plays).map((session) => session.startedAt)).toEqual([
      "2024-01-01T12:00:00.000Z",
      "2024-01-01T09:00:00.000Z",
    ]);
  });

  it("returns null minutes when duration data is unavailable for a session", () => {
    const plays = [
      { playedAt: "2024-01-01T10:00:00.000Z", trackId: "a", name: "No Duration", artists: ["Artist A"], imageUrl: null, externalUrl: "https://example.com/a", durationMs: null },
      { playedAt: "2024-01-01T10:10:00.000Z", trackId: "b", name: "No Duration 2", artists: ["Artist B"], imageUrl: null, externalUrl: "https://example.com/b", durationMs: null },
    ];

    expect(buildSessionsFromRecentPlays(plays)[0]).toMatchObject({
      minutes: null,
      songs: 2,
      topArtist: { name: "Artist A", imageUrl: null },
    });
  });
});
