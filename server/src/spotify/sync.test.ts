import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSpotifyRateLimit, setSpotifyBlockedUntil } from "./client";
import { syncDueFilter, syncSpotifyUser } from "./sync";

beforeEach(() => {
  process.env.SPOTIFY_CLIENT_ID = "client-id";
  process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
});

afterEach(() => {
  resetSpotifyRateLimit();
  vi.unstubAllGlobals();
});

function fakeDb(snapshot: unknown) {
  const collections: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  const collection = (name: string) => collections[name] ??= {
    updateOne: vi.fn().mockResolvedValue({}),
    bulkWrite: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({}),
    find: vi.fn(() => ({ toArray: async () => [] })),
    findOne: vi.fn().mockResolvedValue(name === "TopSnapshots" ? snapshot : { connected: true }),
  };
  return { collection };
}

function stubSpotify() {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items: [] })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Spotify sync", () => {
  it("treats a user as due an hour after the last attempt", () => {
    const filter = syncDueFilter(new Date("2026-10-11T12:00:00.000Z"));
    expect(filter.$or).toEqual([
      { lastSyncAttemptAt: { $exists: false } },
      { lastSyncAttemptAt: { $lte: new Date("2026-10-11T11:00:00.000Z") } },
    ]);
  });

  it("records the attempt and asks only for recent plays once today's top items are stored", async () => {
    const fetchMock = stubSpotify();
    const albums = { albums: [] };
    const db = fakeDb({ top: { short_term: albums, medium_term: albums, long_term: albums } });
    const user = { _id: new ObjectId(), encryptedRefreshToken: "unused" };

    await syncSpotifyUser(db as never, user, "access-token");

    expect(db.collection("Users").updateOne).toHaveBeenCalledWith({ _id: user._id }, { $set: { lastSyncAttemptAt: expect.any(Date) } });
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/v1/me/player/recently-played"]);
  });

  it("fetches the six top lists once when today has no snapshot", async () => {
    const fetchMock = stubSpotify();
    const db = fakeDb(null);

    await syncSpotifyUser(db as never, { _id: new ObjectId(), encryptedRefreshToken: "unused" }, "access-token");

    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("makes no Spotify request, token refresh included, while the app is rate limited", async () => {
    const fetchMock = stubSpotify();
    setSpotifyBlockedUntil(Date.now() + 3_600_000);
    const db = fakeDb(null);

    await expect(syncSpotifyUser(db as never, { _id: new ObjectId(), encryptedRefreshToken: "unused" })).rejects.toThrow("rate limited");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.collection("Users").updateOne).not.toHaveBeenCalled();
  });
});
