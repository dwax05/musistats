import { afterEach, describe, expect, it, vi } from "vitest";
import { getLastFmArtistGenres, getLastFmGenresByArtistName } from "./lastfm";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LASTFM_API_KEY;
});

describe("Last.fm genre lookup", () => {
  it("preserves Last.fm tag-count proportions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      toptags: {
        tag: [
          { name: "indie", count: "8" },
          { name: "dream pop", count: "2" },
        ],
      },
    }))));

    await expect(getLastFmArtistGenres("Tagged Artist", "test-key")).resolves.toEqual([
      { name: "indie", weight: 0.8 },
      { name: "dream pop", weight: 0.2 },
    ]);
  });

  it("refreshes legacy Last.fm cache entries that lack tag weights", async () => {
    process.env.LASTFM_API_KEY = "test-key";
    const updateOne = vi.fn().mockResolvedValue({});
    const db = {
      collection: () => ({
        find: () => ({
          toArray: async () => [{
            normalizedName: "tagged artist",
            artistName: "Tagged Artist",
            genres: ["indie", "dream pop"],
            provider: "lastfm",
          }],
        }),
        updateOne,
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      toptags: {
        tag: [
          { name: "indie", count: "8" },
          { name: "dream pop", count: "2" },
        ],
      },
    }))));

    const result = await getLastFmGenresByArtistName(db as never, ["Tagged Artist"]);

    expect(result.genresByArtist.get("tagged artist")).toEqual([
      { name: "indie", weight: 0.8 },
      { name: "dream pop", weight: 0.2 },
    ]);
    expect(updateOne).toHaveBeenCalledWith(
      { normalizedName: "tagged artist" },
      {
        $set: expect.objectContaining({
          genres: ["indie", "dream pop"],
          genreWeights: [
            { name: "indie", weight: 0.8 },
            { name: "dream pop", weight: 0.2 },
          ],
          provider: "lastfm",
        }),
      },
      { upsert: true },
    );
  });
});
