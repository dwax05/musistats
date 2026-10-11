import { describe, expect, it } from "vitest";
import { comparisonPeriods } from "./TasteComparison";

describe("taste comparison periods", () => {
  it("compares the last 28 days with the 28 days before", () => {
    expect(comparisonPeriods("short_term", "2026-10-10", null)).toEqual({
      previous: { startDate: "2026-08-16", endDate: "2026-09-12" },
      current: { startDate: "2026-09-13", endDate: "2026-10-10" },
    });
  });

  it("clamps month arithmetic to the end of shorter months", () => {
    expect(comparisonPeriods("medium_term", "2026-08-31", null).current).toEqual({ startDate: "2026-03-01", endDate: "2026-08-31" });
    expect(comparisonPeriods("long_term", "2024-02-29", null).current).toEqual({ startDate: "2023-03-01", endDate: "2024-02-29" });
  });

  it("puts an equal-length period directly before a custom range", () => {
    expect(comparisonPeriods("custom", "2026-10-10", { startDate: "2026-03-01", endDate: "2026-03-10" })).toEqual({
      previous: { startDate: "2026-02-19", endDate: "2026-02-28" },
      current: { startDate: "2026-03-01", endDate: "2026-03-10" },
    });
  });

  it("uses a custom previous period when one is chosen", () => {
    const previous = { startDate: "2025-12-01", endDate: "2025-12-31" };
    expect(comparisonPeriods("custom", "2026-10-10", { startDate: "2026-03-01", endDate: "2026-03-10" }, previous).previous).toBe(previous);
  });
});
