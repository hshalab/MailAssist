type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const dailyBuckets = new Map<string, { count: number; dayKey: string }>();

function now() {
  return Date.now();
}

function normalizeKey(key: string) {
  return key.trim().toLowerCase();
}

export function checkRateLimit(key: string, maxRequests: number, windowMs: number) {
  const id = normalizeKey(key);
  const current = now();
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

export function checkDailyLimit(key: string, maxPerDay: number) {
  const id = normalizeKey(key);
  const dayKey = new Date().toISOString().slice(0, 10);
  const current = dailyBuckets.get(id);

  if (!current || current.dayKey !== dayKey) {
    dailyBuckets.set(id, { count: 1, dayKey });
    return { allowed: true, remaining: maxPerDay - 1 };
  }

  if (current.count >= maxPerDay) {
    return { allowed: false, remaining: 0 };
  }

  current.count += 1;
  dailyBuckets.set(id, current);
  return { allowed: true, remaining: maxPerDay - current.count };
}

