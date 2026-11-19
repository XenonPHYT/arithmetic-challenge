-- Arithmetic Challenge - D1 schema (run once in the D1 console, or: wrangler d1 execute DB --remote --file=schema.sql)
-- D1 holds only permanent data: accounts, security records, verified perfect wins.

CREATE TABLE IF NOT EXISTS players (
  player_id        TEXT PRIMARY KEY,
  username         TEXT NOT NULL,
  username_lower   TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,
  display_lower    TEXT NOT NULL UNIQUE,
  pw_hash          TEXT NOT NULL,
  pw_salt          TEXT NOT NULL,
  pw_iterations    INTEGER NOT NULL,
  pin_cipher       TEXT NOT NULL,
  pin_iv           TEXT NOT NULL,
  pin_version      INTEGER NOT NULL DEFAULT 1,
  login_token_hash TEXT,
  login_expires_at INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
  session_id   TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(player_id),
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('easy','normal','hard')),
  elapsed_ms   INTEGER NOT NULL CHECK (elapsed_ms > 0),
  completed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comp_fastest ON completions (difficulty, elapsed_ms);
CREATE INDEX IF NOT EXISTS idx_comp_player  ON completions (player_id, difficulty);

-- Failed-attempt counters only (login, recovery, PIN reveal, signup). Successful normal play never writes here.
CREATE TABLE IF NOT EXISTS rate_limits (
  rl_key       TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
