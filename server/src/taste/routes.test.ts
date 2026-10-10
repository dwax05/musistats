import express from "express";
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccessToken } from "../auth/tokens";
import { encryptSpotifyToken } from "../spotify/client";
import { registerTasteRoutes } from "./routes";

beforeEach(() => {
  process.env.ACCESS_TOKEN_SECRET = "taste-route-test-secret";
  process.env.SPOTIFY_CLIENT_ID = "client-id";
  process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
  delete process.env.LASTFM_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LASTFM_API_KEY;
});

function routeHarness(snapshots: Record<string, unknown>[] = [
  {
    capturedAt: new Date("2026-10-02T00:00:00.000Z"),
    capturedDay: "2026-10-02",
    top: { short_term: { artists: [{ id: "artist-2", name: "Artist B", genres: ["indie pop"] }] } },
    tasteReplay: { short_term: [{ name: "legacy genre", weight: 1 }] },
  },
  {
    capturedAt: new Date("2026-10-01T00:00:00.000Z"),
    capturedDay: "2026-10-01",
    top: { short_term: { artists: [{ id: "artist-1", name: "Artist A", genres: ["dream pop"] }] } },
    tasteReplay: { short_term: [{ name: "legacy genre", weight: 1 }] },
  },
], plays: Record<string, unknown>[] = [], cachedNamedTags: Record<string, unknown>[] = []) {
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(snapshots),
  };
  const playsCursor = {
    sort: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(plays),
  };
  const tagsCursor = { toArray: vi.fn().mockResolvedValue(cachedNamedTags) };
  const updateOne = vi.fn().mockResolvedValue({});
  const userId = new ObjectId();
  const db = {
    collection: (name: string) => {
      if (name === "Users") return {
        findOne: vi.fn().mockResolvedValue({ _id: userId, encryptedRefreshToken: encryptSpotifyToken("refresh-token") }),
        updateOne,
      };
      if (name === "RecentPlays") return { find: vi.fn().mockReturnValue(playsCursor) };
      if (name === "ArtistNameGenreCache") return { find: vi.fn().mockReturnValue(tagsCursor), updateOne };
      return { find: vi.fn().mockReturnValue(cursor) };
    },
  };
  const app = express();
  registerTasteRoutes(app, db as never);
  const route = app.router.stack.find((layer) => layer.route?.path === "/api/taste-replay")?.route;
  if (!route) throw new Error("Taste replay route was not registered");
  const [auth, handler] = route.stack;
  const req = {
    headers: { authorization: `Bearer ${createAccessToken({ userId: userId.toString(), displayName: "Test", avatarUrl: null })}` },
    body: { range: "short_term" },
  };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

  return { auth: auth.handle, cursor, playsCursor, updateOne, handler: handler.handle, req, res };
}

describe("taste replay route", () => {
  it("returns bounded snapshots chronologically for the selected range", async () => {
    const harness = routeHarness();
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());

    expect(harness.cursor.sort).toHaveBeenCalledWith({ capturedDay: -1 });
    expect(harness.cursor.limit).toHaveBeenCalledWith(365);
    expect(harness.res.json).toHaveBeenCalledWith({
      error: "",
      range: "short_term",
      status: "ready",
      source: "spotify_snapshots",
      intervalDays: 1,
      frames: [
        { capturedAt: "2026-10-01T00:00:00.000Z", genres: [{ name: "dream pop", weight: 1 }] },
        { capturedAt: "2026-10-02T00:00:00.000Z", genres: [{ name: "indie pop", weight: 1 }] },
      ],
    });
  });

  it("rejects unsupported ranges", async () => {
    const harness = routeHarness();
    harness.req.body.range = "forever";
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());

    expect(harness.res.status).toHaveBeenCalledWith(400);
    expect(harness.res.json).toHaveBeenCalledWith({ error: "invalid_range" });
    expect(harness.cursor.toArray).not.toHaveBeenCalled();
  });

  it("reports when no snapshots have been captured yet", async () => {
    const harness = routeHarness([]);
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());

    expect(harness.res.json).toHaveBeenCalledWith({
      error: "",
      range: "short_term",
      status: "no_snapshots",
      source: "spotify_snapshots",
      intervalDays: 1,
      frames: [],
    });
  });

  it("distinguishes saved snapshots with no genre data", async () => {
    const harness = routeHarness([
      {
        capturedAt: new Date("2026-10-02T00:00:00.000Z"),
        capturedDay: "2026-10-02",
        tasteReplay: { short_term: [{ name: "legacy genre", weight: 1 }] },
      },
    ]);
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());

    expect(harness.res.json).toHaveBeenCalledWith({
      error: "",
      range: "short_term",
      status: "no_genre_data",
      source: "spotify_snapshots",
      intervalDays: 1,
      frames: [],
    });
  });

  it("reports missing genre provider when no cached artist data exists", async () => {
    const harness = routeHarness([
      {
        capturedAt: new Date("2026-10-02T00:00:00.000Z"),
        capturedDay: "2026-10-02",
        top: { short_term: { artists: [{ id: "artist-1", name: "Artist A", genres: [] }] } },
      },
    ]);
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());

    expect(harness.res.json).toHaveBeenCalledWith({
      error: "",
      range: "short_term",
      status: "provider_not_configured",
      source: "spotify_snapshots",
      intervalDays: 1,
      frames: [],
    });
  });

  it("builds smoothed frames from imported listening duration and cached genre tags", async () => {
    const harness = routeHarness([], [
      { playedAt: new Date("2026-10-01T12:00:00.000Z"), durationMs: 90_000, artists: ["Artist A"], sourceImportIds: ["imp_abc"] },
      { playedAt: new Date("2026-10-01T16:00:00.000Z"), durationMs: 30_000, artists: ["Artist B"], sourceImportIds: ["imp_abc"] },
      { playedAt: new Date("2026-10-02T12:00:00.000Z"), durationMs: 60_000, artists: ["Artist B"], sourceImportIds: ["imp_abc"] },
    ], [
      { normalizedName: "artist a", genres: ["ambient"], provider: "spotify", updatedAt: new Date() },
      { normalizedName: "artist b", genres: ["indie pop"], provider: "spotify", updatedAt: new Date() },
    ]);
    harness.req.body.range = "long_term";
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());

    expect(harness.res.json).toHaveBeenCalledWith({
      error: "",
      range: "long_term",
      status: "ready",
      source: "imported_history",
      intervalDays: 1,
      frames: [
        { capturedAt: "2026-10-01T00:00:00.000Z", genres: [{ name: "ambient", weight: 0.5 }, { name: "indie pop", weight: 0.5 }] },
        { capturedAt: "2026-10-02T00:00:00.000Z", genres: [{ name: "ambient", weight: 0.5 }, { name: "indie pop", weight: 0.5 }] },
      ],
    });
    expect(harness.cursor.toArray).not.toHaveBeenCalled();
  });

  it("returns promptly while Last.fm genre data is enriched in the background", async () => {
    process.env.LASTFM_API_KEY = "lastfm-test-key";
    const harness = routeHarness([], [
      {
        playedAt: new Date("2026-10-01T12:00:00.000Z"),
        durationMs: 90_000,
        artists: ["Artist A"],
        sourceImportIds: ["imp_abc"],
      },
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        toptags: { tag: { name: "ambient", count: "8" } },
      })));
    vi.stubGlobal("fetch", fetchMock);
    harness.req.body.range = "long_term";
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());

    expect(harness.res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: "loading_genres",
      source: "imported_history",
      frames: [],
    }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("ws.audioscrobbler.com");
    await vi.waitFor(() => expect(harness.updateOne).toHaveBeenCalledWith(
      { normalizedName: "artist a" },
      { $set: expect.objectContaining({ genres: ["ambient"], provider: "lastfm" }) },
      { upsert: true },
    ));
  });

  it("enriches only the most-listened artists per batch", async () => {
    process.env.LASTFM_API_KEY = "lastfm-test-key";
    const plays = Array.from({ length: 40 }, (_, index) => ({
      playedAt: new Date("2026-10-01T12:00:00.000Z"),
      durationMs: index === 39 ? 900_000 : 60_000,
      artists: [`Artist ${String(index).padStart(2, "0")}`],
      sourceImportIds: ["imp_abc"],
    }));
    const harness = routeHarness([], plays);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      toptags: { tag: { name: "indie", count: "8" } },
    }))));
    vi.stubGlobal("fetch", fetchMock);
    harness.req.body.range = "long_term";
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(25));
    const requestedArtists = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("artist"));
    expect(requestedArtists).toContain("Artist 39");
    expect(requestedArtists).not.toContain("Artist 38");
  });

  it("reports a failed background lookup instead of leaving replay in a loading state", async () => {
    process.env.LASTFM_API_KEY = "lastfm-test-key";
    const harness = routeHarness([], [
      {
        playedAt: new Date("2026-10-01T12:00:00.000Z"),
        durationMs: 90_000,
        artists: ["Artist A"],
        sourceImportIds: ["imp_abc"],
      },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Last.fm unavailable")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    harness.auth(harness.req as never, harness.res as never, vi.fn());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());
    expect(harness.res.json).toHaveBeenLastCalledWith(expect.objectContaining({ status: "loading_genres" }));

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    await harness.handler(harness.req as never, harness.res as never, vi.fn());
    expect(harness.res.json).toHaveBeenLastCalledWith(expect.objectContaining({ status: "genre_lookup_failed" }));
  });
});
