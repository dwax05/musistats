import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { TIME_RANGES, type TimeRange } from "../analytics/range";

const ACCOUNTS_URL = "https://accounts.spotify.com";
const API_URL = "https://api.spotify.com/v1";
export const SPOTIFY_SCOPES = ["user-read-private", "user-top-read", "user-read-recently-played"];
export { TIME_RANGES, type TimeRange } from "../analytics/range";

export type ArtistSummary = {
  id: string;
  name: string;
  imageUrl: string | null;
  externalUrl: string;
};

export type TrackSummary = {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  externalUrl: string;
};

export type RecentTrack = TrackSummary & {
  playedAt: string;
  durationMs: number;
  artistIds: string[];
};
export type SpotifyProfile = { id: string; displayName: string; avatarUrl: string | null };
export type SpotifyTokens = { accessToken: string; refreshToken?: string };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function clientAuthorization(): string {
  return `Basic ${Buffer.from(`${requiredEnv("SPOTIFY_CLIENT_ID")}:${requiredEnv("SPOTIFY_CLIENT_SECRET")}`).toString("base64")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Spotify response");
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function firstImage(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const image of value) {
    const url = stringValue(optionalRecord(image)?.url);
    if (url) return url;
  }
  return null;
}

function externalUrl(value: unknown): string {
  return stringValue(optionalRecord(value)?.spotify);
}

function parseArtist(value: unknown): ArtistSummary | null {
  const artist = optionalRecord(value);
  if (!artist) return null;
  const id = stringValue(artist.id);
  const name = stringValue(artist.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    imageUrl: firstImage(artist.images),
    externalUrl: externalUrl(artist.external_urls),
  };
}

function parseTrack(value: unknown): Omit<RecentTrack, "playedAt"> | null {
  const track = optionalRecord(value);
  if (!track) return null;
  const id = stringValue(track.id);
  const name = stringValue(track.name);
  if (!id || !name) return null;
  const album = optionalRecord(track.album);
  const durationMs = numberValue(track.duration_ms);
  if (durationMs === null) return null;
  const artists = Array.isArray(track.artists)
    ? track.artists.map((artist) => stringValue(optionalRecord(artist)?.name)).filter(Boolean)
    : [];
  const artistIds = Array.isArray(track.artists)
    ? track.artists.map((artist) => stringValue(optionalRecord(artist)?.id)).filter(Boolean)
    : [];
  return {
    id,
    name,
    artists,
    imageUrl: firstImage(album?.images),
    externalUrl: externalUrl(track.external_urls),
    durationMs,
    artistIds,
  };
}

async function tokenRequest(body: URLSearchParams): Promise<SpotifyTokens> {
  const response = await fetch(`${ACCOUNTS_URL}/api/token`, {
    method: "POST",
    headers: {
      Authorization: clientAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) throw new Error(`Spotify token exchange failed (${response.status})`);
  const data = asRecord(await response.json());
  const accessToken = stringValue(data.access_token);
  if (!accessToken) throw new Error("Spotify did not return an access token");
  const refreshToken = stringValue(data.refresh_token);
  return { accessToken, ...(refreshToken ? { refreshToken } : {}) };
}

async function spotifyGet(accessToken: string, path: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 429 && attempt === 0) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      continue;
    }
    if (!response.ok) throw new Error(`Spotify API request failed (${response.status})`);
    return asRecord(await response.json());
  }
  throw new Error("Spotify rate limit retry failed");
}

export function spotifyAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requiredEnv("SPOTIFY_CLIENT_ID"),
    response_type: "code",
    redirect_uri: requiredEnv("SPOTIFY_REDIRECT_URI"),
    scope: SPOTIFY_SCOPES.join(" "),
    state,
  });
  return `${ACCOUNTS_URL}/authorize?${params}`;
}

export function exchangeSpotifyCode(code: string): Promise<SpotifyTokens> {
  return tokenRequest(new URLSearchParams({
    code,
    redirect_uri: requiredEnv("SPOTIFY_REDIRECT_URI"),
    grant_type: "authorization_code",
  }));
}

export function refreshSpotifyToken(refreshToken: string): Promise<SpotifyTokens> {
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export async function getSpotifyProfile(accessToken: string): Promise<SpotifyProfile> {
  const data = await spotifyGet(accessToken, "/me");
  const id = stringValue(data.id);
  if (!id) throw new Error("Spotify profile is missing an id");
  return {
    id,
    displayName: stringValue(data.display_name) || "Spotify listener",
    avatarUrl: firstImage(data.images),
  };
}

export async function getTopArtists(accessToken: string, range: TimeRange): Promise<ArtistSummary[]> {
  const data = await spotifyGet(accessToken, `/me/top/artists?limit=50&time_range=${range}`);
  return Array.isArray(data.items) ? data.items.map(parseArtist).filter((item): item is ArtistSummary => item !== null) : [];
}

export async function getTopTracks(accessToken: string, range: TimeRange): Promise<TrackSummary[]> {
  const data = await spotifyGet(accessToken, `/me/top/tracks?limit=50&time_range=${range}`);
  return Array.isArray(data.items)
    ? data.items.map(parseTrack).filter((item): item is Omit<RecentTrack, "playedAt"> => item !== null)
    : [];
}

export async function getRecentTracks(accessToken: string, after?: number): Promise<RecentTrack[]> {
  const query = new URLSearchParams({ limit: "50" });
  if (after) query.set("after", String(after));
  const data = await spotifyGet(accessToken, `/me/player/recently-played?${query}`);
  if (!Array.isArray(data.items)) return [];
  return data.items.flatMap((value) => {
    const item = optionalRecord(value);
    if (!item) return [];
    const track = parseTrack(item.track);
    const playedAt = stringValue(item.played_at);
    return track && playedAt ? [{ ...track, playedAt }] : [];
  });
}

function encryptionKey(): Buffer {
  const key = Buffer.from(requiredEnv("SPOTIFY_TOKEN_ENCRYPTION_KEY"), "hex");
  if (key.length !== 32) throw new Error("SPOTIFY_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters");
  return key;
}

export function encryptSpotifyToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSpotifyToken(value: string): string {
  const parts = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (parts.length !== 3) throw new Error("Invalid encrypted Spotify token");
  const [iv, tag, encrypted] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
