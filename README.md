# MyMusic — AI Song Generator

A web app where anyone can turn an idea into a full song, powered by the [Suno API](https://docs.sunoapi.org).

- **Simple mode**: describe a song, pick a style, and get two full tracks with AI-written lyrics.
- **Custom mode**: your own title, lyrics (or AI-written lyrics), style, excluded styles, vocal gender, song length, and advanced controls (style adherence, weirdness, variety).
- Models: V6 (default), V6 Wild, V6 Mini. Instrumental toggle.
- Live progress, streaming previews (~20–40 s), then the final MP3 with cover art. Built-in player and MP3 download.
- Song history is saved in the browser. Shows your remaining credits.

## Tech stack

- **Frontend:** React + TypeScript + Vite (static files in `dist/`)
- **Backend:** one Netlify Function (`netlify/functions/api.mts`) that proxies Suno at `/api/*`. Your API key stays on the server.

| App route | Suno endpoint |
| --- | --- |
| `POST /api/generate` | `POST /api/v1/generate` |
| `GET /api/status?taskId=` | `GET /api/v1/generate/record-info` |
| `POST /api/lyrics` | `POST /api/v1/lyrics` |
| `GET /api/lyrics-status?taskId=` | `GET /api/v1/lyrics/record-info` |
| `GET /api/credits` | `GET /api/v1/generate/credit` |
| `POST /api/callback` | Receives Suno callbacks (the app checks status by polling instead) |

## Deploy to Netlify

1. In Netlify: **Add new site → Import an existing project →** choose this repo, branch `main`.
   The build settings come from `netlify.toml` (`npm run build`, publish `dist`).
2. **Site configuration → Environment variables**, add:
   - `SUNO_API_KEY` — your key from https://sunoapi.org/api-key (**required**)
   - `APP_PASSWORD` — *optional*. If you set it, visitors must enter this password before they can generate songs, so strangers can't spend your credits.
3. Deploy (or **Trigger deploy** again if you added the variables after the first build).

## Run locally

```bash
npm install
npx netlify-cli dev   # runs the site and the /api function together, reading a local .env
```

Copy `.env.example` to `.env` and fill in your key. Running plain `npm run dev` serves the UI only, with no API.

## Notes

- Each generation creates 2 variations and uses Suno credits.
- Suno keeps generated files for 14 days, so download the MP3s you want to keep.
