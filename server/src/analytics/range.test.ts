import { describe, expect, it } from "vitest";
import { isTimeRange, rangeStart } from "./range";

describe("analytics ranges", () => {
  it("accepts only the public range values", () => {
    expect(isTimeRange("short_term")).toBe(true);
    expect(isTimeRange("medium_term")).toBe(true);
    expect(isTimeRange("long_term")).toBe(true);
    expect(isTimeRange(undefined)).toBe(false);
    expect(isTimeRange("week")).toBe(false);
  });

  it("calculates rolling and calendar cutoffs in UTC", () => {
    const now = new Date("2026-08-31T12:34:56.789Z");

    expect(rangeStart("short_term", now)?.toISOString()).toBe("2026-08-03T12:34:56.789Z");
    expect(rangeStart("medium_term", now)?.toISOString()).toBe("2026-02-28T12:34:56.789Z");
    expect(rangeStart("long_term", now)).toBeNull();
  });
});
