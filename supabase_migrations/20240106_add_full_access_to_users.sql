-- Add has_full_access column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_full_access BOOLEAN DEFAULT FALSE;
