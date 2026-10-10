import { describe, expect, it } from "vitest";
import { historyTop, summarizeLast24Hours } from "./routes";

describe("dashboard 24-hour summary", () => {
  it("returns listening time and a complete hourly series from stored play durations", () => {
    const summary = summarizeLast24Hours([
      { trackId: "one", name: "Song A", artists: ["Artist A"], imageUrl: null, playedAt: new Date("2026-10-10T06:15:00.000Z"), durationMs: 120_000 },
      { trackId: "two", name: "Song A", artists: ["Artist A", "Artist B"], imageUrl: null, playedAt: new Date("2026-10-10T08:15:00.000Z"), durationMs: 180_000 },
    ]);

    expect(summary).toMatchObject({
      songs: 2,
      minutes: 5,
      artists: 2,
      topArtist: { name: "Artist A", imageUrl: null },
      topTrack: { name: "Song A", imageUrl: null },
    });
    expect(summary.minutesByHour).toHaveLength(24);
    expect(summary.minutesByHour?.[6]).toBe(2);
    expect(summary.minutesByHour?.[8]).toBe(3);
    expect(summary.playsByHour).toHaveLength(24);
  });

  it("does not label an incomplete duration total as accurate", () => {
    const summary = summarizeLast24Hours([
      { name: "Song", artists: ["Artist"], playedAt: new Date("2026-10-10T06:15:00.000Z") },
    ]);

    expect(summary.minutes).toBeNull();
    expect(summary.minutesByHour).toBeUndefined();
    expect(summary.playsByHour[6]).toBe(1);
  });

  it("keeps known listening time when a legacy play has no duration", () => {
    const summary = summarizeLast24Hours([
      { name: "Known", artists: ["Artist"], playedAt: new Date("2026-10-10T06:15:00.000Z"), durationMs: 180_000 },
      { name: "Legacy", artists: ["Artist"], playedAt: new Date("2026-10-10T06:20:00.000Z") },
    ]);

    expect(summary.minutes).toBe(3);
    expect(summary.minutesComplete).toBe(false);
  });
});

describe("dashboard top songs", () => {
  it("groups repeated imported plays of the same song", () => {
    const top = historyTop([
      { trackId: "import:first-play", name: "Imported song", artists: ["Artist"], imageUrl: null, playedAt: new Date("2026-10-01T12:00:00.000Z") },
      { trackId: "import:second-play", name: "Imported song", artists: ["Artist"], imageUrl: null, playedAt: new Date("2026-10-02T12:00:00.000Z") },
    ]);

    expect(top.tracks).toEqual([expect.objectContaining({ name: "Imported song", plays: 2 })]);
  });
});
