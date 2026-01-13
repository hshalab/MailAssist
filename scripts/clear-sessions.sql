-- Clear all sessions to force users to re-login
-- This fixes any stale session issues after session handling updates

-- Option 1: Delete all sessions (nuclear option - forces everyone to re-login)
DELETE FROM auth.sessions;

-- Option 2: Delete sessions older than 1 hour (gentler - only affects inactive users)
-- DELETE FROM auth.sessions WHERE updated_at < NOW() - INTERVAL '1 hour';

-- Option 3: Delete sessions for specific user (if you know the problematic user)
-- DELETE FROM auth.sessions WHERE user_id = 'USER_ID_HERE';
