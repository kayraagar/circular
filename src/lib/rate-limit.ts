import "server-only";
import { db } from "./db";

/**
 * Paylaşımlı istek sınırlayıcı (sabit pencere).
 *
 * Sayaç veritabanındadır: sınır, uygulamanın kaç kopyası çalışırsa çalışsın ortaktır.
 * Artırma tek bir atomik `INSERT ... ON CONFLICT` ile yapılır, bu yüzden eşzamanlı istekler
 * sayacı bozamaz.
 *
 * Veritabanına ulaşılamazsa süreç içi bir sayaca düşülür: sınır o an yalnızca o kopya için
 * geçerli olur ama istekler tamamen açık kalmaz.
 */

type Result = { allowed: boolean; retryAfterSec: number };

export function createRateLimiter({ windowMs, max, prefix = "" }: { windowMs: number; max: number; prefix?: string }) {
  const fallback = new Map<string, { count: number; resetAt: number }>();

  function hitInMemory(key: string, now: number): Result {
    const bucket = fallback.get(key);
    if (!bucket || bucket.resetAt <= now) {
      fallback.set(key, { count: 1, resetAt: now + windowMs });
      if (fallback.size > 10_000) {
        for (const [k, b] of fallback) if (b.resetAt <= now) fallback.delete(k);
      }
      return { allowed: true, retryAfterSec: 0 };
    }
    bucket.count += 1;
    return { allowed: bucket.count <= max, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  return {
    /** İsteği sayar; pencere içinde sınır aşıldıysa allowed=false döner. */
    async hit(key: string, now = Date.now()): Promise<Result> {
      const full = `${prefix}${key}`;
      // Zaman damgaları saniye cinsinden gönderilip SQL'de UTC'ye çevrilir: ham sorguda
      // Date parametresi sunucunun yerel saatiyle yazılır, Prisma ise sütunu UTC okur.
      const atSec = now / 1000;
      const expiresSec = (now + windowMs) / 1000;
      try {
        // Süresi dolmuş pencere aynı ifadede sıfırlanır: ayrı okuma/yazma yarışı olmaz.
        const rows = await db.$queryRaw<{ count: number; expiresEpoch: number }[]>`
          INSERT INTO "RateLimitCounter" ("key", "count", "expiresAt")
          VALUES (${full}, 1, to_timestamp(${expiresSec}::double precision) AT TIME ZONE 'UTC')
          ON CONFLICT ("key") DO UPDATE SET
            "count" = CASE
              WHEN "RateLimitCounter"."expiresAt" <= to_timestamp(${atSec}::double precision) AT TIME ZONE 'UTC' THEN 1
              ELSE "RateLimitCounter"."count" + 1
            END,
            "expiresAt" = CASE
              WHEN "RateLimitCounter"."expiresAt" <= to_timestamp(${atSec}::double precision) AT TIME ZONE 'UTC'
                THEN to_timestamp(${expiresSec}::double precision) AT TIME ZONE 'UTC'
              ELSE "RateLimitCounter"."expiresAt"
            END
          RETURNING "count", EXTRACT(EPOCH FROM "expiresAt")::double precision AS "expiresEpoch"
        `;
        const row = rows[0];
        if (!row) return { allowed: true, retryAfterSec: 0 };
        return {
          allowed: row.count <= max,
          retryAfterSec: Math.max(0, Math.ceil(Number(row.expiresEpoch) - now / 1000)),
        };
      } catch (error) {
        console.error("[rate-limit] sayaç okunamadı, süreç içi sayaca düşüldü", error);
        return hitInMemory(full, now);
      }
    },

    async reset(key?: string) {
      fallback.clear();
      try {
        if (key) await db.rateLimitCounter.deleteMany({ where: { key: `${prefix}${key}` } });
        else if (prefix) await db.rateLimitCounter.deleteMany({ where: { key: { startsWith: prefix } } });
        else await db.rateLimitCounter.deleteMany();
      } catch {
        // Sıfırlama yalnızca test ve başarılı girişte çağrılır; hata akışı durdurmamalı.
      }
    },
  };
}

/** Süresi dolmuş sayaçları siler (kampanya işçisi turunda çağrılır). */
export async function pruneRateLimitCounters(now = new Date()): Promise<number> {
  const { count } = await db.rateLimitCounter.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}
