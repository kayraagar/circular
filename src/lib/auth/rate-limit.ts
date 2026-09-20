/**
 * Basit bellek içi giriş denemesi sınırlayıcı (sabit pencere).
 * Tek süreçli dağıtım için yeterlidir; çok instance'lı ortamda Redis/DB tabanlı
 * bir sınırlayıcıyla değiştirilmelidir (bkz. docs/ROADMAP.md).
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, retryAfterSec: 0 };
  }
  return { allowed: bucket.count < MAX_ATTEMPTS, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
}

export function recordFailedLogin(key: string) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else bucket.count += 1;
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
}

export function clearLoginAttempts(key: string) {
  buckets.delete(key);
}
