-- Migration: Repair sync_state schema in production
-- Created: 2026-05-02
-- Purpose: The original 20260205_add_sync_state.sql used CREATE TABLE IF NOT EXISTS, so when
--          a partial sync_state table already existed in production, the new columns/policies
--          were never applied. This migration is idempotent and safe to re-run.

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_history_id TEXT;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Make sure user_email is unique (required by upsert onConflict in lib/sync-state.ts)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sync_state_user_email_key'
    ) THEN
        ALTER TABLE sync_state ADD CONSTRAINT sync_state_user_email_key UNIQUE (user_email);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sync_state_user_email ON sync_state(user_email);

ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'sync_state' AND policyname = 'Service role has full access to sync_state'
    ) THEN
        CREATE POLICY "Service role has full access to sync_state"
            ON sync_state FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

GRANT ALL ON sync_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_state TO authenticated;

-- Verify the schema
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sync_state'
ORDER BY ordinal_position;
