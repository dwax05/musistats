import { randomUUID } from "node:crypto";
import type { Db, ObjectId } from "mongodb";
import {
  TIME_RANGES,
  decryptSpotifyToken,
  encryptSpotifyToken,
  getRecentTracks,
  getTopArtists,
  getTopTracks,
  rankTopAlbums,
  refreshSpotifyToken,
  type AlbumSummary,
  type ArtistSummary,
  type TimeRange,
  type TrackSummary,
} from "./client";
import { ensureImportIndexes } from "../imports/jobs";
import { getSpotifyGenresByArtistName } from "./genres";
import { normalizeForFingerprint } from "../imports/model";
import { ensureSpotifyRateLimit, spotifyRateLimitUntil, SpotifyRateLimitError } from "./rate-limit";

type SpotifyUser = {
  _id: ObjectId;
  encryptedRefreshToken: string;
  lastPlayedAt?: Date;
};

type TopItems = Record<TimeRange, { artists: ArtistSummary[]; tracks: TrackSummary[]; albums: AlbumSummary[] }>;
type TopSnapshot = { userId: string; capturedDay: string; top: Partial<TopItems> };
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const SYNC_CHECK_MS = 5 * 60 * 1000;

// A user is due once an hour, counted from the last attempt, so a restart or a failure does not start a new round.
export function syncDueFilter(now: Date) {
  return {
    encryptedRefreshToken: { $type: "string" as const },
    connected: { $ne: false },
    $or: [
      { lastSyncAttemptAt: { $exists: false } },
      { lastSyncAttemptAt: { $lte: new Date(now.getTime() - SYNC_INTERVAL_MS) } },
    ],
  };
}
// shortcut: a five-minute lease favors skipping one sync over duplicate Spotify work; add lease renewal if a sync can legitimately run longer.
const SYNC_LEASE_MS = 5 * 60 * 1_000;

export async function ensureSpotifyIndexes(db: Db) {
  await Promise.all([
    db.collection("Users").createIndex({ spotifyId: 1 }, { unique: true }),
    db.collection("RecentPlays").createIndex({ userId: 1, playedAt: 1 }),
    db.collection("RecentPlays").createIndex({ userId: 1, playedAt: -1 }),
    db.collection("RecentPlays").createIndex({ userId: 1, trackId: 1, playedAt: 1 }, { unique: true }),
    db.collection("TopSnapshots").createIndex({ userId: 1, capturedDay: -1 }, { unique: true }),
    db.collection("ArtistNameGenreCache").createIndex({ normalizedName: 1 }, { unique: true }),
    ensureSpotifyRateLimit(db),
    ensureImportIndexes(db),
  ]);
}

async function syncConnectedUser(db: Db, user: SpotifyUser, suppliedAccessToken?: string) {
  const blockedUntil = await spotifyRateLimitUntil(db);
  if (blockedUntil) throw new SpotifyRateLimitError(blockedUntil);
  await db.collection("Users").updateOne({ _id: user._id }, { $set: { lastSyncAttemptAt: new Date() } });

  let accessToken = suppliedAccessToken;
  if (!accessToken) {
    const tokens = await refreshSpotifyToken(db, decryptSpotifyToken(user.encryptedRefreshToken));
    accessToken = tokens.accessToken;
    if (tokens.refreshToken) {
      await db.collection("Users").updateOne(
        { _id: user._id },
        { $set: { encryptedRefreshToken: encryptSpotifyToken(tokens.refreshToken) } },
      );
    }
  }

  // shortcut: Spotify returns at most 50 recent plays, follow cursors if users can exceed that between hourly syncs.
  const recent = await getRecentTracks(db, accessToken, user.lastPlayedAt?.getTime());
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
            albumName: track.albumName,
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
  const hasToday = await db.collection<TopSnapshot>("TopSnapshots").findOne({ userId: user._id.toString(), capturedDay });
  const needsAlbums = TIME_RANGES.some((range) => !Array.isArray(hasToday?.top?.[range]?.albums));
  if (!hasToday || needsAlbums) {
    const entries = [];
    for (const range of TIME_RANGES) {
      const artists = await getTopArtists(db, accessToken, range);
      const tracks = await getTopTracks(db, accessToken, range);
      entries.push([range, { artists, tracks: tracks.map(({ album: _album, ...track }) => track), albums: rankTopAlbums(tracks) }] as const);
    }
    const artists = entries.flatMap(([, items]) => items.artists);
    const genresByArtist = await getSpotifyGenresByArtistName(
      db,
      artists.map((artist) => artist.name),
      artists,
    );
    const top = Object.fromEntries(entries.map(([range, items]) => [
      range,
      {
        ...items,
        artists: items.artists.map((artist) => ({
          ...artist,
          genres: genresByArtist.get(normalizeForFingerprint(artist.name)) ?? artist.genres ?? [],
        })),
      },
    ])) as TopItems;
    await db.collection("TopSnapshots").updateOne(
      { userId: user._id.toString(), capturedDay },
      {
        $set: { userId: user._id.toString(), capturedDay, capturedAt: new Date(), top },
        $unset: { tasteReplay: "", tasteReplayProvider: "" },
      },
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

export async function syncSpotifyUser(db: Db, user: SpotifyUser, suppliedAccessToken?: string) {
  const syncLeaseId = randomUUID();
  const users = db.collection("Users");
  const claimed = await users.findOneAndUpdate(
    {
      _id: user._id,
      $or: [{ spotifySyncLeaseUntil: { $exists: false } }, { spotifySyncLeaseUntil: { $lte: new Date() } }],
    },
    { $set: { spotifySyncLeaseId: syncLeaseId, spotifySyncLeaseUntil: new Date(Date.now() + SYNC_LEASE_MS) } },
    { returnDocument: "after" },
  );
  if (!claimed) return;
  try {
    try {
      await syncConnectedUser(db, user, suppliedAccessToken);
    } finally {
      const connected = await users.findOne({ _id: user._id, connected: { $ne: false } });
      if (!connected) {
        await Promise.all([
          db.collection("RecentPlays").deleteMany({ userId: user._id.toString() }),
          db.collection("TopSnapshots").deleteMany({ userId: user._id.toString() }),
        ]);
      }
    }
  } finally {
    await users.updateOne({ _id: user._id, spotifySyncLeaseId: syncLeaseId }, { $unset: { spotifySyncLeaseId: "", spotifySyncLeaseUntil: "" } });
  }
}

export function startSpotifySync(db: Db) {
  let running = false;

  async function syncAll() {
    if (running || await spotifyRateLimitUntil(db)) return;
    running = true;
    try {
      const users = await db.collection<SpotifyUser>("Users").find(syncDueFilter(new Date())).toArray();
      for (const user of users) {
        try {
          await syncSpotifyUser(db, user);
        } catch (error) {
          console.error(`Spotify sync failed for ${user._id}:`, error);
          await db.collection("Users").updateOne(
            { _id: user._id },
            { $set: { syncError: error instanceof Error ? error.message : "Unknown sync error" } },
          );
          if (error instanceof SpotifyRateLimitError) break;
        }
      }
    } catch (error) {
      console.error("Spotify sync failed:", error);
    } finally {
      running = false;
    }
  }

  void syncAll();
  const timer = setInterval(() => void syncAll(), SYNC_CHECK_MS);
  timer.unref();
}
