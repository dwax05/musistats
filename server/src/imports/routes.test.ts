import express from "express";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerRoutes } from "../api";

beforeEach(() => {
  process.env.ACCESS_TOKEN_SECRET = "access-secret";
});

describe("Spotify history import routes", () => {
  it("serves the initial import-history request instead of falling through to a 404", async () => {
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      collection: () => ({
        find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
      }),
    } as never);
    const route = app.router.stack.find((layer) => layer.route?.path === "/api/imports/spotify-history/list")?.route;
    if (!route) throw new Error("Import history route was not registered");
    const json = vi.fn();
    const response = { json };

    await route.stack.at(-1)?.handle(
      { body: { limit: 20 }, auth: { userId: "507f1f77bcf86cd799439011" } } as never,
      response as never,
      vi.fn(),
    );

    expect(json).toHaveBeenCalledWith({ error: "", imports: [], nextCursor: null });
  });

  it("accepts a Spotify history JSON upload", async () => {
    const jobs: Record<string, unknown>[] = [];
    const writes: unknown[] = [];
    const progressUpdates: unknown[] = [];
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      collection: (name: string) => {
        if (name === "StreamingHistoryImports") {
          return {
            insertOne: async (job: Record<string, unknown>) => { jobs.push(job); },
            findOne: async () => jobs[0],
            updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
              progressUpdates.push(update.$set);
              Object.assign(jobs[0], update.$set);
              return { matchedCount: 1 };
            },
          };
        }
        if (name === "RecentPlays") {
          return {
            bulkWrite: async (operations: unknown[]) => {
              writes.push(...operations);
              return { upsertedCount: operations.length };
            },
          };
        }
        return { deleteMany: async () => {} };
      },
    } as never);
    const route = app.router.stack.find((layer) => layer.route?.path === "/api/imports/spotify-history")?.route;
    if (!route) throw new Error("Import upload route was not registered");
    const boundary = "test-boundary";
    const exportJson = JSON.stringify([
      { endTime: "2026-10-10 12:00", artistName: "Artist", trackName: "Song", msPlayed: 180_000 },
      { endTime: "2026-10-10 12:00", artistName: "Artist", trackName: "Another song", msPlayed: 120_000 },
    ]);
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="StreamingHistory_music_2.json"\r\nContent-Type: application/json\r\n\r\n${exportJson}\r\n--${boundary}--\r\n`);
    const request = Object.assign(Readable.from([body]), {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      auth: { userId: "507f1f77bcf86cd799439011" },
    });
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };

    await route.stack.at(-1)?.handle(request as never, response as never, vi.fn());

    expect(response.status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: "",
      import: expect.objectContaining({ status: "queued", sourceKinds: [] }),
    }));
    expect(jobs).toHaveLength(1);
    await vi.waitFor(() => expect(jobs[0]).toMatchObject({ status: "completed", active: false }));
    expect(writes.map((write: any) => write.updateOne.update.$set.trackId)).toEqual([expect.any(String), expect.any(String)]);
    expect(writes[0]).not.toMatchObject({ updateOne: { update: { $set: { trackId: (writes[1] as any).updateOne.update.$set.trackId } } } });
    expect(writes.map((write: any) => "trackId" in write.updateOne.update.$setOnInsert)).toEqual([false, false]);
    expect(writes.map((write: any) => "sourceImportIds" in write.updateOne.update.$setOnInsert)).toEqual([false, false]);
    expect(progressUpdates).toContainEqual(expect.objectContaining({ status: "importing" }));
  });

  it("streams rows and commits large imports in bounded batches", async () => {
    const jobs: Record<string, unknown>[] = [];
    const batchSizes: number[] = [];
    const progressUpdates: Record<string, unknown>[] = [];
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      collection: (name: string) => {
        if (name === "StreamingHistoryImports") {
          return {
            insertOne: async (job: Record<string, unknown>) => { jobs.push(job); },
            findOne: async () => jobs[0]?.active ? jobs[0] : null,
            updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
              if (!jobs[0]?.active) return { matchedCount: 0 };
              progressUpdates.push(update.$set);
              Object.assign(jobs[0], update.$set);
              return { matchedCount: 1 };
            },
          };
        }
        if (name === "RecentPlays") {
          return {
            bulkWrite: async (operations: unknown[]) => {
              batchSizes.push(operations.length);
              return { upsertedCount: operations.length };
            },
          };
        }
        return { deleteMany: async () => {} };
      },
    } as never);
    const route = app.router.stack.find((layer) => layer.route?.path === "/api/imports/spotify-history")?.route;
    if (!route) throw new Error("Import upload route was not registered");
    const boundary = "large-test-boundary";
    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      endTime: "2026-10-10 12:00",
      artistName: "Artist",
      trackName: `Song ${index}`,
      msPlayed: 60_000,
    }));
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="StreamingHistory_music_0.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(rows)}\r\n--${boundary}--\r\n`);
    const request = Object.assign(Readable.from([body]), {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      auth: { userId: "507f1f77bcf86cd799439011" },
    });
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };

    await route.stack.at(-1)?.handle(request as never, response as never, vi.fn());

    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      import: expect.objectContaining({ status: "queued" }),
    }));
    await vi.waitFor(() => expect(jobs[0]).toMatchObject({ status: "completed", active: false }));
    expect(batchSizes).toEqual([5_000, 1]);
    expect(jobs[0]).toMatchObject({
      counts: { rowsRead: 5_001, tracksImported: 5_001, duplicates: 0 },
    });
    expect(progressUpdates).toContainEqual(expect.objectContaining({
      status: "importing",
      counts: expect.objectContaining({ rowsRead: 5_000 }),
    }));
  });

  it("cancels an import and immediately removes its imported plays and history record", async () => {
    const calls: string[] = [];
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      collection: (name: string) => {
        if (name === "StreamingHistoryImports") {
          return {
            updateOne: async () => ({ matchedCount: 1 }),
            deleteOne: async () => { calls.push("delete-import"); },
          };
        }
        if (name === "RecentPlays") {
          return {
            updateMany: async () => { calls.push("unlink-import-plays"); },
            deleteMany: async () => { calls.push("delete-orphan-plays"); },
          };
        }
        return { deleteMany: async () => { calls.push("delete-top-snapshots"); } };
      },
    } as never);
    const route = app.router.stack.find((layer) => layer.route?.path === "/api/imports/spotify-history/cancel")?.route;
    if (!route) throw new Error("Import cancellation route was not registered");
    const json = vi.fn();
    const response = { json };

    await route.stack.at(-1)?.handle(
      { body: { importId: "imp_1234567890123456" }, auth: { userId: "507f1f77bcf86cd799439011" } } as never,
      response as never,
      vi.fn(),
    );

    expect(calls).toEqual(["unlink-import-plays", "delete-orphan-plays", "delete-import", "delete-top-snapshots"]);
    expect(json).toHaveBeenCalledWith({ error: "", deleted: true });
  });

  it("removes the import if processing completed between the confirmation and cancel request", async () => {
    const calls: string[] = [];
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      collection: (name: string) => {
        if (name === "StreamingHistoryImports") {
          return {
            updateOne: async () => ({ matchedCount: 0 }),
            findOne: async () => ({ _id: "completed-import" }),
            deleteOne: async () => { calls.push("delete-import"); },
          };
        }
        if (name === "RecentPlays") {
          return {
            updateMany: async () => { calls.push("unlink-import-plays"); },
            deleteMany: async () => { calls.push("delete-orphan-plays"); },
          };
        }
        return { deleteMany: async () => { calls.push("delete-top-snapshots"); } };
      },
    } as never);
    const route = app.router.stack.find((layer) => layer.route?.path === "/api/imports/spotify-history/cancel")?.route;
    if (!route) throw new Error("Import cancellation route was not registered");
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };

    await route.stack.at(-1)?.handle(
      { body: { importId: "imp_1234567890123456" }, auth: { userId: "507f1f77bcf86cd799439011" } } as never,
      response as never,
      vi.fn(),
    );

    expect(calls).toEqual(["unlink-import-plays", "delete-orphan-plays", "delete-import", "delete-top-snapshots"]);
    expect(response.status).not.toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "", deleted: true });
  });

  it("cleans up imported plays when the import record was already removed", async () => {
    const calls: string[] = [];
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      collection: (name: string) => {
        if (name === "StreamingHistoryImports") {
          return {
            updateOne: async () => ({ matchedCount: 0 }),
            deleteOne: async () => { calls.push("delete-import"); },
          };
        }
        if (name === "RecentPlays") {
          return {
            updateMany: async () => { calls.push("unlink-import-plays"); },
            deleteMany: async () => { calls.push("delete-orphan-plays"); },
          };
        }
        return { deleteMany: async () => { calls.push("delete-top-snapshots"); } };
      },
    } as never);
    const route = app.router.stack.find((layer) => layer.route?.path === "/api/imports/spotify-history/cancel")?.route;
    if (!route) throw new Error("Import cancellation route was not registered");
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };

    await route.stack.at(-1)?.handle(
      { body: { importId: "imp_1234567890123456" }, auth: { userId: "507f1f77bcf86cd799439011" } } as never,
      response as never,
      vi.fn(),
    );

    expect(calls).toEqual(["unlink-import-plays", "delete-orphan-plays", "delete-import", "delete-top-snapshots"]);
    expect(json).toHaveBeenCalledWith({ error: "", deleted: true });
  });

  it("allows a cancelled import to be removed from history", async () => {
    const calls: string[] = [];
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      collection: (name: string) => {
        if (name === "StreamingHistoryImports") {
          return {
            findOne: async () => ({ id: "imp_1234567890123456", status: "cancelled" }),
            deleteOne: async () => { calls.push("delete-import"); },
          };
        }
        if (name === "RecentPlays") {
          return {
            updateMany: async () => { calls.push("unlink-import-plays"); },
            deleteMany: async () => { calls.push("delete-orphan-plays"); },
          };
        }
        return { deleteMany: async () => { calls.push("delete-top-snapshots"); } };
      },
    } as never);
    const route = app.router.stack.find((layer) => layer.route?.path === "/api/imports/spotify-history/delete")?.route;
    if (!route) throw new Error("Import deletion route was not registered");
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };

    await route.stack.at(-1)?.handle(
      { body: { importId: "imp_1234567890123456" }, auth: { userId: "507f1f77bcf86cd799439011" } } as never,
      response as never,
      vi.fn(),
    );

    expect(calls).toEqual(["unlink-import-plays", "delete-orphan-plays", "delete-import", "delete-top-snapshots"]);
    expect(response.status).not.toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: "", deleted: true });
  });
});
