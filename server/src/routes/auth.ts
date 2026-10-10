import { randomBytes, timingSafeEqual } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { Express, NextFunction, Request, Response } from "express";
import {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type TokenPayload,
} from "../createJWT";
import {
  encryptSpotifyToken,
  exchangeSpotifyCode,
  getSpotifyProfile,
  spotifyAuthorizeUrl,
} from "../spotify";
import { syncSpotifyUser } from "../spotify-import";

const REFRESH_COOKIE = "refreshToken";
const OAUTH_STATE_COOKIE = "spotifyOauthState";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

function secureCookies() {
  return process.env.NODE_ENV === "production";
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: secureCookies(),
    path: "/api/auth",
  };
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookies(),
    path: "/api/auth/spotify/callback",
  };
}

function userFromPayload(payload: TokenPayload) {
  return {
    id: payload.userId,
    displayName: payload.displayName,
    avatarUrl: payload.avatarUrl,
  };
}

function setSessionCookie(res: Response, payload: TokenPayload) {
  res.cookie(REFRESH_COOKIE, createRefreshToken(payload), {
    ...sessionCookieOptions(),
    maxAge: THIRTY_DAYS,
  });
}

function sessionResponse(res: Response, payload: TokenPayload) {
  setSessionCookie(res, payload);
  res.json({
    error: "",
    accessToken: createAccessToken(payload),
    user: userFromPayload(payload),
  });
}

function statesMatch(received: string, stored: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(stored);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return res.status(401).json({ error: "unauthorized" });
  (req as Request & { auth: TokenPayload }).auth = payload;
  next();
}

export function authPayload(req: Request): TokenPayload {
  return (req as Request & { auth: TokenPayload }).auth;
}

export function registerAuthRoutes(app: Express, db: Db) {
  const users = db.collection("Users");

  app.get("/api/auth/spotify", (_req, res) => {
    try {
      const state = randomBytes(24).toString("base64url");
      res.cookie(OAUTH_STATE_COOKIE, state, { ...stateCookieOptions(), maxAge: 10 * 60 * 1000 });
      res.redirect(spotifyAuthorizeUrl(state));
    } catch (error) {
      console.error("Spotify OAuth is not configured:", error);
      res.redirect("/?auth_error=configuration");
    }
  });

  app.get("/api/auth/spotify/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const storedState = typeof req.cookies?.[OAUTH_STATE_COOKIE] === "string" ? req.cookies[OAUTH_STATE_COOKIE] : "";
    res.clearCookie(OAUTH_STATE_COOKIE, stateCookieOptions());

    if (!code || !state || !storedState || !statesMatch(state, storedState)) {
      return res.redirect("/?auth_error=state_mismatch");
    }

    try {
      const tokens = await exchangeSpotifyCode(code);
      if (!tokens.refreshToken) throw new Error("Spotify did not return a refresh token");
      const profile = await getSpotifyProfile(tokens.accessToken);
      const now = new Date();
      const user = await users.findOneAndUpdate(
        { spotifyId: profile.id },
        {
          $set: {
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            encryptedRefreshToken: encryptSpotifyToken(tokens.refreshToken),
            connected: true,
            updatedAt: now,
          },
          $setOnInsert: { spotifyId: profile.id, createdAt: now },
        },
        { upsert: true, returnDocument: "after" },
      );
      if (!user) throw new Error("Could not create Spotify account");

      const payload: TokenPayload = {
        userId: user._id.toString(),
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      };
      setSessionCookie(res, payload);

      try {
        await syncSpotifyUser(db, {
          _id: user._id,
          encryptedRefreshToken: user.encryptedRefreshToken,
          lastPlayedAt: user.lastPlayedAt,
        }, tokens.accessToken, true);
      } catch (error) {
        console.error(`Initial Spotify sync failed for ${user._id}:`, error);
      }

      return res.redirect("/");
    } catch (error) {
      console.error("Spotify OAuth callback failed:", error);
      return res.redirect("/?auth_error=spotify");
    }
  });

  app.post("/api/auth/refresh", async (req, res) => {
    const payload = verifyRefreshToken(req.cookies?.[REFRESH_COOKIE] ?? "");
    if (!payload) return res.status(401).json({ error: "unauthorized" });
    if (!ObjectId.isValid(payload.userId)) return res.status(401).json({ error: "unauthorized" });
    const user = await users.findOne({ _id: new ObjectId(payload.userId) });
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, sessionCookieOptions());
      return res.status(401).json({ error: "unauthorized" });
    }
    sessionResponse(res, {
      userId: payload.userId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
    });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(REFRESH_COOKIE, sessionCookieOptions());
    res.json({ error: "" });
  });

  app.post("/api/auth/disconnect", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: "unauthorized" });

    await users.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { connected: false }, $unset: { encryptedRefreshToken: "" } },
    );
    await Promise.all([
      db.collection("RecentPlays").deleteMany({ userId }),
      db.collection("TopSnapshots").deleteMany({ userId }),
    ]);
    await users.deleteOne({ _id: new ObjectId(userId) });
    res.clearCookie(REFRESH_COOKIE, sessionCookieOptions());
    res.json({ error: "" });
  });
}
