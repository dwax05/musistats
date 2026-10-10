# `POST /api/sessions`: longest listening sessions

## Scope and dependencies

Implement the lazy-loaded Sessions tab endpoint against the contract in [00-shared-api-contract.md](00-shared-api-contract.md). The endpoint is read-only and must aggregate server-side; never send a user's entire play history to the browser for grouping.

## Purpose

Return a bounded list of an authenticated user's longest listening sessions for one requested range. The page expands each result, so every response includes that session's tracks in chronological order.

## Request

Use the shared range request body. No pagination is needed in the first release: return at most 100 longest sessions after sorting.

## Session construction

1. Query the user's `RecentPlays` within the requested range and sort ascending by `playedAt`.
2. Start a new session when the gap from the prior track's effective end to the next track's `playedAt` exceeds 45 minutes.
3. A track's effective end is `playedAt + durationMs`. If an older row lacks `durationMs`, use `playedAt` for the boundary and mark its session duration unavailable.
4. Filter first, then group. A session crossing a cutoff begins with its first in-range play; never pull pre-cutoff plays into the result.
5. Sort sessions by active listening minutes descending, then `startedAt` descending. Active minutes are the sum of known track durations, not elapsed wall-clock time.

## Successful response

```json
{
  "error": "",
  "sessions": [
    {
      "id": "stable-session-id",
      "startedAt": "2026-10-09T17:03:00.000Z",
      "endedAt": "2026-10-09T18:18:00.000Z",
      "minutes": 72,
      "songs": 18,
      "artists": 7,
      "topArtist": { "name": "Solstice FM", "imageUrl": "https://..." },
      "tracks": [
        {
          "id": "spotify-track-id",
          "name": "Slow Motion",
          "artists": ["Solstice FM"],
          "imageUrl": "https://...",
          "externalUrl": "https://open.spotify.com/track/...",
          "playedAt": "2026-10-09T17:03:00.000Z"
        }
      ]
    }
  ]
}
```

Field rules:

- `id` is deterministic for a user/session start but opaque to the client.
- `startedAt` is the first included play, ISO 8601 UTC.
- `endedAt` is the final included track's known end, otherwise its `playedAt`.
- `minutes` is rounded active listening minutes, or `null` when any included play has no duration.
- `songs` counts every play, including repeats.
- `artists` counts distinct credited artist IDs. For historical rows without IDs, use one normalized-name fallback consistently.
- `topArtist` ranks by play count, then listening duration, then alphabetical name; it is `null` only with no usable artist.
- `tracks` is non-empty, chronological, and contains only in-range plays from that session.

## Required tests

- Reject missing/invalid ranges and enforce user isolation.
- Verify all three cutoffs with fixed UTC timestamps.
- Verify a gap of exactly 45 minutes stays in a session; 45 minutes plus one millisecond creates a new one.
- Verify sort order, 100-item response limit, null durations, repeated plays, multi-artist tie-breaking, and tracks restricted to the requested range.
- Verify no response exposes encrypted tokens, raw database IDs, or unowned records.
