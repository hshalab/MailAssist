
-- Find tickets with NULL user_email
WITH duplicates AS (
  SELECT t1.id, t1.thread_id, t1.created_at
  FROM tickets t1
  WHERE t1.user_email IS NULL
  AND EXISTS (
    SELECT 1 FROM tickets t2
    WHERE t2.thread_id = t1.thread_id
    AND t2.user_email IS NOT NULL
  )
)
-- Display them first (safest)
SELECT * FROM duplicates;

-- 3. Delete the duplicates (SAFE TO RUN)
-- This query ONLY deletes tickets that:
-- 1. Have a NULL user_email
-- 2. AND have a matching ticket (same thread_id) that HAS a user_email
-- It will NOT delete valid tickets if they look like duplicates but aren't (e.g. if no "good" copy exists).
DELETE FROM tickets
WHERE id IN (
  SELECT t1.id
  FROM tickets t1
  WHERE t1.user_email IS NULL
  AND EXISTS (
    SELECT 1 FROM tickets t2
    WHERE t2.thread_id = t1.thread_id
    AND t2.user_email IS NOT NULL
  )
);
*/
