import { supabase } from './supabase';

export function isAIAutomationEnabled(): boolean {
  // Global kill-switch via env var. Set AI_AUTOMATION_ENABLED=false to disable everything.
  return process.env.AI_AUTOMATION_ENABLED !== 'false';
}

export function allowOpenAIEmbeddingFallback(): boolean {
  return process.env.ALLOW_OPENAI_EMBEDDING_FALLBACK === 'true';
}

interface AccountAISettings {
  enable_auto_classify: boolean;
  enable_ai_drafts: boolean;
  enable_ai_summarize: boolean;
}

const DEFAULTS: AccountAISettings = {
  enable_auto_classify: true,
  enable_ai_drafts: true,
  enable_ai_summarize: true,
};

/**
 * Fetch per-account AI feature flags from the database.
 * Falls back to all-enabled if the row doesn't exist or DB is unreachable.
 */
export async function getAccountAISettings(
  userEmail?: string | null,
  businessId?: string | null
): Promise<AccountAISettings> {
  if (!userEmail && !businessId) return { ...DEFAULTS };

  try {
    let query = supabase
      .from('user_settings')
      .select('enable_auto_classify, enable_ai_drafts, enable_ai_summarize');

    if (businessId) {
      query = query.eq('business_id', businessId);
    } else {
      query = query.eq('user_email', userEmail);
    }

    const { data } = await query.maybeSingle();
    if (!data) return { ...DEFAULTS };

    return {
      enable_auto_classify: data.enable_auto_classify ?? DEFAULTS.enable_auto_classify,
      enable_ai_drafts:     data.enable_ai_drafts     ?? DEFAULTS.enable_ai_drafts,
      enable_ai_summarize:  data.enable_ai_summarize  ?? DEFAULTS.enable_ai_summarize,
    };
  } catch {
    // Fail open so a DB outage never breaks the app
    return { ...DEFAULTS };
  }
}
