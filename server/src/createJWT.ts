import jwt from "jsonwebtoken";

// Access: 15 min, lives only in client JS memory.
// Refresh: 30 days, lives only in an httpOnly cookie scoped to /api/auth.
const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET ?? "dev-only-access-secret";
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET ?? "dev-only-refresh-secret";

export type TokenPayload = { userId: string; login: string };

export function createAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: "15m" });
}

export function createRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: "30d" });
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const { userId, login } = jwt.verify(token, ACCESS_SECRET) as TokenPayload;
    return { userId, login };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    const { userId, login } = jwt.verify(token, REFRESH_SECRET) as TokenPayload;
    return { userId, login };
  } catch {
    return null;
  }
}
