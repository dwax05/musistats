import { describe, expect, it } from "vitest";
import { heatLevel, isCalendarData, monthGrid, shiftMonth } from "./model";

describe("calendar model", () => {
  it("lays a month out as six Sunday-first weeks", () => {
    const cells = monthGrid("2026-10");
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: "2026-09-27", day: 27, inMonth: false });
    expect(cells[4]).toEqual({ date: "2026-10-01", day: 1, inMonth: true });
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it("moves between months across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("shades days relative to the month's busiest day", () => {
    expect(heatLevel(0, 180)).toBe(0);
    expect(heatLevel(1, 180)).toBe(1);
    expect(heatLevel(90, 180)).toBe(2);
    expect(heatLevel(180, 180)).toBe(4);
  });

  it("rejects malformed calendar responses", () => {
    expect(isCalendarData({ error: "", month: "2026-10", days: [{ date: "2026-10-09", minutes: 12, plays: 3, topTracks: [] }] })).toBe(true);
    expect(isCalendarData({ error: "", month: "2026-10", days: [{ date: "2026-10-09", minutes: -1, plays: 3, topTracks: [] }] })).toBe(false);
    expect(isCalendarData({ error: "calendar_unavailable" })).toBe(false);
  });
});
