import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncDueFilter, syncSpotifyUser } from "./sync";

beforeEach(() => {
  process.env.SPOTIFY_CLIENT_ID = "client-id";
  process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
});

afterEach(() => vi.unstubAllGlobals());

function fakeDb(snapshot: unknown, retryAfterUntil?: Date) {
  const users = { findOneAndUpdate: vi.fn().mockResolvedValue({}), findOne: vi.fn().mockResolvedValue({ connected: true }), updateOne: vi.fn().mockResolvedValue({}) };
  const config = { findOne: vi.fn().mockResolvedValue(retryAfterUntil ? { retryAfterUntil } : null), findOneAndUpdate: vi.fn().mockResolvedValue({}), updateOne: vi.fn().mockResolvedValue({}) };
  const generic = { updateOne: vi.fn().mockResolvedValue({}), bulkWrite: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}), findOne: vi.fn().mockResolvedValue(null) };
  return { collection: (name: string) => name === "Users" ? users : name === "Config" ? config : name === "TopSnapshots" ? { ...generic, findOne: vi.fn().mockResolvedValue(snapshot) } : generic, users };
}

function stubSpotify() {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items: [] })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Spotify sync", () => {
  it("treats a user as due an hour after the last attempt", () => {
    const filter = syncDueFilter(new Date("2026-10-11T12:00:00.000Z"));
    expect(filter.$or).toEqual([{ lastSyncAttemptAt: { $exists: false } }, { lastSyncAttemptAt: { $lte: new Date("2026-10-11T11:00:00.000Z") } }]);
  });

  it("records the attempt and asks only for recent plays once today's top items are stored", async () => {
    const fetchMock = stubSpotify();
    const albums = { albums: [] };
    const db = fakeDb({ top: { short_term: albums, medium_term: albums, long_term: albums } });
    const user = { _id: new ObjectId(), encryptedRefreshToken: "unused" };

    await syncSpotifyUser(db as never, user, "access-token");

    expect(db.users.updateOne).toHaveBeenCalledWith({ _id: user._id }, { $set: { lastSyncAttemptAt: expect.any(Date) } });
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/v1/me/player/recently-played"]);
  });

  it("fetches the six top lists once when today has no snapshot", async () => {
    const fetchMock = stubSpotify();
    await syncSpotifyUser(fakeDb(null) as never, { _id: new ObjectId(), encryptedRefreshToken: "unused" }, "access-token");
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("makes no Spotify request while the app is rate limited", async () => {
    const fetchMock = stubSpotify();
    const db = fakeDb(null, new Date(Date.now() + 3_600_000));
    await expect(syncSpotifyUser(db as never, { _id: new ObjectId(), encryptedRefreshToken: "unused" })).rejects.toThrow("rate limited");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.users.updateOne).not.toHaveBeenCalledWith(expect.anything(), { $set: { lastSyncAttemptAt: expect.any(Date) } });
  });

  it("does not run two syncs for the same account at once", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const db = fakeDb({ top: { short_term: { albums: [] }, medium_term: { albums: [] }, long_term: { albums: [] } } });
    db.users.findOneAndUpdate.mockResolvedValueOnce({}).mockResolvedValueOnce(null);
    const user = { _id: new ObjectId(), encryptedRefreshToken: "unused" };

    const first = syncSpotifyUser(db as never, user, "access-token");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await syncSpotifyUser(db as never, user, "access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({ items: [] })));
    await first;
  });
});
