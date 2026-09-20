/**
 * Bellek içi sabit pencereli istek sınırlayıcı (herkese açık formlar için).
 * Tek süreçli dağıtım için yeterlidir; çok instance'lı ortamda paylaşımlı bir depo
 * (Redis/DB) gerekir — bkz. docs/ROADMAP.md › Platform ve operasyon.
 */
export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    /** İsteği sayar; pencere içinde sınır aşıldıysa allowed=false döner. */
    hit(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        if (buckets.size > 10_000) {
          for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
        }
        return { allowed: true, retryAfterSec: 0 };
      }
      bucket.count += 1;
      return { allowed: bucket.count <= max, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
    },
    reset(key?: string) {
      if (key) buckets.delete(key);
      else buckets.clear();
    },
  };
}
