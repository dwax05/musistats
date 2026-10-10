import { describe, expect, it } from "vitest";
import { isActiveImport, isCreatedImportData, isImportSummary, sourceLabel } from "./model";

const summary = {
  id: "imp_123",
  status: "completed",
  sourceKinds: ["extended_streaming_history"],
  createdAt: "2026-10-10T19:12:00.000Z",
  startedAt: "2026-10-10T19:12:02.000Z",
  completedAt: "2026-10-10T19:15:31.000Z",
  dateRange: { start: "2017-06-04T20:14:00.000Z", end: "2026-10-09T23:58:00.000Z" },
  counts: { files: 7, rowsRead: 10, tracksImported: 4, duplicates: 3, skipped: 2, enriched: 4 },
  skippedByReason: { non_music: 2 },
  failureCode: null,
};

describe("Spotify import model", () => {
  it("accepts a complete import summary and rejects malformed count data", () => {
    expect(isImportSummary(summary)).toBe(true);
    expect(isImportSummary({ ...summary, counts: { ...summary.counts, duplicates: -1 } })).toBe(false);
  });

  it("accepts the smaller upload response without treating it as a completed job", () => {
    expect(isCreatedImportData({ error: "", import: { id: "imp_123", status: "queued", sourceKinds: [], createdAt: summary.createdAt } })).toBe(true);
    expect(isCreatedImportData({ error: "", import: { id: "imp_123", status: "unknown", sourceKinds: [], createdAt: summary.createdAt } })).toBe(false);
  });

  it("identifies live jobs and readable source labels", () => {
    expect(isActiveImport("importing")).toBe(true);
    expect(isActiveImport("completed")).toBe(false);
    expect(sourceLabel(["streaming_history", "extended_streaming_history"])).toBe("Streaming + extended history");
  });
});
