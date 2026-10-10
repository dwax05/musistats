import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPOTIFY_SCOPES,
  decryptSpotifyToken,
  encryptSpotifyToken,
  getRecentTracks,
  spotifyAuthorizeUrl,
} from "./client";

beforeEach(() => {
  process.env.SPOTIFY_CLIENT_ID = "client-id";
  process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
  process.env.SPOTIFY_REDIRECT_URI = "http://127.0.0.1:5173/api/auth/spotify/callback";
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Spotify OAuth", () => {
  it("builds an authorization URL with the minimum stats scopes", () => {
    const url = new URL(spotifyAuthorizeUrl("state-value"));
    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(SPOTIFY_SCOPES);
  });

  it("encrypts stored refresh tokens", () => {
    const encrypted = encryptSpotifyToken("refresh-token");
    expect(encrypted).not.toContain("refresh-token");
    expect(decryptSpotifyToken(encrypted)).toBe("refresh-token");
  });

  it("keeps the metadata analytics need when parsing recent tracks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          played_at: "2026-10-10T12:00:00.000Z",
          track: {
            id: "track-1",
            name: "Collaboration",
            duration_ms: 210000,
            artists: [{ id: "artist-1", name: "Lead" }, { id: "artist-2", name: "Guest" }],
            album: {
              artists: [{ id: "artist-1", name: "Lead" }],
              release_date: "2020-04",
              release_date_precision: "month",
              images: [],
            },
            external_urls: { spotify: "https://open.spotify.com/track/track-1" },
          },
        }],
      }),
    }));

    await expect(getRecentTracks("access-token")).resolves.toEqual([expect.objectContaining({
      durationMs: 210000,
      artistIds: ["artist-1", "artist-2"],
      albumArtistIds: ["artist-1"],
      albumReleaseDate: "2020-04",
      albumReleaseDatePrecision: "month",
    })]);
  });
});
