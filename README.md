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

Open `http://127.0.0.1:5173`. Spotify refresh tokens are encrypted in MongoDB. Recent plays sync hourly, top-item snapshots sync daily, and disconnecting deletes all imported account data.

Use `http://127.0.0.1:5173/?demo=1` to review the populated dashboard during local development without a Spotify login.

For production, set `NODE_ENV=production`, use the Docker MongoDB hostname, and register the production callback URL in both Spotify and `SPOTIFY_REDIRECT_URI`.
