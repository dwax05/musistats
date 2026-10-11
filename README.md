# MusiStats

A Spotify listening-history tracker built with React, Express, and MongoDB.

## Local setup

1. Create a Spotify developer app and add this redirect URI:

   `http://127.0.0.1:5173/api/auth/spotify/callback`

2. Copy `server/.env.example` to `server/.env`, add the Spotify credentials, and generate the token-encryption key with `openssl rand -hex 32`.

3. Start MongoDB and the app:

   ```bash
   docker compose -f docker-compose.dev.yml up -d
   npm run dev
   ```

Open `http://127.0.0.1:5173`. Spotify refresh tokens and optional assistant provider keys are encrypted in MongoDB. Recent plays sync hourly, top-item snapshots sync daily, and disconnecting deletes all imported account data. In Settings, each user can configure OpenAI, Claude, Google Gemini, Hugging Face, Ollama, or LM Studio; the assistant sends chat questions and requested listening-data summaries only to that selected provider. Ollama and LM Studio run without an API key, but their local API must run on the same machine as MusiStats. It cannot create playlists or modify Spotify.

The assistant can also run on a listener's ChatGPT plan through [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source), with no API key. Set `CHATGPT_REDIRECT_URI=http://127.0.0.1:5173/api/assistant/chatgpt/callback` in `server/.env`, then choose **ChatGPT account** in Settings and select **Continue with ChatGPT**. OpenAI's preview accepts only a `127.0.0.1` callback for open-source apps, so this works only when you open MusiStats on the machine that runs it; a remotely hosted deployment needs a client ID from OpenAI's interest form instead. ChatGPT tokens are encrypted in MongoDB like the other provider keys, and removing the provider or choosing another one signs out of ChatGPT.

Use `http://127.0.0.1:5173/?demo=1` to review the populated dashboard during local development without a Spotify login.

Taste Replay uses imported, timestamped plays to build duration-weighted genre mixes with a rolling window and weekly replay frames. Spotify exports contain artist names rather than stable artist IDs, and MusiStats does not search Spotify for artist genres: it keeps the genres Spotify returns with top artists and uses Last.fm artist tags for everything else; their community tag counts weight each artist's genre mix. Set `LASTFM_API_KEY` in `server/.env` to enable lookups. Weighted artist tags are cached in MongoDB and reused on later requests; older tag-only cache entries are refreshed with counts. Only artist names are sent to Last.fm, not listening history. The replay API is the authenticated `POST /api/taste-replay` endpoint. Request `short_term`, `medium_term`, or `long_term` with `{ "range": "long_term" }` to choose the 4-week, 6-month, or all-time history. Very long histories are grouped into multi-day intervals so the full export remains replayable. If no imported plays exist, it uses daily Spotify top-artist snapshots. Genre shares are estimates based on artist-level community tags, not track-level genre data or exact genre play counts.

For production, set `NODE_ENV=production`, use the Docker MongoDB hostname, and register the production callback URL in both Spotify and `SPOTIFY_REDIRECT_URI`.

## Structure

```text
client/src/
  auth/       login and session UI
  dashboard/  dashboard and taste replay UI, response models, demo data, and tests
  ui/         shared visual elements
server/src/
  assistant/  listening assistant providers, including Sign in with ChatGPT
  auth/       OAuth routes and session tokens
  dashboard/  dashboard routes
  spotify/    Spotify client and background sync
  taste/      genre snapshot aggregation and replay API
```
