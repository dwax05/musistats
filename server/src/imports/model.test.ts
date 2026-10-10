import { describe, expect, it } from "vitest";
import { isMusicHistoryFile, parseImportRow, playFingerprint } from "./model";

describe("Spotify history rows", () => {
  it("retains only the allowed legacy fields", () => {
    const row = parseImportRow({
      endTime: "2026-10-10 12:34",
      msPlayed: 180000,
      trackName: " Song ",
      artistName: " Artist ",
      albumName: " Album ",
      username: "must-not-persist",
      ip_addr_decrypted: "127.0.0.1",
    });

    expect(row).toEqual({
      sourceKind: "streaming_history",
      play: {
        endedAt: "2026-10-10T12:34:00.000Z",
        durationMs: 180000,
        trackName: "Song",
        artistName: "Artist",
        albumName: "Album",
        spotifyTrackUri: null,
      },
    });
  });

  it("parses extended music history and rejects private/non-music rows", () => {
    expect(parseImportRow({
      ts: "2026-10-10T12:34:00.000Z",
      ms_played: 180000,
      master_metadata_track_name: "Song",
      master_metadata_album_artist_name: "Artist",
      master_metadata_album_album_name: "Album",
      spotify_track_uri: "spotify:track:abc",
      conn_country: "US",
      user_agent_decrypted: "private",
    })).toMatchObject({ sourceKind: "extended_streaming_history", play: { spotifyTrackUri: "spotify:track:abc" } });
    expect(parseImportRow({ ts: "2026-10-10T12:34:00.000Z", ms_played: 1, episode_name: "Podcast" })).toEqual({ sourceKind: "extended_streaming_history", skipped: "non_music" });
    expect(parseImportRow({ ts: "2026-10-10T12:34:00.000Z", ms_played: 1, spotify_track_uri: "spotify:local:Artist:Song" })).toEqual({ sourceKind: "extended_streaming_history", skipped: "local_file" });
  });

  it("uses normalized name fields only when an URI is unavailable", () => {
    const play = { endedAt: "2026-10-10T12:34:00.000Z", durationMs: 180000, trackName: "Song  Name", artistName: "Artist", albumName: null, spotifyTrackUri: null };
    expect(playFingerprint("user", play)).toBe(playFingerprint("user", { ...play, trackName: " song name " }));
    expect(playFingerprint("user", { ...play, spotifyTrackUri: "spotify:track:abc" })).not.toBe(playFingerprint("user", play));
  });
});

describe("music history file names", () => {
  it("keeps only music history files from a Spotify account export", () => {
    const kept = [
      "StreamingHistory_music_2.json",
      "StreamingHistory0.json",
      "Spotify Account Data/StreamingHistory_music_0.json",
      "Streaming_History_Audio_2023_1.json",
    ];
    const dropped = [
      "StreamingHistory_podcast_0.json",
      "StreamingHistory_audiobook_0.json",
      "Streaming_History_Video_2017-2018.json",
      "Read_Me_First.pdf",
      "Playlist1.json",
      "YourLibrary.json",
      "SearchQueries.json",
      "Spotify Account Data/",
    ];

    expect(kept.filter(isMusicHistoryFile)).toEqual(kept);
    expect(dropped.filter(isMusicHistoryFile)).toEqual([]);
  });
});
