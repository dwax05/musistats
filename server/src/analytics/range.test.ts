import { describe, expect, it } from "vitest";
import { CUSTOM_TIME_RANGE, isAnalyticsRange, isTimeRange, rangeBounds, rangeStart } from "./range";

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
    expect(rangeStart("long_term", now)?.toISOString()).toBe("2025-08-31T12:34:56.789Z");
    expect(rangeStart("long_term", new Date("2028-02-29T00:00:00.000Z"))?.toISOString()).toBe("2027-02-28T00:00:00.000Z");
  });

  it("accepts inclusive custom calendar dates and rejects malformed ranges", () => {
    const bounds = rangeBounds(CUSTOM_TIME_RANGE, new Date(), "2026-02-28", "2026-03-01");
    expect(isAnalyticsRange(CUSTOM_TIME_RANGE)).toBe(true);
    expect(bounds?.start?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(bounds?.end?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(rangeBounds(CUSTOM_TIME_RANGE, new Date(), "2026-02-30", "2026-03-01")).toBeNull();
    expect(rangeBounds(CUSTOM_TIME_RANGE, new Date(), "2026-03-02", "2026-03-01")).toBeNull();
  });
});
