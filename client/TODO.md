# TODO

## Server: listening sessions endpoint

Add an authenticated `POST /api/sessions` endpoint for the Sessions page. Do not add all historical plays to the dashboard response.

- Parse Spotify track `duration_ms` and persist it on new `RecentPlays` records.
- Group a user's plays into a new session when the gap from the preceding track's end exceeds 45 minutes.
- Return `{ error: "", sessions }`, sorted by active listening minutes descending, then by most-recent start time.
- Each session must include `id`, `startedAt`, `endedAt`, `minutes`, `songs`, `artists`, `topArtist`, and chronological `tracks`.
- Set `minutes` to `null` when duration data is unavailable; existing records cannot be reliably backfilled from Spotify's recent-plays API.
- Bound the response to the most relevant sessions and test session boundaries, sort order, and missing-duration records.
