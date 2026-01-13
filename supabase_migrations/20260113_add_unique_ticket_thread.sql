-- Add unique constraint to tickets table to prevent duplicate tickets for the same thread
-- We include user_email in the constraint since different users (in personal mode) might have same thread IDs 
-- (though thread IDs are usually globally unique in Gmail, scoping by user is safer for this app's architecture)

BEGIN;

-- First, clean up any existing duplicates
-- Keep the one with the smallest ID (created first)
DELETE FROM tickets a USING tickets b
WHERE a.id > b.id
AND a.thread_id = b.thread_id
AND a.user_email = b.user_email;

-- Now add the unique index
CREATE UNIQUE INDEX IF NOT EXISTS tickets_thread_id_user_email_idx ON tickets (thread_id, user_email);

COMMIT;
