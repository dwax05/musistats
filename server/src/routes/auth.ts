import type { Express, Request, Response, NextFunction } from "express";
import type { Db } from "mongodb";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type TokenPayload,
} from "../createJWT";

// Every endpoint is a POST returning 200 with { error: "" } on success.
// The one exception to the 200 rule: expired/missing access tokens get a
// real 401 so the client's silent-refresh-and-retry in authedPost can fire.

const REFRESH_COOKIE = "refreshToken";
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const cookieOpts = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth",
};

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(password, salt, 64));
}

function issueTokens(req: Request, res: Response, payload: TokenPayload) {
  // Without remember-me the refresh cookie is a session cookie (no maxAge).
  // The client re-sends x-remember-me on every refresh so rotation preserves it.
  const rememberMe = req.headers["x-remember-me"] === "1";
  res.cookie(REFRESH_COOKIE, createRefreshToken(payload), {
    ...cookieOpts,
    ...(rememberMe ? { maxAge: REFRESH_MAX_AGE } : {}),
  });
  res.json({
    error: "",
    accessToken: createAccessToken(payload),
    user: { id: payload.userId, login: payload.login },
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return res.status(401).json({ error: "unauthorized" });
  (req as Request & { auth: TokenPayload }).auth = payload;
  next();
}

export function registerAuthRoutes(app: Express, db: Db) {
  const users = db.collection("Users");
  void users.createIndex({ login: 1 }, { unique: true });

  app.post("/api/auth/register", async (req, res) => {
    const { login, password } = req.body ?? {};
    if (typeof login !== "string" || !/^[a-zA-Z0-9_]{3,20}$/.test(login))
      return res.json({ error: "Username must be 3-20 letters, numbers, or _" });
    if (typeof password !== "string" || password.length < 8)
      return res.json({ error: "Password must be at least 8 characters" });

    if (await users.findOne({ login })) return res.json({ error: "Username taken" });
    const { insertedId } = await users.insertOne({
      login,
      password: hashPassword(password),
      createdAt: new Date(),
    });
    issueTokens(req, res, { userId: insertedId.toString(), login });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { login, password } = req.body ?? {};
    if (typeof login !== "string" || typeof password !== "string")
      return res.json({ error: "Missing credentials" });

    const user = await users.findOne({ login });
    if (!user || !checkPassword(password, user.password))
      return res.json({ error: "Invalid username or password" });
    issueTokens(req, res, { userId: user._id.toString(), login: user.login });
  });

  app.post("/api/auth/refresh", (req, res) => {
    const payload = verifyRefreshToken(req.cookies?.[REFRESH_COOKIE] ?? "");
    if (!payload) return res.status(401).json({ error: "unauthorized" });
    issueTokens(req, res, payload);
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(REFRESH_COOKIE, cookieOpts);
    res.json({ error: "" });
  });
}
