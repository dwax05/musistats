import type { User } from "../auth/AuthProvider";
import type { Album, Artist, DashboardData, ListeningSession, TimeRange, Track } from "./model";

function artwork(letter: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color}"/><circle cx="72" cy="28" r="32" fill="#fff" opacity=".12"/><text x="50" y="64" text-anchor="middle" font-family="system-ui" font-size="42" font-weight="700" fill="#fff">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const artists: Artist[] = [
  ["a1", "Solstice FM", "S", "#6d4aff"],
  ["a2", "Juniper", "J", "#e04f8a"],
  ["a3", "North Arcade", "N", "#2687d9"],
  ["a4", "Soft Static", "S", "#d98324"],
  ["a5", "Afterimage", "A", "#238d68"],
].map(([id, name, letter, color]) => ({ id, name, imageUrl: artwork(letter, color), externalUrl: "https://open.spotify.com" }));

const tracks: Track[] = [
  ["t1", "Slow Motion", ["Solstice FM"], "S", "#6246c9"],
  ["t2", "Cherry Lines", ["Juniper"], "C", "#b83d70"],
  ["t3", "Nothing Personal", ["North Arcade"], "N", "#2175b8"],
  ["t4", "Window Seat", ["Soft Static"], "W", "#b96f20"],
  ["t5", "Second Nature", ["Afterimage"], "S", "#1e7758"],
].map(([id, name, names, letter, color]) => ({ id: id as string, name: name as string, artists: names as string[], imageUrl: artwork(letter as string, color as string), externalUrl: "https://open.spotify.com" }));

const albums: Album[] = [
  ["al1", "Daylight Static", ["Solstice FM"], "D", "#6246c9"],
  ["al2", "Cherry Season", ["Juniper"], "C", "#b83d70"],
  ["al3", "Northbound", ["North Arcade"], "N", "#2175b8"],
  ["al4", "Open Window", ["Soft Static"], "O", "#b96f20"],
  ["al5", "Afterimage", ["Afterimage"], "A", "#1e7758"],
].map(([id, name, names, letter, color]) => ({ id: id as string, name: name as string, artists: names as string[], imageUrl: artwork(letter as string, color as string), externalUrl: "https://open.spotify.com" }));

function rotated<T>(items: T[], by: number) {
  return [...items.slice(by), ...items.slice(0, by)];
}

export const DEMO_USER: User = {
  id: "demo",
  displayName: "Alex",
  avatarUrl: null,
};

export const DEMO_DASHBOARD: DashboardData = {
  error: "",
  updatedAt: new Date().toISOString(),
  top: {
    short_term: { artists, tracks, albums },
    medium_term: { artists: rotated(artists, 1), tracks: rotated(tracks, 2), albums: rotated(albums, 1) },
    long_term: { artists: rotated(artists, 2), tracks: rotated(tracks, 1), albums: rotated(albums, 2) },
  },
  last24Hours: {
    songs: 24,
    minutes: 81,
    artists: 12,
    topArtist: { name: "Solstice FM", imageUrl: artists[0].imageUrl },
    topTrack: { name: "Slow Motion", imageUrl: tracks[0].imageUrl },
    minutesByHour: [0, 0, 0, 0, 0, 0, 4, 9, 7, 3, 11, 6, 2, 8, 5, 10, 4, 3, 5, 2, 1, 1, 0, 0],
    playsByHour: [0, 0, 0, 0, 0, 0, 1, 2, 2, 1, 3, 2, 1, 2, 2, 3, 1, 1, 2, 1, 0, 0, 0, 0],
  },
  recent: tracks.map((track, index) => ({
    ...track,
    playedAt: new Date(Date.now() - index * 32 * 60 * 1000).toISOString(),
  })),
};

const demoNow = Date.now();
const sessionOneTracks = [tracks[0], tracks[1], tracks[0], tracks[2], tracks[0]].map((track, index) => ({
  ...track,
  playedAt: new Date(demoNow - (90 - index * 18) * 60 * 1000).toISOString(),
}));
const sessionTwoTracks = [tracks[3], tracks[4], tracks[3]].map((track, index) => ({
  ...track,
  playedAt: new Date(demoNow - (26 * 60 + 48 - index * 16) * 60 * 1000).toISOString(),
}));

const demoSessions: ListeningSession[] = [
  {
    id: "session-1",
    startedAt: sessionOneTracks[0].playedAt,
    endedAt: new Date(demoNow - 10 * 60 * 1000).toISOString(),
    minutes: 78,
    songs: sessionOneTracks.length,
    artists: 3,
    topArtist: { name: "Solstice FM", imageUrl: artists[0].imageUrl },
    tracks: sessionOneTracks,
  },
  {
    id: "session-2",
    startedAt: sessionTwoTracks[0].playedAt,
    endedAt: new Date(demoNow - (26 * 60 + 12) * 60 * 1000).toISOString(),
    minutes: 42,
    songs: sessionTwoTracks.length,
    artists: 2,
    topArtist: { name: "Soft Static", imageUrl: artists[3].imageUrl },
    tracks: sessionTwoTracks,
  },
];

export const DEMO_SESSIONS: Record<TimeRange, ListeningSession[]> = {
  short_term: demoSessions,
  medium_term: demoSessions,
  long_term: demoSessions,
};
