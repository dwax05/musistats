import { describe, expect, it } from "vitest";
import { isDashboardData } from "./model";

describe("dashboard response validation", () => {
  it("accepts the dashboard shape and rejects incomplete data", () => {
    const top = {
      short_term: { artists: [], tracks: [] },
      medium_term: { artists: [], tracks: [] },
      long_term: { artists: [], tracks: [] },
    };
    expect(isDashboardData({ error: "", top, recent: [], updatedAt: null })).toBe(true);
    expect(isDashboardData({ error: "", top: {}, recent: [] })).toBe(false);
  });
});
