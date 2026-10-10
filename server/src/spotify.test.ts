import { beforeEach, describe, expect, it } from "vitest";
import {
  SPOTIFY_SCOPES,
  decryptSpotifyToken,
  encryptSpotifyToken,
  spotifyAuthorizeUrl,
} from "./spotify";

beforeEach(() => {
  process.env.SPOTIFY_CLIENT_ID = "client-id";
  process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
  process.env.SPOTIFY_REDIRECT_URI = "http://127.0.0.1:5173/api/auth/spotify/callback";
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
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
});
