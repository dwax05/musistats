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

    const genres = await getSpotifyGenresByArtistName(db as never, ["Artist"], [
      { name: "Artist", genres: ["indie pop"] },
    ]);

    expect(genres.get("artist")).toEqual(["indie pop"]);
    expect(updateOne).toHaveBeenCalledWith(
      { normalizedName: "artist" },
      { $set: expect.objectContaining({ artistName: "Artist", genres: ["indie pop"], provider: "spotify" }) },
      { upsert: true },
    );
  });

  it("reuses only Spotify cache rows and never asks Spotify for missing names", async () => {
    const find = vi.fn().mockReturnValue({
      toArray: async () => [{ normalizedName: "artist", genres: ["ambient"] }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const genres = await getSpotifyGenresByArtistName(
      { collection: () => ({ find }) } as never,
      [" Artist ", "artist", "Unknown Artist"],
    );

    expect(find).toHaveBeenCalledWith({
      normalizedName: { $in: ["artist", "unknown artist"] },
      provider: "spotify",
    });
    expect(genres.get("artist")).toEqual(["ambient"]);
    expect(genres.has("unknown artist")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
