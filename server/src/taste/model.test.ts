import { describe, expect, it } from "vitest";
import { buildTasteReplay, type ArtistWithGenres } from "./model";

function artist(id: string, genres: string[]): ArtistWithGenres {
  return { id, name: id, imageUrl: null, externalUrl: "", genres };
}

describe("taste replay snapshots", () => {
  it("weights genres by top artist rank and divides an artist's weight across its genres", () => {
    const result = buildTasteReplay({
      short_term: [
        artist("first", ["indie pop", "dream pop"]),
        artist("second", ["indie pop"]),
      ],
      medium_term: [],
      long_term: [],
    });

    expect(result.short_term).toEqual([
      { name: "indie pop", weight: 2 / 3 },
      { name: "dream pop", weight: 1 / 3 },
    ]);
    expect(result.medium_term).toEqual([]);
  });

  it("merges case-insensitive duplicate genre tags and handles missing genre tags", () => {
    const result = buildTasteReplay({
      short_term: [artist("first", ["Indie Pop", " indie pop "]), artist("second", [])],
      medium_term: [],
      long_term: [],
    });

    expect(result.short_term).toEqual([{ name: "Indie Pop", weight: 1 }]);
  });

  it("uses weighted artist tags instead of assuming every tag is equally relevant", () => {
    const result = buildTasteReplay({
      short_term: [{
        ...artist("first", ["indie", "dream pop"]),
        genreWeights: [
          { name: "indie", weight: 0.8 },
          { name: "dream pop", weight: 0.2 },
        ],
      }],
      medium_term: [],
      long_term: [],
    });

    expect(result.short_term).toEqual([
      { name: "indie", weight: 0.8 },
      { name: "dream pop", weight: 0.2 },
    ]);
  });
});
