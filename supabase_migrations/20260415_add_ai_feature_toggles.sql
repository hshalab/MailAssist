-- AI feature toggle columns for per-account control (admin-managed)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS enable_auto_classify  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_ai_drafts      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_ai_summarize   BOOLEAN NOT NULL DEFAULT true;
