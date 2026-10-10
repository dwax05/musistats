import Busboy from "busboy";
import type { Express, Request } from "express";
import type { Db } from "mongodb";
import yauzl from "yauzl";
import { authPayload, requireAuth } from "../auth/routes";
import { createQueuedImport, isActiveImport, publicImportSummary, type ImportCounts, type StreamingHistoryImport } from "./jobs";
import { isMusicHistoryFile, parseImportRow, playFingerprint, type ImportSourceKind, type NormalizedImportPlay } from "./model";

// shortcut: imports are capped at 50 MiB/200k rows; switch to durable streaming staging when larger exports are required.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// A whole-folder selection sends every export file; non-music ones are dropped by name before buffering.
const MAX_FILES = 60;
const MAX_ROWS = 200_000;

type Upload = { name: string; data: Buffer };

type StoredImportPlay = {
  userId: string;
  fingerprint: string;
  trackId: string | null;
  name: string;
  artists: string[];
  imageUrl: null;
  playedAt: Date;
  durationMs: number;
  sourceImportIds: string[];
  hasLiveSyncSource: boolean;
};

type ParsedExport = {
  plays: NormalizedImportPlay[];
  sourceKinds: ImportSourceKind[];
  counts: ImportCounts;
  skippedByReason: Record<string, number>;
  dateRange: { start: string; end: string } | null;
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

function parseJson(data: Buffer): unknown[] {
  try {
    const parsed: unknown = JSON.parse(data.toString("utf8"));
    if (!Array.isArray(parsed)) throw new ImportError("unsupported_export");
    return parsed;
  } catch (error) {
    if (error instanceof ImportError) throw error;
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

async function parseExport(uploads: Upload[]): Promise<ParsedExport> {
  const zipped = uploads.filter((upload) => upload.data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
  if (zipped.length && uploads.length !== 1) throw new ImportError("mixed_archive_upload");
  const files = zipped.length ? await zipJsonEntries(zipped[0]!.data) : uploads.map((upload) => upload.data);
  if (!files.length) throw new ImportError("no_music_history_files");
  const plays: NormalizedImportPlay[] = [];
  const kinds = new Set<ImportSourceKind>();
  const skippedByReason: Record<string, number> = {};
  let rowsRead = 0;
  let start: string | null = null;
  let end: string | null = null;

  for (const file of files) {
    for (const row of parseJson(file)) {
      if (++rowsRead > MAX_ROWS) throw new ImportError("export_too_large");
      const parsed = parseImportRow(row);
      if (parsed.sourceKind) kinds.add(parsed.sourceKind);
      if ("skipped" in parsed) {
        skippedByReason[parsed.skipped] = (skippedByReason[parsed.skipped] ?? 0) + 1;
        continue;
      }
      plays.push(parsed.play);
      if (start === null || parsed.play.endedAt < start) start = parsed.play.endedAt;
      if (end === null || parsed.play.endedAt > end) end = parsed.play.endedAt;
    }
  }
  if (!kinds.size) throw new ImportError("unsupported_export");
  const skipped = Object.values(skippedByReason).reduce((total, count) => total + count, 0);
  return {
    plays,
    sourceKinds: [...kinds],
    counts: { files: files.length, rowsRead, tracksImported: 0, duplicates: 0, skipped, enriched: 0 },
    skippedByReason,
    dateRange: start && end ? { start, end } : null,
  };
}

function validImportId(value: unknown): value is string {
  return typeof value === "string" && /^imp_[A-Za-z0-9_-]{16,}$/.test(value);
}

export function registerImportRoutes(app: Express, db: Db) {
  const imports = db.collection<StreamingHistoryImport>("StreamingHistoryImports");
  const recentPlays = db.collection<StoredImportPlay>("RecentPlays");

  app.post("/api/imports/spotify-history", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    try {
      const uploads = await readUpload(req);
      if (!uploads.length) return res.status(400).json({ error: "no_files" });
      const parsed = await parseExport(uploads);
      const job = createQueuedImport(userId);
      const writes = parsed.plays.map((play) => {
        const fingerprint = playFingerprint(userId, play);
        return {
          updateOne: {
            filter: { userId, fingerprint },
          update: {
            $set: { trackId: `import:${fingerprint}` },
            $setOnInsert: {
              userId,
              fingerprint,
              name: play.trackName,
              artists: [play.artistName],
              imageUrl: null,
              playedAt: new Date(play.endedAt),
              durationMs: play.durationMs,
              hasLiveSyncSource: false,
            },
            $addToSet: { sourceImportIds: job.id },
          },
          upsert: true,
        },
        };
      });
      const result = writes.length ? await recentPlays.bulkWrite(writes, { ordered: false }) : { upsertedCount: 0 };
      job.status = "completed";
      job.active = false;
      job.startedAt = job.createdAt;
      job.completedAt = new Date();
      job.sourceKinds = parsed.sourceKinds;
      job.parserVersions = ["1"];
      job.dateRange = parsed.dateRange;
      job.counts = { ...parsed.counts, tracksImported: result.upsertedCount, duplicates: parsed.plays.length - result.upsertedCount };
      job.skippedByReason = parsed.skippedByReason;
      await imports.insertOne(job);
      await db.collection("TopSnapshots").deleteMany({ userId });
      return res.status(202).json({ error: "", import: publicImportSummary(job, 1500) });
    } catch (error) {
      if (error instanceof ImportError) return res.status(uploadStatus(error.code)).json({ error: error.code });
      const detail = error as { name?: unknown; code?: unknown };
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
