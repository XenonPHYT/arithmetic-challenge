# Arithmetic Challenge

Cloudflare Worker + D1 + KV backend, static frontend, Python difficulty regulator running in the browser via Pyodide.

## Deploy (GitHub -> Cloudflare)
1. Put this folder in a GitHub repo and connect it to Cloudflare Workers (Workers & Pages > Create > Import a repository). Build command: none. Deploy command: `npx wrangler deploy`.
2. First deploy auto-creates the D1 database (binding `DB`) and KV namespace (binding `SESSIONS`).
3. Open the D1 database in the Cloudflare dashboard > Console, paste `schema.sql`, run it once.
4. Worker > Settings > Variables and Secrets, add two **secrets**:
   - `AUTH_SECRET`: any long random string (40+ characters).
   - `PIN_KEY`: 32 random bytes as base64 (for example `openssl rand -base64 32`, or any base64 generator for 32 bytes).
5. In GitHub: Actions > **Fetch Pyodide** > Run workflow (default 0.27.2). It downloads the official `pyodide-core` release into `pyodide/` and commits it; Cloudflare redeploys automatically.
6. Open the site, create an account, play.

## Design notes
- **One game per player**: starting a game stores one KV marker (`active:<playerId>`); starting another replaces it. Logging in elsewhere signs the old device out. Unfinished progress lives in the original device's IndexedDB and can be finished there after logging back in.
- **Server authority**: the server signs the session (start time, difficulty, player) and measures elapsed time itself. At finish it re-validates every question (range, whole-number rules, no duplicates, trivial questions, difficulty band, operation mix) and recomputes every answer. Only perfect runs are written to D1 (unique per session, so replays cannot double count).
- **Difficulty**: `python/difficulty_regulator.py` and the checks in `worker/index.js` use the same score formula and bands (verified identical over all 25,622 valid candidates). Change both together.
- **Writes**: D1 only for accounts, failed-attempt counters and verified wins. KV: one write at game start (plus one only if a D1 save fails).
- Pyodide uses the core distribution (the regulator needs only the standard library).
