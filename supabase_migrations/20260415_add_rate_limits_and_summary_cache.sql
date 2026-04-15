-- Rate limits table: persists daily API usage counts across serverless instances
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT NOT NULL,
  day_key  TEXT NOT NULL,  -- YYYY-MM-DD
  count    INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (key, day_key)
);

-- Clean up old days automatically (optional: run via cron or pg_cron)
-- DELETE FROM rate_limits WHERE day_key < (CURRENT_DATE - INTERVAL '7 days')::TEXT;

-- AI summary cache: persists generated summaries across serverless instances
CREATE TABLE IF NOT EXISTS ai_summary_cache (
  content_hash TEXT PRIMARY KEY,
  summary      TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index to efficiently find and clean up expired entries
CREATE INDEX IF NOT EXISTS idx_ai_summary_cache_expires_at ON ai_summary_cache (expires_at);
