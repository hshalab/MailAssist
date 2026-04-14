import { createHash } from 'crypto';

type CacheItem = {
  summary: string;
  expiresAt: number;
};

const summaryCache = new Map<string, CacheItem>();
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function makeKey(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

export function getCachedSummary(content: string): string | null {
  const key = makeKey(content);
  const entry = summaryCache.get(key);
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt) {
    summaryCache.delete(key);
    return null;
  }

  return entry.summary;
}

export function setCachedSummary(content: string, summary: string, ttlMs = DEFAULT_TTL_MS) {
  const key = makeKey(content);
  summaryCache.set(key, {
    summary,
    expiresAt: Date.now() + ttlMs,
  });
}

