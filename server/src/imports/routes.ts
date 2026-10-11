import Busboy from "busboy";
import type { Express, Request } from "express";
import type { Collection, Db, Document } from "mongodb";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import parser from "stream-json/parser.js";
import streamArray, { type StreamArrayItem } from "stream-json/streamers/stream-array.js";
import yauzl from "yauzl";
import { authPayload, requireAuth } from "../auth/routes";
import { createQueuedImport, isActiveImport, publicImportSummary, type StreamingHistoryImport } from "./jobs";
import { isMusicHistoryFile, parseImportRow, playFingerprint, type ImportSourceKind, type ImportStatus, type NormalizedImportPlay } from "./model";

// shortcut: imports are capped at 50 MiB/200k rows; switch to durable streaming staging when larger exports are required.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// A whole-folder selection sends every export file; non-music ones are dropped by name before buffering.
const MAX_FILES = 60;
const MAX_ROWS = 200_000;
const IMPORT_BATCH_SIZE = 5_000;

type Upload = { name: string; data: Buffer };

type StoredImportPlay = {
  userId: string;
  fingerprint: string;
  trackId: string | null;
  name: string;
  artists: string[];
  imageUrl: null;
  albumName?: string | null;
  playedAt: Date;
  durationMs: number;
  sourceImportIds: string[];
  hasLiveSyncSource: boolean;
};

class ImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function uploadStatus(code: string) {
  return code === "upload_too_large" ? 413 : code === "unsupported_export" || code === "no_music_history_files" ? 422 : 415;
}

function readUpload(req: Request): Promise<Upload[]> {
  return new Promise((resolve, reject) => {
    let parser: Busboy.Busboy;
    try {
      parser = Busboy({ headers: req.headers, limits: { files: MAX_FILES, fileSize: MAX_UPLOAD_BYTES } });
    } catch {
      reject(new ImportError("unsupported_file_type"));
      return;
    }
    const uploads: Upload[] = [];
    let totalBytes = 0;
    let tooLarge = false;
    let filesSeen = 0;
    parser.on("file", (field, stream, info) => {
      const name = info.filename ?? "upload";
      if (field === "files") filesSeen += 1;
      if (field !== "files" || !(isMusicHistoryFile(name) || name.toLowerCase().endsWith(".zip"))) {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_UPLOAD_BYTES) tooLarge = true;
        else chunks.push(chunk);
      });
      stream.on("limit", () => { tooLarge = true; });
      stream.on("end", () => {
        if (!tooLarge) uploads.push({ name, data: Buffer.concat(chunks) });
      });
    });
    parser.on("filesLimit", () => { tooLarge = true; });
    parser.on("error", () => reject(new ImportError("unsupported_file_type")));
    parser.on("close", () => {
      if (tooLarge) reject(new ImportError("upload_too_large"));
      else if (filesSeen && !uploads.length) reject(new ImportError("no_music_history_files"));
      else resolve(uploads);
    });
    req.pipe(parser);
  });
}

async function* jsonArrayRows(data: Buffer): AsyncGenerator<unknown> {
  async function* chunks() {
    for (let offset = 0; offset < data.length; offset += 64 * 1024) {
      yield data.subarray(offset, offset + 64 * 1024);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  const rows = streamArray.asStream();
  const parsing = pipeline(Readable.from(chunks()), parser.asStream(), rows);
  try {
    for await (const row of rows as AsyncIterable<StreamArrayItem>) yield row.value;
    await parsing;
  } catch {
    await parsing.catch(() => undefined);
    throw new ImportError("unsupported_export");
  }
}

async function zipJsonEntries(data: Buffer): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new ImportError("unsupported_file_type"));
      const entries: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;
      const fail = (code: string) => {
        if (!settled) {
          settled = true;
          zip.close();
          reject(new ImportError(code));
        }
      };
      zip.on("error", () => fail("unsupported_file_type"));
      zip.on("end", () => { if (!settled) resolve(entries); });
      zip.on("entry", (entry) => {
        if (settled) return;
        if (!isMusicHistoryFile(entry.fileName) || entry.generalPurposeBitFlag & 1) return zip.readEntry();
        if (entry.compressedSize === 0 ? entry.uncompressedSize > 0 : entry.uncompressedSize / entry.compressedSize > 100) return fail("export_too_large");
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail("unsupported_file_type");
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_UPLOAD_BYTES) return fail("export_too_large");
            chunks.push(chunk);
          });
          stream.on("error", () => fail("unsupported_file_type"));
          stream.on("end", () => {
            if (settled) return;
            entries.push(Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function processExport(
  uploads: Upload[],
  job: StreamingHistoryImport,
  imports: Collection<StreamingHistoryImport>,
  recentPlays: Collection<StoredImportPlay>,
  topSnapshots: Collection<Document>,
): Promise<void> {
  const zipped = uploads.filter((upload) => upload.data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
  if (zipped.length && uploads.length !== 1) throw new ImportError("mixed_archive_upload");
  const files = zipped.length ? await zipJsonEntries(zipped[0]!.data) : uploads.map((upload) => upload.data);
  if (!files.length) throw new ImportError("no_music_history_files");

  const kinds = new Set<ImportSourceKind>();
  const skippedByReason: Record<string, number> = {};
  const batch: NormalizedImportPlay[] = [];
  let playsRead = 0;
  let rowsRead = 0;
  let tracksImported = 0;
  let rowsSinceProgress = 0;
  let start: string | null = null;
  let end: string | null = null;

  const saveProgress = async (status: ImportStatus, complete = false): Promise<boolean> => {
    const skipped = Object.values(skippedByReason).reduce((total, count) => total + count, 0);
    job.status = status;
    job.sourceKinds = [...kinds];
    job.parserVersions = ["1"];
    job.dateRange = start && end ? { start, end } : null;
    job.counts = {
      files: files.length,
      rowsRead,
      tracksImported,
      duplicates: playsRead - tracksImported,
      skipped,
      enriched: 0,
    };
    job.skippedByReason = { ...skippedByReason };
    if (complete) {
      job.active = false;
      job.completedAt = new Date();
    }
    const result = await imports.updateOne(
      { id: job.id, userId: job.userId, active: true },
      { $set: {
        status: job.status,
        active: job.active,
        sourceKinds: job.sourceKinds,
        parserVersions: job.parserVersions,
        dateRange: job.dateRange,
        counts: job.counts,
        skippedByReason: job.skippedByReason,
        ...(complete ? { completedAt: job.completedAt } : {}),
      } },
    );
    return result.matchedCount > 0;
  };

  const flushBatch = async (): Promise<boolean> => {
    const active = await imports.findOne({ id: job.id, userId: job.userId, active: true }, { projection: { _id: 1 } });
    if (!active) return false;
    if (batch.length) {
      const uniquePlays = new Map<string, NormalizedImportPlay>();
      for (const play of batch) uniquePlays.set(playFingerprint(job.userId, play), play);
      const writes = [...uniquePlays].map(([fingerprint, play]) => ({
        updateOne: {
          filter: { userId: job.userId, fingerprint },
          update: {
            $set: { trackId: `import:${fingerprint}` },
            $setOnInsert: {
              userId: job.userId,
              fingerprint,
              name: play.trackName,
              artists: [play.artistName],
              imageUrl: null,
              albumName: play.albumName,
              playedAt: new Date(play.endedAt),
              durationMs: play.durationMs,
              hasLiveSyncSource: false,
            },
            $addToSet: { sourceImportIds: job.id },
          },
          upsert: true,
        },
      }));
      const result = await recentPlays.bulkWrite(writes, { ordered: false });
      tracksImported += result.upsertedCount;
      batch.length = 0;
    }
    rowsSinceProgress = 0;
    return saveProgress("importing");
  };

  job.startedAt = new Date();
  const started = await imports.updateOne(
    { id: job.id, userId: job.userId, active: true },
    { $set: { status: "validating", startedAt: job.startedAt } },
  );
  if (!started.matchedCount) return;

  for (const file of files) {
    for await (const row of jsonArrayRows(file)) {
      if (++rowsRead > MAX_ROWS) throw new ImportError("export_too_large");
      const parsed = parseImportRow(row);
      if (parsed.sourceKind) kinds.add(parsed.sourceKind);
      if ("skipped" in parsed) {
        skippedByReason[parsed.skipped] = (skippedByReason[parsed.skipped] ?? 0) + 1;
      } else {
        playsRead += 1;
        batch.push(parsed.play);
        if (start === null || parsed.play.endedAt < start) start = parsed.play.endedAt;
        if (end === null || parsed.play.endedAt > end) end = parsed.play.endedAt;
      }
      rowsSinceProgress += 1;
      if (rowsSinceProgress >= IMPORT_BATCH_SIZE && !(await flushBatch())) return;
    }
  }
  if (!kinds.size) throw new ImportError("unsupported_export");
  if (!(await flushBatch())) return;
  await topSnapshots.deleteMany({ userId: job.userId });
  await saveProgress("completed", true);
}

function validImportId(value: unknown): value is string {
  return typeof value === "string" && /^imp_[A-Za-z0-9_-]{16,}$/.test(value);
}

export function registerImportRoutes(app: Express, db: Db) {
  const imports = db.collection<StreamingHistoryImport>("StreamingHistoryImports");
  const recentPlays = db.collection<StoredImportPlay>("RecentPlays");
  const topSnapshots = db.collection("TopSnapshots");
  const processingImports = new Map<string, Promise<void>>();

  app.post("/api/imports/spotify-history", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    try {
      const uploads = await readUpload(req);
      if (!uploads.length) return res.status(400).json({ error: "no_files" });
      const job = createQueuedImport(userId);
      await imports.insertOne(job);
      res.status(202).json({ error: "", import: publicImportSummary(job) });
      const processing = new Promise<void>((resolve) => {
        setImmediate(() => {
          void processExport(uploads, job, imports, recentPlays, topSnapshots).catch(async (error: unknown) => {
            const failureCode = error instanceof ImportError ? error.code : "imports_unavailable";
            if (!(error instanceof ImportError)) {
              const detail = error as { name?: unknown; code?: unknown };
              console.error("Spotify history import processing failed", {
                name: typeof detail.name === "string" ? detail.name : "UnknownError",
                code: typeof detail.code === "string" || typeof detail.code === "number" ? detail.code : undefined,
              });
            }
            job.status = "failed";
            job.active = false;
            job.failureCode = failureCode;
            job.completedAt = new Date();
            try {
              await imports.updateOne(
                { id: job.id, userId, active: true },
                { $set: { status: job.status, active: false, failureCode, completedAt: job.completedAt } },
              );
            } catch (persistenceError) {
              console.error("Could not save failed Spotify history import", persistenceError);
            }
          }).finally(resolve);
        });
      });
      processingImports.set(job.id, processing);
      void processing.then(() => {
        if (processingImports.get(job.id) === processing) processingImports.delete(job.id);
      });
    } catch (error) {
      if (error instanceof ImportError) return res.status(uploadStatus(error.code)).json({ error: error.code });
      const detail = error as { name?: unknown; code?: unknown };
      if (detail.code === 11000) return res.status(409).json({ error: "import_in_progress" });
      console.error("Spotify history import failed", {
        name: typeof detail.name === "string" ? detail.name : "UnknownError",
        code: typeof detail.code === "string" || typeof detail.code === "number" ? detail.code : undefined,
      });
      return res.status(503).json({ error: "imports_unavailable" });
    }
  });

  app.post("/api/imports/spotify-history/list", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    const limit = req.body?.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (req.body?.cursor !== undefined && req.body.cursor !== null)) return res.status(400).json({ error: "invalid_pagination" });
    const jobs = await imports.find({ userId }).sort({ createdAt: -1, id: -1 }).limit(limit).toArray();
    res.json({ error: "", imports: jobs.map((job) => publicImportSummary(job)), nextCursor: null });
  });

  app.post("/api/imports/spotify-history/status", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!validImportId(req.body?.importId)) return res.status(400).json({ error: "invalid_import_id" });
    const job = await imports.findOne({ id: req.body.importId, userId });
    if (!job) return res.status(404).json({ error: "import_not_found" });
    res.json({ error: "", import: publicImportSummary(job, isActiveImport(job.status) ? 1500 : undefined) });
  });

  app.post("/api/imports/spotify-history/cancel", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!validImportId(req.body?.importId)) return res.status(400).json({ error: "invalid_import_id" });
    await imports.updateOne({ id: req.body.importId, userId, active: true }, { $set: { status: "cancelled", active: false, completedAt: new Date() } });
    await processingImports.get(req.body.importId);
    await recentPlays.updateMany({ userId, sourceImportIds: req.body.importId }, { $pull: { sourceImportIds: req.body.importId } });
    await recentPlays.deleteMany({ userId, sourceImportIds: { $size: 0 }, hasLiveSyncSource: false });
    await Promise.all([
      imports.deleteOne({ id: req.body.importId, userId }),
      topSnapshots.deleteMany({ userId }),
    ]);
    res.json({ error: "", deleted: true });
  });

  app.post("/api/imports/spotify-history/delete", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!validImportId(req.body?.importId)) return res.status(400).json({ error: "invalid_import_id" });
    const job = await imports.findOne({ id: req.body.importId, userId });
    if (!job) return res.status(404).json({ error: "import_not_found" });
    if (isActiveImport(job.status)) return res.status(409).json({ error: "import_active" });
    await recentPlays.updateMany({ userId, sourceImportIds: job.id }, { $pull: { sourceImportIds: job.id } });
    await recentPlays.deleteMany({ userId, sourceImportIds: { $size: 0 }, hasLiveSyncSource: false });
    await Promise.all([imports.deleteOne({ id: job.id, userId }), db.collection("TopSnapshots").deleteMany({ userId })]);
    res.json({ error: "", deleted: true });
  });
}
