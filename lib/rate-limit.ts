import { supabase } from './supabase';

// Short-window buckets stay in-memory: per-minute limits are per-instance by design.
// A few extra requests across concurrent instances is acceptable.
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function normalizeKey(key: string) {
  return key.trim().toLowerCase();
}

export function checkRateLimit(key: string, maxRequests: number, windowMs: number) {
  const id = normalizeKey(key);
  const current = Date.now();
  const bucket = buckets.get(id);

  if (!bucket || current >= bucket.resetAt) {
    buckets.set(id, { count: 1, resetAt: current + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: current + windowMs };
  }

  if (bucket.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  buckets.set(id, bucket);
  return { allowed: true, remaining: maxRequests - bucket.count, resetAt: bucket.resetAt };
}

export function getRequestIdentity(headers: Headers, fallback = 'anonymous') {
  const forwardedFor = headers.get('x-forwarded-for') || '';
  const realIp = headers.get('x-real-ip') || '';
  const ip = forwardedFor.split(',')[0]?.trim() || realIp.trim() || fallback;
  return ip;
}

/**
 * Daily limits backed by Supabase so they persist across all serverless instances.
 * Requires the `rate_limits` table (see supabase_migrations/20260415_add_rate_limits_and_summary_cache.sql).
 *
 * Note: the SELECT → UPSERT is not atomic, so up to [concurrency] extra requests
 * may slip through under heavy parallel load. This is acceptable for cost-control purposes.
 */
export async function checkDailyLimit(
  key: string,
  maxPerDay: number
): Promise<{ allowed: boolean; remaining: number }> {
  const id = normalizeKey(key);
  const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    const { data } = await supabase
      .from('rate_limits')
      .select('count')
      .eq('key', id)
      .eq('day_key', dayKey)
      .single();

    const currentCount = (data?.count as number) ?? 0;

    if (currentCount >= maxPerDay) {
      return { allowed: false, remaining: 0 };
    }

    await supabase
      .from('rate_limits')
      .upsert(
        { key: id, day_key: dayKey, count: currentCount + 1, updated_at: new Date().toISOString() },
        { onConflict: 'key,day_key' }
      );

    return { allowed: true, remaining: maxPerDay - currentCount - 1 };
  } catch (err) {
    // Fail open: allow the request if the DB is unreachable so users aren't blocked by infra issues
    console.error('[rate-limit] DB error, allowing request:', err);
    return { allowed: true, remaining: maxPerDay };
  }
}
