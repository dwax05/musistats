import { describe, expect, it } from "vitest";
import { yearToDatePeriods } from "./TasteComparison";

describe("year-to-date comparison periods", () => {
  it("compares the current year through today with the matching span last year", () => {
    expect(yearToDatePeriods("2026-10-10")).toEqual({
      previous: { startDate: "2025-01-01", endDate: "2025-10-10" },
      current: { startDate: "2026-01-01", endDate: "2026-10-10" },
    });
  });

  it("clamps February 29 to February 28 in the previous non-leap year", () => {
    expect(yearToDatePeriods("2024-02-29")).toEqual({
      previous: { startDate: "2023-01-01", endDate: "2023-02-28" },
      current: { startDate: "2024-01-01", endDate: "2024-02-29" },
    });
  });
});