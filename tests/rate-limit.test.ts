import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { createRateLimiter, pruneRateLimitCounters } from "@/lib/rate-limit";
import { resetDb } from "./helpers";

/**
 * Paylaşımlı istek sınırlayıcı. Sayaç veritabanında olduğu için sınır, uygulamanın kaç
 * kopyası çalışırsa çalışsın ortaktır — bellek içi sayaçta her kopya ayrı sayardı.
 */

before(async () => {
  await resetDb();
});

after(async () => {
  await db.$disconnect();
});

describe("İstek sınırlayıcı", () => {
  test("sınıra kadar izin verir, sonra reddeder", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, prefix: "t1:" });
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await limiter.hit("a", now)).allowed, true, `${i + 1}. istek geçmeli`);
    }
    const blocked = await limiter.hit("a", now);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec > 0, "ne kadar beklemesi gerektiği söylenir");
  });

  test("anahtarlar birbirini etkilemez", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, prefix: "t2:" });
    assert.equal((await limiter.hit("x")).allowed, true);
    assert.equal((await limiter.hit("x")).allowed, false);
    assert.equal((await limiter.hit("y")).allowed, true, "başka anahtar etkilenmez");
  });

  test("pencere dolunca sayaç sıfırlanır", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, prefix: "t3:" });
    const now = Date.now();
    await limiter.hit("a", now);
    await limiter.hit("a", now);
    assert.equal((await limiter.hit("a", now)).allowed, false);
    // Pencere sonrası aynı anahtar yeniden açılır.
    assert.equal((await limiter.hit("a", now + 61_000)).allowed, true);
  });

  test("iki ayrı sınırlayıcı örneği aynı sayacı paylaşır", async () => {
    // Uygulamanın iki kopyası gibi davranır: aynı önek, ayrı nesneler.
    const a = createRateLimiter({ windowMs: 60_000, max: 2, prefix: "t4:" });
    const b = createRateLimiter({ windowMs: 60_000, max: 2, prefix: "t4:" });
    const now = Date.now();
    assert.equal((await a.hit("ortak", now)).allowed, true);
    assert.equal((await b.hit("ortak", now)).allowed, true);
    assert.equal((await a.hit("ortak", now)).allowed, false, "sayaç kopyalar arasında ortaktır");
  });

  test("sıfırlama anahtarı serbest bırakır", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, prefix: "t5:" });
    await limiter.hit("a");
    assert.equal((await limiter.hit("a")).allowed, false);
    await limiter.reset("a");
    assert.equal((await limiter.hit("a")).allowed, true);
  });

  test("süresi dolmuş sayaçlar temizlenir", async () => {
    const limiter = createRateLimiter({ windowMs: 1_000, max: 5, prefix: "t6:" });
    const now = Date.now();
    await limiter.hit("eski", now);
    const removed = await pruneRateLimitCounters(new Date(now + 10_000));
    assert.ok(removed >= 1, "süresi dolan satır silinir");
    assert.equal(await db.rateLimitCounter.count({ where: { key: "t6:eski" } }), 0);
  });
});
