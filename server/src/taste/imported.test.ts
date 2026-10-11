import { describe, expect, it } from "vitest";
import { buildImportedTasteFrames, type ImportedTastePlay } from "./imported";

function play(day: string, artist: string, durationMs: number): ImportedTastePlay {
  return {
    playedAt: new Date(`${day}T12:00:00.000Z`),
    durationMs,
    artists: [artist],
  };
}

describe("imported taste replay", () => {
  it("smooths changes with a centered 29-day window and samples one frame per week", () => {
    const plays = Array.from({ length: 42 }, (_, index) =>
      play(
        new Date(Date.UTC(2026, 9, 1 + index)).toISOString().slice(0, 10),
        index < 21 ? "Ambient Artist" : "Pop Artist",
        100_000,
      ),
    );
    const genres = new Map([
      ["ambient artist", [{ name: "ambient", weight: 1 }]],
      ["pop artist", [{ name: "pop", weight: 1 }]],
    ]);

    const result = buildImportedTasteFrames(plays, genres, null);
    const firstTransitionFrame = result.frames.findIndex((frame) =>
      frame.genres.some((genre) => genre.name === "pop"),
    );
    const mostlyPopFrame = result.frames.findIndex((frame) =>
      (frame.genres.find((genre) => genre.name === "pop")?.weight ?? 0) > 0.5,
    );

    expect(result.intervalDays).toBe(1);
    expect(result.frames).toHaveLength(7);
    expect(result.frames[0]?.genres).toEqual([{ name: "ambient", weight: 1 }]);
    expect(firstTransitionFrame).toBeGreaterThan(0);
    expect(mostlyPopFrame).toBeGreaterThan(firstTransitionFrame);
    expect(result.frames.at(-1)?.genres).toEqual([{ name: "pop", weight: 1 }]);
    expect(result.frames[1]?.capturedAt).toBe("2026-10-08T00:00:00.000Z");
  });

  it("honors the selected range and coarsens long histories without dropping their endpoints", () => {
    const plays = Array.from({ length: 400 }, (_, index) => {
      const day = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
      return play(day, "Artist", 60_000);
    });

    const allTime = buildImportedTasteFrames(plays, new Map([["artist", [{ name: "ambient", weight: 1 }]]]), null);
    const lastDay = new Date(Date.UTC(2025, 0, 1 + 399));
    const recent = buildImportedTasteFrames(
      plays,
      new Map([["artist", [{ name: "ambient", weight: 1 }]]]),
      lastDay,
    );

    expect(allTime.intervalDays).toBeGreaterThan(1);
    expect(allTime.frames.length).toBeLessThanOrEqual(365);
    expect(allTime.frames[0]?.capturedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(allTime.frames.at(-1)?.capturedAt).toBe(lastDay.toISOString());
    expect(recent.frames).toHaveLength(1);
    expect(recent.frames[0]?.capturedAt).toBe(lastDay.toISOString());
  });

  it("uses earlier plays as smoothing context without returning frames outside the selected range", () => {
    const plays = Array.from({ length: 60 }, (_, index) =>
      play(
        new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10),
        index < 45 ? "Ambient Artist" : "Pop Artist",
        100_000,
      ),
    );
    const rangeStart = new Date(Date.UTC(2026, 9, 3));
    const result = buildImportedTasteFrames(plays, new Map([
      ["ambient artist", [{ name: "ambient", weight: 1 }]],
      ["pop artist", [{ name: "pop", weight: 1 }]],
    ]), rangeStart);

    expect(result.frames.length).toBeGreaterThan(1);
    expect(result.frames[0]?.capturedAt).toBe("2026-10-03T00:00:00.000Z");
    expect(result.frames.at(-1)?.capturedAt).toBe("2026-10-30T00:00:00.000Z");
    expect(result.frames[0]?.genres).toContainEqual(expect.objectContaining({ name: "ambient" }));
    expect(result.frames.at(-1)?.genres).toEqual([{ name: "pop", weight: 1 }]);
    expect(new Set(result.frames.map((frame) => JSON.stringify(frame.genres))).size).toBeGreaterThan(1);
  });

  it("returns no frames when no positive-duration play has a genre tag", () => {
    const result = buildImportedTasteFrames(
      [play("2026-10-01", "Unknown", 0)],
      new Map(),
      null,
    );

    expect(result).toEqual({ frames: [], intervalDays: 1 });
  });

  it("uses Last.fm tag strength instead of splitting an artist's listening evenly", () => {
    const result = buildImportedTasteFrames(
      [play("2026-10-01", "Tagged Artist", 100_000)],
      new Map([["tagged artist", [
        { name: "indie", weight: 0.8 },
        { name: "dream pop", weight: 0.2 },
      ]]]),
      null,
    );

    expect(result.frames[0]?.genres).toEqual([
      { name: "indie", weight: 0.8 },
      { name: "dream pop", weight: 0.2 },
    ]);
  });

  it("splits a play's duration across its artists before applying genre weights", () => {
    const result = buildImportedTasteFrames(
      [{
        playedAt: new Date("2026-10-01T12:00:00.000Z"),
        durationMs: 100_000,
        artists: ["Artist A", "Artist B"],
      }],
      new Map([
        ["artist a", [{ name: "indie", weight: 1 }]],
        ["artist b", [{ name: "pop", weight: 1 }]],
      ]),
      null,
    );

    expect(result.frames[0]?.genres).toEqual([
      { name: "indie", weight: 0.5 },
      { name: "pop", weight: 0.5 },
    ]);
  });
});
