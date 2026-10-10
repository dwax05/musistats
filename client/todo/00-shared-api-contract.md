# Shared API contract for Sessions and All Stats

## Scope

This brief defines the behavior shared by `POST /api/sessions` and `POST /api/stats`. It must be implemented before or alongside [Sessions](01-listening-sessions.md) and [All Stats](02-all-stats.md).

Neither endpoint belongs in `POST /api/dashboard`. The dashboard response must remain small; these views load only after a user opens their sidebar tab.

## Authentication and ownership

- Require a valid access token using the existing auth middleware.
- Resolve the user ID from the token and query only that user's records. Never accept a `userId` from the client.
- Return `401 { "error": "unauthorized" }` for an absent, expired, or invalid token.
- Never return another user's plays, sessions, artist data, or metadata.

## Range request contract

Both endpoints accept this JSON body:

```json
{ "range": "short_term" }
```

`range` is required and must be one of:

| Value | UI label | Inclusion rule |
| --- | --- | --- |
| `short_term` | 4 weeks | Plays beginning within the preceding 28 × 24 hours. |
| `medium_term` | 6 months | Plays beginning within the preceding six UTC calendar months. |
| `long_term` | All time | Every retained play for the authenticated user. |

Return `400 { "error": "invalid_range" }` for every other value. Calculate the cutoff once at request start, in UTC, so a response is internally consistent.

## Response and failure contract

Successful responses must have HTTP 200 and `"error": ""`. Expected client-visible failures use stable, non-empty error codes; never leak database details, Spotify tokens, or stack traces.

```json
{ "error": "" }
```

| Status | Error |
| --- | --- |
| 400 | `invalid_range` |
| 401 | `unauthorized` |
| 503 | `stats_unavailable` |

The existing client treats non-2xx responses as generic request failures. Retain detailed, privacy-safe diagnostics in server logs only.

## Stored play data and indexes

`RecentPlays` needs these fields for accurate sessions and graphs:

```ts
durationMs: number
artistIds: string[]
albumArtistIds: string[]
albumReleaseDate: string | null // Spotify release_date, preserved as supplied
albumReleaseDatePrecision: "year" | "month" | "day" | null
```

- Parse these from Spotify track/album data during sync; do not make per-track Spotify calls while serving an aggregate endpoint.
- Preserve `null` for missing optional metadata. Existing historical rows cannot be fully backfilled from the recently-played endpoint, so callers must tolerate missing metadata.
- Maintain or verify an index on `{ userId: 1, playedAt: 1 }` for range reads. Confirm the query plan before relying on an existing descending variant.
