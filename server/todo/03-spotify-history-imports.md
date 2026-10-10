# Spotify streaming-history import jobs

## Scope

This is the backend contract for a future Settings-page import flow. It imports Spotify privacy-export files; it does not recreate an archive through the Spotify Web API. Normal Streaming History is roughly the preceding year, Extended Streaming History can cover an account lifetime, and both can be split across JSON files or overlap with live sync.

The import is an asynchronous authenticated job. Do not parse a large archive or enrich catalog metadata in the browser, and never keep the upload request open for the whole job.

## Shared rules

### Authentication and ownership

- Require the existing auth middleware and resolve `userId` exclusively from its access token.
- Successful JSON responses contain `"error": ""`; stable, non-empty error codes represent expected failure states. Never expose raw parser, database, token, or filesystem details.
- `importId` is opaque and unguessable. Query it with `{ id, userId }`, returning `404 { "error": "import_not_found" }` when it is not owned by the caller.
- Permit one active import (`queued`, `validating`, `importing`, or `enriching`) per user. A second upload returns `409 { "error": "import_in_progress" }`.
- Rate-limit upload creation and status polling per user. Include `pollAfterMs`; clients poll every 1–3 seconds while a job is active.

### File acceptance and parser behavior

- Accept one or more JSON files or one Spotify-export ZIP. Detect format from parsed fields, never filename alone.
- A ZIP may contain JSON and Spotify read-me files only. Reject traversal, nested/encrypted ZIPs, excessive entry counts, excessive compression ratios, and aggregate extracted data above configured limits.
- Stream archive entries and JSON arrays; never buffer an entire extended-history file in memory.
- Limits for file bytes, aggregate bytes, entries, JSON rows, and runtime are server configuration. Return `413 { "error": "upload_too_large" }` or `422 { "error": "export_too_large" }` before durable play writes.
- A legacy/normal record has `endTime`, `artistName`, `trackName`, and `msPlayed`. An extended record has `ts`, `ms_played`, and Spotify `master_metadata_*` fields; `spotify_track_uri` is optional but preferred. Store the parser version on the import.
- Valid JSON with no supported streaming rows fails as `422 { "error": "unsupported_export" }`, with only a safe user-facing message.

### Privacy and allowed data

Extended history can contain username, IP address, country, user agent, platform, playback reasons, private-session flags, offline-use data, and episode metadata. The parser may retain only:

```ts
endedAt: string // UTC ISO timestamp
durationMs: number
trackName: string
artistName: string
albumName: string | null
spotifyTrackUri: string | null
```

- Do not persist, return, log, index, or use any other raw export field.
- Raw uploads may exist only in encrypted short-lived staging. Delete them after parsing, failure, cancellation, or a configured retention deadline. The application database holds normalized plays only.
- The first release imports music tracks only. Skip podcasts, videos, audiobooks, local files, malformed records, and rows without a usable timestamp; return aggregated skipped counts by reason.

### Canonical play identity and source provenance

A `RecentPlay` is one canonical play regardless of which export or sync supplied it. Use this fingerprint and a unique `{ userId: 1, fingerprint: 1 }` index:

```ts
fingerprint = sha256(
  userId + "\n" + endedAtUtcMilliseconds + "\n" +
  (spotifyTrackUri ?? normalizedTrackName + "\n" + normalizedArtistName) + "\n" + durationMs,
)
```

- Normalize only by lowercasing, Unicode normalization, trimming, and collapsing whitespace. Do not fuzzy-match titles or search Spotify for name-only rows.
- Upsert bounded batches. Existing fingerprints are duplicates even when the newly submitted row has different display metadata; never overwrite richer data with a name-only row.
- Track provenance with `sourceImportIds: string[]` and `hasLiveSyncSource: boolean`. Import upserts add an import ID; live sync sets `hasLiveSyncSource`.
- Cancellation/deletion removes only that import ID. Delete a canonical play only when it has no `sourceImportIds` and `hasLiveSyncSource` is false.

### Job model

```ts
type ImportStatus = "queued" | "validating" | "importing" | "enriching" | "completed" | "failed" | "cancelling" | "cancelled";

type StreamingHistoryImport = {
  id: string;
  userId: string;
  status: ImportStatus;
  sourceKinds: ("streaming_history" | "extended_streaming_history")[];
  parserVersions: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dateRange: { start: string; end: string } | null;
  counts: {
    files: number;
    rowsRead: number;
    tracksImported: number;
    duplicates: number;
    skipped: number;
    enriched: number;
  };
  skippedByReason: Record<string, number>;
  failureCode: string | null;
};
```

Workers check for cancellation between files/batches. Core-import failures and cancellation remove that job's provenance before terminal status, then invalidate derived sessions/stats. A metadata-only enrichment failure can complete with a warning because the play history is already safely imported.

## `POST /api/imports/spotify-history`

### Request

Use `multipart/form-data`, bearer auth, and repeated `files` fields. The browser must not manually set `Content-Type`; it supplies the multipart boundary.

```text
files=@StreamingHistory0.json
files=@StreamingHistory1.json
```

or:

```text
files=@my_spotify_data.zip
```

- Require 1–N files. Reject a ZIP mixed with loose JSON as `400 { "error": "mixed_archive_upload" }`.
- Do not accept a user-declared source type; server detection is authoritative.
- Validate contents and file signatures, treating MIME type as a hint.
- Either stage one complete job covering every file or fail before a job becomes visible; never create a partial import for an invalid upload.

### Successful response

Return HTTP 202 after staging/queueing:

```json
{
  "error": "",
  "import": {
    "id": "imp_opaque_id",
    "status": "queued",
    "sourceKinds": [],
    "createdAt": "2026-10-10T19:12:00.000Z",
    "pollAfterMs": 1500
  }
}
```

`sourceKinds` may be empty until archive expansion completes.

### Failure responses

| Status | Error | Meaning |
| --- | --- | --- |
| 400 | `no_files` | No `files` fields supplied. |
| 400 | `mixed_archive_upload` | ZIP and loose JSON submitted together. |
| 401 | `unauthorized` | Missing or invalid session. |
| 409 | `import_in_progress` | User has an active import. |
| 413 | `upload_too_large` | Request exceeds upload limits. |
| 415 | `unsupported_file_type` | Not JSON/ZIP. |
| 422 | `unsupported_export` | No supported streaming-history schema. |
| 422 | `export_too_large` | Extracted archive or rows exceed limits. |
| 503 | `imports_unavailable` | Staging or queue unavailable. |

## `POST /api/imports/spotify-history/status`

### Request

```json
{ "importId": "imp_opaque_id" }
```

`importId` is required; reject absent/malformed values with `400 { "error": "invalid_import_id" }`.

### Successful response

Return HTTP 200:

```json
{
  "error": "",
  "import": {
    "id": "imp_opaque_id",
    "status": "importing",
    "sourceKinds": ["extended_streaming_history"],
    "createdAt": "2026-10-10T19:12:00.000Z",
    "startedAt": "2026-10-10T19:12:02.000Z",
    "completedAt": null,
    "dateRange": { "start": "2017-06-04T20:14:00.000Z", "end": "2026-10-09T23:58:00.000Z" },
    "counts": { "files": 7, "rowsRead": 103842, "tracksImported": 72891, "duplicates": 30112, "skipped": 839, "enriched": 0 },
    "skippedByReason": { "non_music": 520, "missing_timestamp": 3, "invalid_row": 316 },
    "failureCode": null,
    "pollAfterMs": 1500
  }
}
```

Never return raw filenames/source fields, Spotify usernames, IPs, countries, user agents, parser messages, or per-play data. Terminal states include final counts; failures provide a stable `failureCode` such as `parse_failed` or `enrichment_unavailable`.

| Status | Error |
| --- | --- |
| 400 | `invalid_import_id` |
| 401 | `unauthorized` |
| 404 | `import_not_found` |
| 429 | `rate_limited` |

## `POST /api/imports/spotify-history/list`

### Request

```json
{ "cursor": null, "limit": 20 }
```

- Omit or set `cursor` to `null` for the first page, then use the opaque `nextCursor` from the preceding response.
- `limit` defaults to 20 and caps at 50; invalid cursor/limit is `400 { "error": "invalid_pagination" }`.
- Order newest `createdAt` first with stable opaque-ID tie-breaking.

### Successful response

Return HTTP 200 with the same public import summary as Status for each item—never raw uploads, filenames, source identifiers, or detailed errors:

```json
{
  "error": "",
  "imports": [{
    "id": "imp_opaque_id",
    "status": "completed",
    "sourceKinds": ["streaming_history", "extended_streaming_history"],
    "createdAt": "2026-10-10T19:12:00.000Z",
    "startedAt": "2026-10-10T19:12:02.000Z",
    "completedAt": "2026-10-10T19:15:31.000Z",
    "dateRange": { "start": "2017-06-04T20:14:00.000Z", "end": "2026-10-09T23:58:00.000Z" },
    "counts": { "files": 7, "rowsRead": 103842, "tracksImported": 72891, "duplicates": 30112, "skipped": 839, "enriched": 72891 },
    "skippedByReason": { "non_music": 520, "missing_timestamp": 3, "invalid_row": 316 },
    "failureCode": null
  }],
  "nextCursor": null
}
```

| Status | Error |
| --- | --- |
| 400 | `invalid_pagination` |
| 401 | `unauthorized` |
| 429 | `rate_limited` |

## `POST /api/imports/spotify-history/cancel`

### Request

```json
{ "importId": "imp_opaque_id" }
```

### Behavior and response

- `queued`, `validating`, `importing`, and `enriching` become `cancelling`. Workers then stop at safe boundaries, remove staging, remove this job's provenance, prune orphaned plays, invalidate derived data, and become `cancelled`.
- Cancellation is idempotent: return current state if already `cancelling`/`cancelled`.
- A completed job must use Delete instead.

Return HTTP 202 during cleanup:

```json
{ "error": "", "import": { "id": "imp_opaque_id", "status": "cancelling", "pollAfterMs": 1000 } }
```

| Status | Error |
| --- | --- |
| 400 | `invalid_import_id` |
| 401 | `unauthorized` |
| 404 | `import_not_found` |
| 409 | `import_not_cancellable` |
| 503 | `imports_unavailable` |

## `POST /api/imports/spotify-history/delete`

### Request

```json
{ "importId": "imp_opaque_id" }
```

### Behavior and response

- Reject active imports; users cancel them first.
- Remove the import ID from affected `RecentPlay.sourceImportIds` in batches; retain rows with another import or live-sync provenance.
- Delete staging residue and the import record only after provenance cleanup succeeds. Invalidate/rebuild dashboard, session, and stats aggregates.
- This is idempotent. A successful retry returns `deleted: true`; retain only a short-lived `{ userId, importId }` tombstone, with no source data, to support it.

```json
{ "error": "", "deleted": true }
```

| Status | Error |
| --- | --- |
| 400 | `invalid_import_id` |
| 401 | `unauthorized` |
| 404 | `import_not_found` |
| 409 | `import_active` |
| 503 | `imports_unavailable` |

## Enrichment, invalidation, and tests

- Commit normalized plays before enrichment. URI-backed rows get bounded, cached, rate-limit-aware Spotify metadata enrichment in batches; populate the fields required by [Shared API contract](00-shared-api-contract.md). Never fuzzy-search name-only legacy rows.
- Every completed, cancelled, or failed job invalidates derived dashboard/session/stats caches. The next read derives from canonical data, excluding cancelled/deleted import-only plays.

Required server tests:

- Auth/user isolation for every endpoint and import lookup.
- Loose JSON, ZIP expansion, mixed uploads, invalid JSON/schema, traversal/nested/encrypted ZIPs, compression bombs, every configured limit, and parsing data larger than process memory.
- Normal and extended fixtures, multi-file/mixed source kinds, date range detection, music-only filtering, and every skipped reason.
- Proof that sensitive extended-only fields are never persisted, returned, logged, or indexed.
- Fingerprint normalization, within-file and cross-source duplication, repeat upload, and live-sync overlap.
- Provenance rollback: cancellation/deletion retains rows owned by another import/live sync and prunes import-only rows; retries are idempotent.
- Stable terminal summaries without raw filenames/parser errors; batched/rate-limited enrichment that cannot block safe core import.
- Dashboard, Sessions, and all seven Stats graphs reflect completed imports and exclude deleted/cancelled import-only data.
