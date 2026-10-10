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
    const jobs: unknown[] = [];
    const writes: unknown[] = [];
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      collection: (name: string) => name === "StreamingHistoryImports" ? {
        insertOne: async (job: unknown) => { jobs.push(job); },
        updateOne: async () => ({ matchedCount: 1 }),
      } : name === "RecentPlays" ? {
        bulkWrite: async (operations: unknown[]) => {
          writes.push(...operations);
          return { upsertedCount: 2 };
        },
      } : {
        deleteMany: async () => {},
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
    expect(writes).toEqual([]);
  });
});
