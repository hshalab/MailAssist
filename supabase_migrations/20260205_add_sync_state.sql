-- Migration: Add sync_state table for incremental Gmail sync
-- Created: 2026-02-05
-- Purpose: Track last synced Gmail historyId per account to enable fast incremental sync

-- Create sync_state table
CREATE TABLE IF NOT EXISTS sync_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL UNIQUE,
    last_history_id TEXT,
    last_sync_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sync_state_user_email ON sync_state(user_email);

-- Enable RLS
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for cron jobs)
CREATE POLICY "Service role has full access to sync_state"
    ON sync_state
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_sync_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_state_updated_at
    BEFORE UPDATE ON sync_state
    FOR EACH ROW
    EXECUTE FUNCTION update_sync_state_updated_at();

-- Grant permissions
GRANT ALL ON sync_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_state TO authenticated;
