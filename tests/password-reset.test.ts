import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  completePasswordReset,
  createResetLinkForMember,
  readReset,
  requestPasswordReset,
  resetPasswordRateLimits,
  resetPath,
} from "@/modules/auth/password-reset";
import { makeTenant, resetDb } from "./helpers";

/**
 * Şifre sıfırlama. Bağlantı tek kullanımlıktır, süresi dolar, ham kod saklanmaz ve
 * kullanıldığında kişinin tüm oturumları kapanır.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

/** Bağlantıdaki token'ı üretilen URL'den çıkarır (servis ham kodu saklamaz). */
function tokenOf(url: string) {
  return url.slice(url.lastIndexOf("/") + 1);
}

before(async () => {
  await resetDb();
  A = await makeTenant("pa");
  B = await makeTenant("pb");
  await db.user.update({ where: { id: A.crm.userId }, data: { passwordHash: await hashPassword("eski-sifre-123") } });
});

beforeEach(() => {
  resetPasswordRateLimits();
});

after(async () => {
  await db.$disconnect();
});

describe("Sıfırlama bağlantısı üretme", () => {
  test("yalnızca işletme sahibi üretir ve yalnızca kendi ekibi için", async () => {
    await assert.rejects(createResetLinkForMember(A.crm, A.crm.membershipId), ForbiddenError);
    await assert.rejects(createResetLinkForMember(A.pr, A.crm.membershipId), ForbiddenError);
    // Başka işletmenin üyesi bu işletmede bulunamaz.
    await assert.rejects(createResetLinkForMember(A.owner, B.crm.membershipId), NotFoundError);
  });

  test("erişimi kapalı hesap için bağlantı üretilmez", async () => {
    await db.user.update({ where: { id: A.waiter.userId }, data: { isActive: false } });
    await assert.rejects(createResetLinkForMember(A.owner, A.waiter.membershipId), ConflictError);
    await db.user.update({ where: { id: A.waiter.userId }, data: { isActive: true } });
  });

  test("ham kod veritabanında saklanmaz ve işlem aktivite geçmişine yazılır", async () => {
    const link = await createResetLinkForMember(A.owner, A.crm.membershipId);
    const token = tokenOf(link.url);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(link.url.endsWith(resetPath(token)));

    const rows = await db.passwordReset.findMany({ where: { userId: A.crm.userId, usedAt: null } });
    assert.equal(rows.length, 1);
    assert.ok(!rows.some((r) => r.tokenHash.includes(token)), "ham kod saklanmaz");
    assert.match(rows[0].tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(rows[0].origin, "OWNER");
    assert.equal(rows[0].createdByUserId, A.owner.userId);

    const log = await db.activityLog.findFirst({ where: { action: "team.reset_link_created" }, orderBy: { createdAt: "desc" } });
    assert.ok(log, "bağlantı üretimi denetim kaydına düşer");
  });

  test("yeni bağlantı üretilince eskisi geçersiz olur", async () => {
    const first = await createResetLinkForMember(A.owner, A.crm.membershipId);
    const second = await createResetLinkForMember(A.owner, A.crm.membershipId);
    await assert.rejects(readReset(tokenOf(first.url)), ConflictError);
    const view = await readReset(tokenOf(second.url));
    assert.equal(view.email, "crm_manager@pa.test");
  });
});

describe("Bağlantıyı kullanma", () => {
  test("uydurma kod kabul edilmez", async () => {
    await assert.rejects(readReset("kisa"), NotFoundError);
    await assert.rejects(readReset("A".repeat(43)), NotFoundError);
  });

  test("süresi dolan bağlantı reddedilir", async () => {
    const link = await createResetLinkForMember(A.owner, A.crm.membershipId);
    const later = new Date(Date.now() + 61 * 60_000);
    await assert.rejects(readReset(tokenOf(link.url), later), ConflictError);
  });

  test("şifre kurallara uymazsa bağlantı tüketilmez", async () => {
    const link = await createResetLinkForMember(A.owner, A.crm.membershipId);
    const token = tokenOf(link.url);
    await assert.rejects(completePasswordReset(token, { password: "kisa", passwordRepeat: "kisa" }), ValidationError);
    await assert.rejects(
      completePasswordReset(token, { password: "yeterince-uzun-sifre", passwordRepeat: "baska-bir-sey-tamam" }),
      ValidationError,
    );
    await readReset(token); // hâlâ geçerli
  });

  test("şifre değişir, bağlantı tükenir ve tüm oturumlar kapanır", async () => {
    await db.session.createMany({
      data: [
        { tokenHash: "oturum-a", userId: A.crm.userId, expiresAt: new Date(Date.now() + 864e5) },
        { tokenHash: "oturum-b", userId: A.crm.userId, expiresAt: new Date(Date.now() + 864e5) },
        { tokenHash: "baskasinin-oturumu", userId: A.owner.userId, expiresAt: new Date(Date.now() + 864e5) },
      ],
    });
    const link = await createResetLinkForMember(A.owner, A.crm.membershipId);
    const token = tokenOf(link.url);

    const result = await completePasswordReset(token, { password: "yepyeni-sifre-2026", passwordRepeat: "yepyeni-sifre-2026" });
    assert.equal(result.email, "crm_manager@pa.test");

    const user = await db.user.findUniqueOrThrow({ where: { id: A.crm.userId } });
    assert.ok(await verifyPassword("yepyeni-sifre-2026", user.passwordHash), "yeni şifre geçerli");
    assert.ok(!(await verifyPassword("eski-sifre-123", user.passwordHash)), "eski şifre artık çalışmaz");

    assert.equal(await db.session.count({ where: { userId: A.crm.userId } }), 0, "kişinin oturumları kapanır");
    assert.equal(await db.session.count({ where: { userId: A.owner.userId } }), 1, "başkasının oturumu etkilenmez");

    // Tek kullanımlık: aynı bağlantı bir daha çalışmaz.
    await assert.rejects(
      completePasswordReset(token, { password: "bir-daha-deneme-01", passwordRepeat: "bir-daha-deneme-01" }),
      ConflictError,
    );

    const log = await db.activityLog.findFirst({ where: { action: "team.password_reset" }, orderBy: { createdAt: "desc" } });
    assert.ok(log, "şifre yenileme denetim kaydına düşer");
  });
});

describe("Kişinin kendi talebi", () => {
  test("bilinmeyen adres hata vermez ve kayıt oluşturmaz", async () => {
    const before = await db.passwordReset.count();
    const result = await requestPasswordReset({ email: "kimse@yok.test" }, "1.2.3.4");
    assert.equal(result.emailConfigured, false, "testlerde e-posta servisi kapalı");
    assert.equal(await db.passwordReset.count(), before, "hesap yoksa kayıt açılmaz");
  });

  test("e-posta servisi kapalıyken kayıtlı adres için de bağlantı üretilmez", async () => {
    // Bağlantı iletilemeyeceği için üretmek anlamsız; kullanıcıya sahibinden istemesi söylenir.
    const before = await db.passwordReset.count();
    const result = await requestPasswordReset({ email: "crm_manager@pa.test" }, "1.2.3.5");
    assert.equal(result.emailConfigured, false);
    assert.equal(await db.passwordReset.count(), before);
  });

  test("geçersiz adres doğrulama hatası verir", async () => {
    await assert.rejects(requestPasswordReset({ email: "gecersiz" }, "1.2.3.6"), ValidationError);
  });

  test("aynı adresten çok sayıda talep sınırlanır", async () => {
    for (let i = 0; i < 5; i += 1) await requestPasswordReset({ email: "crm_manager@pa.test" }, "9.9.9.9");
    await assert.rejects(requestPasswordReset({ email: "crm_manager@pa.test" }, "9.9.9.9"), ConflictError);
  });
});
