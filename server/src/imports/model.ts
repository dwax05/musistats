import { createHash } from "node:crypto";

export type ImportSourceKind = "streaming_history" | "extended_streaming_history";
export type ImportStatus = "queued" | "validating" | "importing" | "enriching" | "completed" | "failed" | "cancelling" | "cancelled";

export type NormalizedImportPlay = {
  endedAt: string;
  durationMs: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  spotifyTrackUri: string | null;
};

export type ParsedImportRow =
  | { sourceKind: ImportSourceKind; play: NormalizedImportPlay }
  | { sourceKind: ImportSourceKind | null; skipped: "non_music" | "missing_timestamp" | "invalid_row" | "local_file" };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function duration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function utcTimestamp(value: unknown): string | null {
  const input = text(value);
  if (!input) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input) ? `${input.replace(" ", "T")}:00.000Z` : input;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function play(endedAt: string | null, durationMs: number | null, trackName: string | null, artistName: string | null, albumName: string | null, spotifyTrackUri: string | null): ParsedImportRow {
  if (!endedAt) return { sourceKind: null, skipped: "missing_timestamp" };
  if (durationMs === null || !trackName || !artistName) return { sourceKind: null, skipped: "invalid_row" };
  return { sourceKind: spotifyTrackUri === null ? "streaming_history" : "extended_streaming_history", play: { endedAt, durationMs, trackName, artistName, albumName, spotifyTrackUri } };
}

export function parseImportRow(value: unknown): ParsedImportRow {
  const row = record(value);
  if (!row) return { sourceKind: null, skipped: "invalid_row" };

  if ("endTime" in row || "msPlayed" in row) {
    const result = play(utcTimestamp(row.endTime), duration(row.msPlayed), text(row.trackName), text(row.artistName), text(row.albumName), null);
    return "play" in result ? { ...result, sourceKind: "streaming_history" } : result;
  }

  if ("ts" in row || "ms_played" in row) {
    const uri = text(row.spotify_track_uri);
    if (uri?.startsWith("spotify:local:")) return { sourceKind: "extended_streaming_history", skipped: "local_file" };
    const trackName = text(row.master_metadata_track_name);
    const artistName = text(row.master_metadata_album_artist_name);
    if (!trackName || !artistName) return { sourceKind: "extended_streaming_history", skipped: "non_music" };
    const result = play(utcTimestamp(row.ts), duration(row.ms_played), trackName, artistName, text(row.master_metadata_album_album_name), uri);
    return { ...result, sourceKind: "extended_streaming_history" };
  }

  return { sourceKind: null, skipped: "invalid_row" };
}

export function normalizeForFingerprint(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function playFingerprint(userId: string, play: NormalizedImportPlay): string {
  const identity = play.spotifyTrackUri ?? `${normalizeForFingerprint(play.trackName)}\n${normalizeForFingerprint(play.artistName)}`;
  return createHash("sha256")
    .update(`${userId}\n${new Date(play.endedAt).getTime()}\n${identity}\n${play.durationMs}`)
    .digest("hex");
}

// Spotify names music plays StreamingHistory0.json / StreamingHistory_music_0.json (account data) and
// Streaming_History_Audio_2023_1.json (extended). Podcast, audiobook, video and the rest of the export
// are ignored by name so their rows never reach the parser.
const MUSIC_HISTORY_FILE = /^(streaminghistory(_music_)?\d+|streaming_history_audio[\w-]*)\.json$/i;

export function isMusicHistoryFile(name: string): boolean {
  return MUSIC_HISTORY_FILE.test(name.split("/").pop() ?? "");
}
