import { createHash } from 'crypto';
import { supabase } from './supabase';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function makeKey(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Retrieve a cached summary from Supabase.
 * Returns null on cache miss, expiry, or DB error.
 * Requires the `ai_summary_cache` table (see supabase_migrations/20260415_add_rate_limits_and_summary_cache.sql).
 */
export async function getCachedSummary(content: string): Promise<string | null> {
  const hash = makeKey(content);

  try {
    const { data } = await supabase
      .from('ai_summary_cache')
      .select('summary, expires_at')
      .eq('content_hash', hash)
      .single();

    if (!data) return null;

    if (new Date(data.expires_at as string) <= new Date()) {
      // Fire-and-forget cleanup of expired entry
      supabase.from('ai_summary_cache').delete().eq('content_hash', hash);
      return null;
    }

    return data.summary as string;
  } catch {
    return null;
  }
}

/**
 * Store a summary in Supabase.
 * Silently swallows DB errors so a cache write failure never breaks the response.
 */
export async function setCachedSummary(
  content: string,
  summary: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<void> {
  const hash = makeKey(content);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  try {
    await supabase
      .from('ai_summary_cache')
      .upsert(
        { content_hash: hash, summary, expires_at: expiresAt },
        { onConflict: 'content_hash' }
      );
  } catch (err) {
    console.error('[summary-cache] DB write error:', err);
  }
}
