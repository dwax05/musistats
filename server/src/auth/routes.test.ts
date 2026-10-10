import express from "express";
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { encryptSpotifyToken, exchangeSpotifyCode, getSpotifyProfile, syncSpotifyUser } = vi.hoisted(() => ({
  encryptSpotifyToken: vi.fn(() => "encrypted-token"),
  exchangeSpotifyCode: vi.fn(),
  getSpotifyProfile: vi.fn(),
  syncSpotifyUser: vi.fn(),
}));

vi.mock("../spotify/client", () => ({ encryptSpotifyToken, exchangeSpotifyCode, getSpotifyProfile }));
vi.mock("../spotify/sync", () => ({ syncSpotifyUser }));

import { registerAuthRoutes } from "./routes";

beforeEach(() => {
  process.env.ACCESS_TOKEN_SECRET = "access-secret";
  process.env.REFRESH_TOKEN_SECRET = "refresh-secret";
  exchangeSpotifyCode.mockResolvedValue({ accessToken: "spotify-access", refreshToken: "spotify-refresh" });
  getSpotifyProfile.mockResolvedValue({ id: "spotify-user", displayName: "Listener", avatarUrl: null });
});

afterEach(async () => {
  vi.clearAllMocks();
});

describe("Spotify OAuth callback", () => {
  it("redirects before an initial sync completes", async () => {
    const user = { _id: new ObjectId(), encryptedRefreshToken: "encrypted-token" };
    syncSpotifyUser.mockReturnValue(new Promise(() => {}));

    const app = express();
    registerAuthRoutes(app, {
      collection: () => ({ findOneAndUpdate: vi.fn().mockResolvedValue(user) }),
    } as never);
    const route = app.router.stack.find((layer) => layer.route?.path === "/api/auth/spotify/callback")?.route;
    if (!route) throw new Error("Spotify callback route was not registered");
    const res = { cookie: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn() };

    await Promise.race([
      route.stack[0].handle({ query: { code: "code", state: "state" }, cookies: { spotifyOauthState: "state" } } as never, res as never, vi.fn()),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Callback waited for the sync")), 250)),
    ]);

    expect(res.redirect).toHaveBeenCalledWith("/");
    expect(syncSpotifyUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ _id: user._id }), "spotify-access", true);
  });
});
