import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPOTIFY_SCOPES,
  decryptSpotifyToken,
  encryptSpotifyToken,
  getArtistGenresByName,
  getRecentTracks,
  getTopArtists,
  getTopTracks,
  rankTopAlbums,
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
  vi.useRealTimers();
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
    })]);
  });

  it("keeps album details from top tracks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          id: "track-1",
          name: "Song",
          duration_ms: 210000,
          artists: [{ id: "artist-1", name: "Artist" }],
          album: {
            id: "album-1",
            name: "Album",
            artists: [{ id: "artist-1", name: "Artist" }],
            images: [{ url: "https://image.test/album.jpg" }],
            external_urls: { spotify: "https://open.spotify.com/album/album-1" },
          },
          external_urls: { spotify: "https://open.spotify.com/track/track-1" },
        }],
      }),
    }));

    await expect(getTopTracks("access-token", "short_term")).resolves.toEqual([expect.objectContaining({
      album: {
        id: "album-1",
        name: "Album",
        artists: ["Artist"],
        imageUrl: "https://image.test/album.jpg",
        externalUrl: "https://open.spotify.com/album/album-1",
      },
    })]);
  });

  it("parses genres from Spotify top artists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          id: "artist-1",
          name: "Artist",
          genres: [" indie pop ", "dream pop", 4],
          images: [],
          external_urls: { spotify: "https://open.spotify.com/artist/artist-1" },
        }],
      }),
    }));

    await expect(getTopArtists("access-token", "short_term")).resolves.toEqual([
      expect.objectContaining({ id: "artist-1", name: "Artist", genres: ["indie pop", "dream pop"] }),
    ]);
  });

  it("searches Spotify by artist name and only returns genres for an exact name match", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        artists: {
          items: [
            { id: "other", name: "Example Artist Live", genres: ["live"], images: [], external_urls: {} },
            { id: "match", name: "Example Artist", genres: ["ambient"], images: [], external_urls: {} },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getArtistGenresByName("access-token", "Example Artist")).resolves.toEqual(["ambient"]);
    const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestUrl.pathname).toBe("/v1/search");
    expect(requestUrl.searchParams.get("type")).toBe("artist");
    expect(requestUrl.searchParams.get("q")).toBe("artist:Example Artist");
  });

  it("does not use genres from a similarly named artist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        artists: { items: [{ id: "other", name: "Example Artist Live", genres: ["live"] }] },
      }),
    }));

    await expect(getArtistGenresByName("access-token", "Example Artist")).resolves.toEqual([]);
  });

  it("honors Spotify Retry-After values instead of retrying early", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "5" } }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        artists: { items: [{ id: "match", name: "Example Artist", genres: ["ambient"] }] },
      })));
    vi.stubGlobal("fetch", fetchMock);

    const result = getArtistGenresByName("access-token", "Example Artist");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(["ambient"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ranks albums by their appearances in top tracks", () => {
    const album = (id: string, name: string) => ({ id, name, artists: ["Artist"], imageUrl: null, externalUrl: "" });
    const track = (id: string, value: ReturnType<typeof album>) => ({ id, name: id, artists: ["Artist"], imageUrl: null, externalUrl: "", album: value });

    expect(rankTopAlbums([
      track("track-1", album("album-1", "First")),
      track("track-2", album("album-2", "Second")),
      track("track-3", album("album-1", "First")),
    ])).toEqual([
      album("album-1", "First"),
      album("album-2", "Second"),
    ]);
  });
});
