# Backend work briefs

Each brief is designed to be handed to one owner without making them infer its API contract from the client. Read the shared contract before starting a dependent brief.

| Brief | Scope | Dependencies | Suggested handoff |
| --- | --- | --- | --- |
| [00-shared-api-contract.md](00-shared-api-contract.md) | Auth, range semantics, error envelope, and stored play metadata shared by Sessions and All Stats. | None | Establish first. |
| [01-listening-sessions.md](01-listening-sessions.md) | `POST /api/sessions` and its aggregation tests. | Shared API contract; `RecentPlays` index. | Can proceed alongside All Stats. |
| [02-all-stats.md](02-all-stats.md) | `POST /api/stats`, all graph definitions, and tests. | Shared API contract; enriched play fields. | Can proceed alongside Sessions. |
| [03-spotify-history-imports.md](03-spotify-history-imports.md) | Streaming-history upload jobs, parser, provenance, enrichment, and all import endpoints. | Existing auth; should coordinate data-model changes with Shared API contract. | Separate, larger backend project. |

The client is already wired to `POST /api/sessions` and `POST /api/stats`. The Spotify-import Settings page has not been implemented yet; its client must follow the import API in brief 03 exactly, including multipart upload and status polling.
