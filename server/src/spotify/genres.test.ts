import { afterEach, describe, expect, it, vi } from "vitest";
import { getSpotifyGenresByArtistName } from "./genres";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Spotify artist genre cache", () => {
  it("uses Spotify genres already returned with top artists and persists them", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const find = vi.fn().mockReturnValue({ toArray: async () => [] });
    const db = { collection: () => ({ find, updateOne }) };
    const getAccessToken = vi.fn();

    const genres = await getSpotifyGenresByArtistName(db as never, ["Artist"], getAccessToken, [
      { name: "Artist", genres: ["indie pop"] },
    ]);

    expect(genres.get("artist")).toEqual(["indie pop"]);
    expect(updateOne).toHaveBeenCalledWith(
      { normalizedName: "artist" },
      { $set: expect.objectContaining({ artistName: "Artist", genres: ["indie pop"], provider: "spotify" }) },
      { upsert: true },
    );
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("searches missing names once, saves results, and reuses only Spotify cache rows", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const find = vi.fn().mockReturnValue({ toArray: async () => [] });
    const db = { collection: () => ({ find, updateOne }) };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        artists: { items: [{ id: "artist-id", name: "Artist", genres: ["ambient"] }] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const genres = await getSpotifyGenresByArtistName(
      db as never,
      [" Artist ", "artist"],
      async () => "access-token",
    );

    expect(find).toHaveBeenCalledWith({
      normalizedName: { $in: ["artist"] },
      provider: "spotify",
    });
    expect(genres.get("artist")).toEqual(["ambient"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      { normalizedName: "artist" },
      { $set: expect.objectContaining({ genres: ["ambient"], provider: "spotify" }) },
      { upsert: true },
    );
  });

  it("does not request an access token when all requested names are cached", async () => {
    const find = vi.fn().mockReturnValue({
      toArray: async () => [{ normalizedName: "artist", genres: ["ambient"] }],
    });
    const getAccessToken = vi.fn();

    const genres = await getSpotifyGenresByArtistName(
      { collection: () => ({ find }) } as never,
      ["Artist"],
      getAccessToken,
    );

    expect(genres.get("artist")).toEqual(["ambient"]);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("stops the lookup queue when Spotify requests fail", async () => {
    const find = vi.fn().mockReturnValue({ toArray: async () => [] });
    const fetchMock = vi.fn().mockRejectedValue(new Error("Spotify unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const genres = await getSpotifyGenresByArtistName(
      { collection: () => ({ find, updateOne: vi.fn().mockResolvedValue({}) }) } as never,
      Array.from({ length: 20 }, (_, index) => `Artist ${index}`),
      async () => "access-token",
    );

    expect(genres.size).toBe(0);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
