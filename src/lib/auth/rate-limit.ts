import "server-only";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Giriş denemesi sınırlayıcı (IP + e-posta başına). Sayaç veritabanındadır, bu yüzden
 * sınır uygulamanın tüm kopyaları için ortaktır.
 */
const limiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8, prefix: "login:" });

/**
 * Denemeyi sayar. Başarılı girişte `clearLoginAttempts` çağrılır, bu yüzden sayaç yalnızca
 * başarısız denemelerle dolar.
 */
export async function checkLoginRateLimit(key: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  return limiter.hit(key);
}

export async function clearLoginAttempts(key: string) {
  await limiter.reset(key);
}

export async function resetLoginRateLimit() {
  await limiter.reset();
}
