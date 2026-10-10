import type { Db, ObjectId } from "mongodb";
import {
  TIME_RANGES,
  decryptSpotifyToken,
  encryptSpotifyToken,
  getRecentTracks,
  getTopArtists,
  getTopTracks,
  refreshSpotifyToken,
  type ArtistSummary,
  type TimeRange,
  type TrackSummary,
} from "./client";
import { ensureImportIndexes } from "../imports/jobs";

type SpotifyUser = {
  _id: ObjectId;
  encryptedRefreshToken: string;
  lastPlayedAt?: Date;
};

type TopItems = Record<TimeRange, { artists: ArtistSummary[]; tracks: TrackSummary[] }>;

export async function ensureSpotifyIndexes(db: Db) {
  await Promise.all([
    db.collection("Users").createIndex({ spotifyId: 1 }, { unique: true }),
    db.collection("RecentPlays").createIndex({ userId: 1, playedAt: 1 }),
    db.collection("RecentPlays").createIndex({ userId: 1, playedAt: -1 }),
    db.collection("RecentPlays").createIndex({ userId: 1, trackId: 1, playedAt: 1 }, { unique: true }),
    db.collection("TopSnapshots").createIndex({ userId: 1, capturedDay: -1 }, { unique: true }),
    ensureImportIndexes(db),
  ]);
}

async function syncConnectedUser(db: Db, user: SpotifyUser, suppliedAccessToken?: string, forceTop = false) {
  let accessToken = suppliedAccessToken;
  if (!accessToken) {
    const tokens = await refreshSpotifyToken(decryptSpotifyToken(user.encryptedRefreshToken));
    accessToken = tokens.accessToken;
    if (tokens.refreshToken) {
      await db.collection("Users").updateOne(
        { _id: user._id },
        { $set: { encryptedRefreshToken: encryptSpotifyToken(tokens.refreshToken) } },
      );
    }
  }

  // shortcut: Spotify returns at most 50 recent plays, follow cursors if users can exceed that between hourly syncs.
  const recent = await getRecentTracks(accessToken, user.lastPlayedAt?.getTime());
  if (recent.length) {
    await db.collection("RecentPlays").bulkWrite(recent.map((track) => ({
      updateOne: {
        filter: { userId: user._id.toString(), trackId: track.id, playedAt: new Date(track.playedAt) },
        update: {
          $setOnInsert: {
            userId: user._id.toString(),
            trackId: track.id,
            name: track.name,
            artists: track.artists,
            imageUrl: track.imageUrl,
            externalUrl: track.externalUrl,
            playedAt: new Date(track.playedAt),
            durationMs: track.durationMs,
            artistIds: track.artistIds,
          },
        },
        upsert: true,
      },
    })), { ordered: false });
  }

  const capturedDay = new Date().toISOString().slice(0, 10);
  const hasToday = await db.collection("TopSnapshots").findOne({ userId: user._id.toString(), capturedDay });
  if (forceTop || !hasToday) {
    const entries = await Promise.all(TIME_RANGES.map(async (range) => {
      const [artists, tracks] = await Promise.all([
        getTopArtists(accessToken, range),
        getTopTracks(accessToken, range),
      ]);
      return [range, { artists, tracks }] as const;
    }));
    const top = Object.fromEntries(entries) as TopItems;
    await db.collection("TopSnapshots").updateOne(
      { userId: user._id.toString(), capturedDay },
      { $set: { userId: user._id.toString(), capturedDay, capturedAt: new Date(), top } },
      { upsert: true },
    );
  }

  const newestPlay = recent.reduce<Date | undefined>((latest, track) => {
    const playedAt = new Date(track.playedAt);
    return !latest || playedAt > latest ? playedAt : latest;
  }, user.lastPlayedAt);

  await db.collection("Users").updateOne(
    { _id: user._id },
    {
      $set: {
        lastSyncedAt: new Date(),
        ...(newestPlay ? { lastPlayedAt: newestPlay } : {}),
      },
      $unset: { syncError: "" },
    },
  );
}

export async function syncSpotifyUser(db: Db, user: SpotifyUser, suppliedAccessToken?: string, forceTop = false) {
  try {
    await syncConnectedUser(db, user, suppliedAccessToken, forceTop);
  } finally {
    const connected = await db.collection("Users").findOne({ _id: user._id, connected: { $ne: false } });
    if (!connected) {
      await Promise.all([
        db.collection("RecentPlays").deleteMany({ userId: user._id.toString() }),
        db.collection("TopSnapshots").deleteMany({ userId: user._id.toString() }),
      ]);
    }
  }
}

export function startSpotifySync(db: Db) {
  let running = false;

  async function syncAll() {
    if (running) return;
    running = true;
    try {
      for await (const user of db.collection<SpotifyUser>("Users").find({ encryptedRefreshToken: { $type: "string" }, connected: { $ne: false } })) {
        try {
          await syncSpotifyUser(db, user);
        } catch (error) {
          console.error(`Spotify sync failed for ${user._id}:`, error);
          await db.collection("Users").updateOne(
            { _id: user._id },
            { $set: { syncError: error instanceof Error ? error.message : "Unknown sync error" } },
          );
        }
      }
    } finally {
      running = false;
    }
  }

  void syncAll();
  const timer = setInterval(() => void syncAll(), 60 * 60 * 1000);
  timer.unref();
}
