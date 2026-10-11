import { describe, expect, it } from "vitest";
import { buildCalendar, isCalendarMonth, localDateFormatter, monthQueryWindow, type CalendarPlay } from "./routes";

function play(playedAt: string, trackId: string | null, name = "Song", durationMs: number | undefined = 180_000): CalendarPlay {
  return { trackId, name, artists: ["Artist"], imageUrl: null, playedAt: new Date(playedAt), durationMs };
}

const utc = localDateFormatter("UTC")!;

describe("calendar input", () => {
  it("accepts YYYY-MM months and real IANA time zones only", () => {
    expect(isCalendarMonth("2026-10")).toBe(true);
    expect(isCalendarMonth("2026-13")).toBe(false);
    expect(isCalendarMonth("2026-1")).toBe(false);
    expect(localDateFormatter("America/New_York")).not.toBeNull();
    expect(localDateFormatter("Not/A_Zone")).toBeNull();
    expect(localDateFormatter(42)).toBeNull();
  });

  it("widens the query window so every local day in the month is covered", () => {
    expect(monthQueryWindow("2026-12")).toEqual({
      start: new Date("2026-11-30T10:00:00.000Z"),
      end: new Date("2027-01-01T14:00:00.000Z"),
    });
  });
});

describe("calendar aggregation", () => {
  it("totals each day and ranks its top songs by plays", () => {
    const days = buildCalendar("2026-10", utc, [
      play("2026-10-09T08:00:00.000Z", "a", "Song A"),
      play("2026-10-09T09:00:00.000Z", "b", "Song B"),
      play("2026-10-09T10:00:00.000Z", "b", "Song B"),
      { ...play("2026-10-11T10:00:00.000Z", "a", "Song A"), durationMs: undefined },
    ]);

    expect(days.map((day) => [day.date, day.minutes, day.plays])).toEqual([["2026-10-09", 9, 3], ["2026-10-11", 0, 1]]);
    expect(days[0]!.topTracks.map((track) => [track.name, track.plays])).toEqual([["Song B", 2], ["Song A", 1]]);
    expect(days[0]!.topTracks[0]!.externalUrl).toBe("https://open.spotify.com/track/b");
  });

  it("puts plays on the viewer's local day and drops neighbouring months", () => {
    const newYork = localDateFormatter("America/New_York")!;
    const days = buildCalendar("2026-10", newYork, [
      play("2026-10-10T01:30:00.000Z", "late"),
      play("2026-11-01T02:00:00.000Z", "halloween"),
      play("2026-11-01T05:00:00.000Z", "november"),
    ]);

    expect(days.map((day) => day.date)).toEqual(["2026-10-09", "2026-10-31"]);
  });

  it("groups imported plays without a track ID by song and artist name", () => {
    const [day] = buildCalendar("2026-10", utc, [
      play("2026-10-09T08:00:00.000Z", null, "Imported Song"),
      play("2026-10-09T09:00:00.000Z", null, " imported  song "),
    ]);

    expect(day!.topTracks).toHaveLength(1);
    expect(day!.topTracks[0]).toMatchObject({ name: "Imported Song", plays: 2, externalUrl: "" });
  });
});
