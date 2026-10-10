import { describe, expect, it } from "vitest";
import { createQueuedImport, isActiveImport, publicImportSummary } from "./jobs";

describe("import jobs", () => {
  it("creates opaque active jobs without source data", () => {
    const job = createQueuedImport("user-1", new Date("2026-10-10T12:00:00.000Z"));

    expect(job).toMatchObject({
      id: expect.stringMatching(/^imp_/),
      userId: "user-1",
      status: "queued",
      active: true,
      sourceKinds: [],
      counts: { files: 0, rowsRead: 0, tracksImported: 0, duplicates: 0, skipped: 0, enriched: 0 },
    });
    expect(publicImportSummary(job, 1500)).not.toHaveProperty("userId");
  });

  it("identifies active states", () => {
    expect(isActiveImport("queued")).toBe(true);
    expect(isActiveImport("enriching")).toBe(true);
    expect(isActiveImport("completed")).toBe(false);
    expect(isActiveImport("cancelled")).toBe(false);
  });
});
