import type { Db } from "mongodb";

type SpotifyRateLimitConfig = { _id: "spotifyRateLimit"; nextRequestAt?: Date; retryAfterUntil?: Date };

const CONFIG_ID = "spotifyRateLimit" as const;
// shortcut: one request per second keeps this small app below Spotify's rolling quota; replace with a quota-aware queue when higher throughput is needed.
const REQUEST_INTERVAL_MS = 1_000;

export class SpotifyRateLimitError extends Error {
  constructor(readonly retryAfterUntil: Date) {
    super(`Spotify API rate limited until ${retryAfterUntil.toISOString()}`);
    this.name = "SpotifyRateLimitError";
  }
}

export async function ensureSpotifyRateLimit(db: Db) {
  await db.collection<SpotifyRateLimitConfig>("Config").updateOne({ _id: CONFIG_ID }, { $setOnInsert: {} }, { upsert: true });
}

export async function spotifyRateLimitUntil(db: Db): Promise<Date | null> {
  const retryAfterUntil = (await db.collection<SpotifyRateLimitConfig>("Config").findOne({ _id: CONFIG_ID }))?.retryAfterUntil;
  return retryAfterUntil && retryAfterUntil > new Date() ? retryAfterUntil : null;
}

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForSpotifyRequestSlot(db: Db): Promise<void> {
  const config = db.collection<SpotifyRateLimitConfig>("Config");
  for (;;) {
    const now = new Date();
    const nextRequestAt = new Date(now.getTime() + REQUEST_INTERVAL_MS);
    const acquired = await config.findOneAndUpdate(
      {
        _id: CONFIG_ID,
        $and: [
          { $or: [{ retryAfterUntil: { $exists: false } }, { retryAfterUntil: { $lte: now } }] },
          { $or: [{ nextRequestAt: { $exists: false } }, { nextRequestAt: { $lte: now } }] },
        ],
      },
      { $set: { nextRequestAt } },
      { returnDocument: "after" },
    );
    if (acquired) return;

    const blockedUntil = await spotifyRateLimitUntil(db);
    if (blockedUntil) throw new SpotifyRateLimitError(blockedUntil);
    const blocked = await config.findOne({ _id: CONFIG_ID });
    await pause(Math.max(1, (blocked?.nextRequestAt?.getTime() ?? now.getTime()) - now.getTime()));
  }
}

export async function recordSpotifyRateLimit(db: Db, retryAfterSeconds: number): Promise<SpotifyRateLimitError> {
  const retryAfterUntil = new Date(Date.now() + retryAfterSeconds * 1_000);
  await db.collection<SpotifyRateLimitConfig>("Config").updateOne(
    { _id: CONFIG_ID },
    { $max: { retryAfterUntil } },
    { upsert: true },
  );
  return new SpotifyRateLimitError(retryAfterUntil);
}
