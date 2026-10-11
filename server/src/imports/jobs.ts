import { randomBytes } from "node:crypto";
import type { Db } from "mongodb";
import type { ImportSourceKind, ImportStatus } from "./model";

export type ImportCounts = {
  files: number;
  rowsRead: number;
  tracksImported: number;
  duplicates: number;
  skipped: number;
  enriched: number;
};

export type StreamingHistoryImport = {
  id: string;
  userId: string;
  status: ImportStatus;
  active: boolean;
  sourceKinds: ImportSourceKind[];
  parserVersions: string[];
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  dateRange: { start: string; end: string } | null;
  counts: ImportCounts;
  skippedByReason: Record<string, number>;
  failureCode: string | null;
};

const ACTIVE_STATUSES: readonly ImportStatus[] = ["queued", "validating", "importing", "enriching"];

export function isActiveImport(status: ImportStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function createQueuedImport(userId: string, createdAt = new Date()): StreamingHistoryImport {
  return {
    id: `imp_${randomBytes(24).toString("base64url")}`,
    userId,
    status: "queued",
    active: true,
    sourceKinds: [],
    parserVersions: [],
    createdAt,
    startedAt: null,
    completedAt: null,
    dateRange: null,
    counts: { files: 0, rowsRead: 0, tracksImported: 0, duplicates: 0, skipped: 0, enriched: 0 },
    skippedByReason: {},
    failureCode: null,
  };
}

export function publicImportSummary(job: StreamingHistoryImport, pollAfterMs?: number) {
  return {
    id: job.id,
    status: job.status,
    sourceKinds: job.sourceKinds,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    dateRange: job.dateRange,
    counts: job.counts,
    skippedByReason: job.skippedByReason,
    failureCode: job.failureCode,
    ...(pollAfterMs === undefined ? {} : { pollAfterMs }),
  };
}

export async function ensureImportIndexes(db: Db) {
  await Promise.all([
    db.collection("StreamingHistoryImports").createIndex({ userId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } }),
    db.collection("StreamingHistoryImports").createIndex({ userId: 1, createdAt: -1, id: -1 }),
    // Existing live rows may predate fingerprints; enforce uniqueness as they become canonical.
    db.collection("RecentPlays").createIndex({ userId: 1, fingerprint: 1 }, { unique: true, partialFilterExpression: { fingerprint: { $type: "string" } } }),
  ]);
}

export async function recoverInterruptedImports(db: Db) {
  await db.collection<StreamingHistoryImport>("StreamingHistoryImports").updateMany(
    { active: true },
    { $set: { status: "failed", active: false, failureCode: "server_restarted", completedAt: new Date() } },
  );
}
