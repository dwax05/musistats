import jwt from "jsonwebtoken";

// Access: 15 min, lives only in client JS memory.
// Refresh: 30 days, lives only in an httpOnly cookie scoped to /api/auth.
function secret(name: "ACCESS_TOKEN_SECRET" | "REFRESH_TOKEN_SECRET"): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} is required`);
  return `dev-only-${name.toLowerCase()}`;
}

export type TokenPayload = { userId: string; displayName: string; avatarUrl: string | null };

export function createAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, secret("ACCESS_TOKEN_SECRET"), { expiresIn: "15m" });
}

export function createRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, secret("REFRESH_TOKEN_SECRET"), { expiresIn: "30d" });
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const { userId, displayName, avatarUrl } = jwt.verify(token, secret("ACCESS_TOKEN_SECRET")) as TokenPayload;
    if (!userId || !displayName || (avatarUrl !== null && typeof avatarUrl !== "string")) return null;
    return { userId, displayName, avatarUrl };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    const { userId, displayName, avatarUrl } = jwt.verify(token, secret("REFRESH_TOKEN_SECRET")) as TokenPayload;
    if (!userId || !displayName || (avatarUrl !== null && typeof avatarUrl !== "string")) return null;
    return { userId, displayName, avatarUrl };
  } catch {
    return null;
  }
}
