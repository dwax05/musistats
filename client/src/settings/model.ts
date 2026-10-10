import type { ApiResponse } from "../auth/AuthProvider";

export type ImportStatus = "queued" | "validating" | "importing" | "enriching" | "completed" | "failed" | "cancelling" | "cancelled";

export type ImportSummary = {
  id: string;
  status: ImportStatus;
  sourceKinds: ("streaming_history" | "extended_streaming_history")[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dateRange: { start: string; end: string } | null;
  counts: { files: number; rowsRead: number; tracksImported: number; duplicates: number; skipped: number; enriched: number };
  skippedByReason: Record<string, number>;
  failureCode: string | null;
};

export type ImportsData = ApiResponse & { imports: ImportSummary[]; nextCursor: string | null };
export type ImportData = ApiResponse & { import: ImportSummary };
export type CreatedImportData = ApiResponse & { import: Pick<ImportSummary, "id" | "status" | "sourceKinds" | "createdAt"> };
export type ImportTransitionData = ApiResponse & { import: Pick<ImportSummary, "id" | "status"> };

const statuses: ImportStatus[] = ["queued", "validating", "importing", "enriching", "completed", "failed", "cancelling", "cancelled"];
const sourceKinds = ["streaming_history", "extended_streaming_history"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isImportStatus(value: unknown): value is ImportStatus {
  return typeof value === "string" && statuses.includes(value as ImportStatus);
}

function isSourceKinds(value: unknown): value is ImportSummary["sourceKinds"] {
  return Array.isArray(value) && value.every((kind) => typeof kind === "string" && sourceKinds.includes(kind));
}

export function isImportSummary(value: unknown): value is ImportSummary {
  if (!isRecord(value) || typeof value.id !== "string" || !isImportStatus(value.status) || !isSourceKinds(value.sourceKinds) || typeof value.createdAt !== "string") return false;
  if (value.startedAt !== null && typeof value.startedAt !== "string" || value.completedAt !== null && typeof value.completedAt !== "string") return false;
  if (value.dateRange !== null && (!isRecord(value.dateRange) || typeof value.dateRange.start !== "string" || typeof value.dateRange.end !== "string")) return false;
  if (!isRecord(value.counts) || ![value.counts.files, value.counts.rowsRead, value.counts.tracksImported, value.counts.duplicates, value.counts.skipped, value.counts.enriched].every(isCount)) return false;
  return isRecord(value.skippedByReason) && Object.values(value.skippedByReason).every(isCount) && (value.failureCode === null || typeof value.failureCode === "string");
}

export function isImportsData(value: ApiResponse): value is ImportsData {
  return value.error === "" && Array.isArray(value.imports) && value.imports.every(isImportSummary) && (value.nextCursor === null || typeof value.nextCursor === "string");
}

export function isImportData(value: ApiResponse): value is ImportData {
  return value.error === "" && isImportSummary(value.import);
}

export function isCreatedImportData(value: ApiResponse): value is CreatedImportData {
  return value.error === "" && isRecord(value.import) && typeof value.import.id === "string" && isImportStatus(value.import.status) && isSourceKinds(value.import.sourceKinds) && typeof value.import.createdAt === "string";
}

export function isImportTransitionData(value: ApiResponse): value is ImportTransitionData {
  return value.error === "" && isRecord(value.import) && typeof value.import.id === "string" && isImportStatus(value.import.status);
}

export function isActiveImport(status: ImportStatus) {
  return status === "queued" || status === "validating" || status === "importing" || status === "enriching" || status === "cancelling";
}

export function sourceLabel(sourceKinds: ImportSummary["sourceKinds"]) {
  if (sourceKinds.includes("extended_streaming_history")) return sourceKinds.includes("streaming_history") ? "Streaming + extended history" : "Extended streaming history";
  return sourceKinds.includes("streaming_history") ? "Streaming history" : "Detecting export type";
}
