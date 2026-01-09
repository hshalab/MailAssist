-- Add has_full_access column to agent_invitations table
-- This allows storing whether an invited agent should have full access to all emails/workstreams

ALTER TABLE agent_invitations
ADD COLUMN IF NOT EXISTS has_full_access BOOLEAN DEFAULT false;

-- Add a comment for documentation
COMMENT ON COLUMN agent_invitations.has_full_access IS 'If true, the agent will have access to all emails and workstreams regardless of department assignments';

