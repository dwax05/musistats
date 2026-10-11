# MusiStats

A Spotify listening-history tracker: a React client, an Express API, and MongoDB. Users connect Spotify, optionally import their Spotify data export, and browse stats, sessions, a calendar, taste replay and comparison, and an AI assistant that answers questions about their own listening. See `README.md` for the product-level description.

## Layout

```text
client/            React 19 + Vite + Tailwind 4 single-page app
  src/auth/        session provider (authedPost) and the connect screen
  src/dashboard/   Dashboard.tsx (sidebar shell and every page), response models, demo fixture
  src/assistant/   chat panel
  src/calendar/    listening calendar
  src/settings/    assistant provider settings and history imports
  src/ui/          shared visual elements
  todo/            backend briefs, including the shared API contract
server/            Express 5 API, run with tsx (no build step)
  src/api.ts       composition root: each feature exports register*Routes(app, db)
  src/analytics/   time-range parsing shared by every stats-like route
  src/assistant/   AI providers, assistant tools, Sign in with ChatGPT
  src/auth/        Spotify OAuth, session tokens, requireAuth
  src/spotify/     Spotify client, background sync, encryptSecret/decryptSecret
  src/imports/     Spotify export upload jobs
  src/{dashboard,sessions,stats,calendar,taste}/   one route module per page
```

## Run and check

```bash
docker compose -f docker-compose.dev.yml up -d   # MongoDB only
npm run dev                                       # API on :3500, client on http://127.0.0.1:5173

cd client && npx tsc -b && npm run lint && npm test
cd server && npm run typecheck && npm test
```

- Open the app at `http://127.0.0.1:5173`, not `localhost`. The OAuth callbacks and their cookies are bound to `127.0.0.1`.
- `http://127.0.0.1:5173/?demo=1` renders the dashboard from `client/src/dashboard/fixture.ts` with no login or API (development builds only).
- Configuration lives in `server/.env`; `server/.env.example` lists every variable. Never commit or print real values.
- Two lint warnings are already present (`only-export-components` in `TasteComparison.tsx`, `set-state-in-effect` in `Dashboard.tsx`). Do not add new ones.

## Conventions

**API**
- Every route is `POST` with a JSON body, except `/api/health` and the OAuth redirects and callbacks.
- Success is HTTP 200 with `"error": ""`. Failures use a non-2xx status and a stable, non-empty error code, never database details or stack traces.
- The user ID always comes from the access token (`authPayload(req).userId`). Never accept one from the client, and scope every query to it.
- Time ranges are `short_term` (28 days), `medium_term` (6 months), `long_term` (12 months) or `custom` with `startDate`/`endDate` as `YYYY-MM-DD`. Use `rangeBounds` from `server/src/analytics/range.ts`. All day boundaries are UTC.
- Secrets at rest (Spotify refresh tokens, provider API keys, ChatGPT tokens) go through `encryptSecret`.

**Client**
- All authenticated requests go through `authedPost` from `useAuth()`. It returns the server's error code on failure, or `request_failed` / `offline`.
- Validate responses with the `is*Data` guards in the `model.ts` files before using them.
- New pages are added to `Dashboard.tsx`: the `Page` type, the sidebar navigation lists, the title/subtitle chain, and the content switch. Pages render inside the shared shell and header, and reuse `TimeRangeSelector` for period selection.
- Style with Tailwind using the theme tokens in `client/src/theme.css` (`bg-surface`, `text-muted`, `border-border-app`, `text-accent`, `text-error`), not raw colors.
- Existing components use dense, long JSX lines. Match the file you are editing.

**Tests**
- Vitest on both sides. Client tests run in Node without a DOM: they test pure functions or use `renderToStaticMarkup`, so there is no click-through testing.
- Server route tests call handlers directly with a fake `db` object; see `server/src/assistant/routes.test.ts`.
- Put date and aggregation logic in exported pure functions and test those.

## Data

MongoDB collections: `Users`, `RecentPlays` (one document per play: `userId`, `name`, `artists[]`, `albumName`, `durationMs`, `playedAt`, `trackId`), `TopSnapshots`, `StreamingHistoryImports`, `ArtistNameGenreCache`, and `Config`. Indexes are created at startup in `server/src/spotify/sync.ts` and `server/src/imports/jobs.ts`. Recent plays sync hourly.

## Assistant

- Providers: OpenAI, ChatGPT account, Claude, Gemini, Hugging Face, Ollama, LM Studio. They share one set of tool definitions and one `runTool` in `server/src/assistant/routes.ts`; a change to a tool affects every provider.
- The shared system prompt ends with a taste note (`tasteNote`): the listener's top artists of the last 6 months and their cached Last.fm genres, for tone only. It reads `ArtistNameGenreCache` and never waits on Last.fm.
- Tool schemas use required string fields with empty-string defaults so they stay valid for every provider's schema rules.
- `query_plays` lets the model write an aggregation. `scopedPipeline` fixes the collection, prepends the user's `$match`, appends a row limit, and rejects any stage outside its allowlist or any cross-collection, write, or JavaScript operator. Treat it as a security boundary: extend the allowlist deliberately and add a refusal test for anything new.
- Sign in with ChatGPT (`server/src/assistant/chatgpt.ts`) works only when MusiStats runs locally, because OpenAI's self-serve flow accepts only a `127.0.0.1` callback. On that route requests must stream, `max_output_tokens` is rejected, tools must be grouped in a namespace, and output arrives as `response.output_item.done` events.

## Shipping

- Work on a branch and open a pull request against `main`.
- Merging to `main` deploys to production automatically (`.github/workflows/deploy.yml`), so `main` must always be releasable.
