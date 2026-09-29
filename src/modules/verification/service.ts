import "server-only";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { createRateLimiter } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/normalize";
import { sendVerificationSms, smsSenderFor } from "./sms";

/**
 * Telefon doğrulama (tek kullanımlık SMS kodu).
 *
 * Neden gerekli: kayıt formuna başkasının numarası yazılabilir. İzin o numaranın sahibinden
 * alınmış sayılmaz; o numaraya ticari ileti göndermek hem İYS hem KVKK açısından sorunludur.
 * Doğrulanan numara `Customer.phoneVerifiedAt` ile işaretlenir ve kampanya kitlesi istenirse
 * yalnızca doğrulanmış numaralarla sınırlanabilir.
 *
 * Kod düz saklanmaz (SHA-256 özeti), 10 dakikada geçersizleşir, en fazla 5 kez denenebilir
 * ve numara başına yeniden gönderim sınırlıdır.
 *
 * SMS hesabı bağlı değilse doğrulama **başlatılmaz**: kod iletilemeyeceği için kullanıcıya
 * doğrulanamadığı açıkça söylenir, kayıt akışı doğrulamasız devam eder.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS = 3;

/**
 * Doğrulama kaydının imzalı kolu. Telefon numarası adrese yazılamaz (kişisel veri),
 * bu yüzden kayıt kimliği HMAC ile imzalanıp taşınır.
 */
function handleKey(): Buffer {
  const secret = process.env.CHANNEL_TOKEN_SECRET ?? "";
  if (secret.length < 32) throw new Error("CHANNEL_TOKEN_SECRET tanımlı değil veya 32 karakterden kısa.");
  return createHmac("sha256", secret).update("circular-phone-verification:v1").digest();
}

export function verificationHandle(recordId: string): string {
  const sig = createHmac("sha256", handleKey()).update(recordId).digest().subarray(0, 18).toString("base64url");
  return `${recordId}.${sig}`;
}

function readHandle(handle: string): string | null {
  const [recordId, sig] = handle.split(".");
  if (!recordId || !sig || !/^[a-z0-9]{10,40}$/i.test(recordId)) return null;
  const expected = Buffer.from(verificationHandle(recordId).split(".")[1]);
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? recordId : null;
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function newCode(): string {
  // 6 haneli, baştaki sıfırlar korunur.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Numara başına kod isteme sınırı (bomba mesaj koruması). */
const sendLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 5, prefix: "otp-send:" });
/** IP başına, farklı numaralarla deneme sınırı. */
const ipLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 20, prefix: "otp-ip:" });

export async function resetVerificationRateLimits() {
  await sendLimiter.reset();
  await ipLimiter.reset();
}

export type StartResult =
  | { status: "sent"; expiresAt: Date; sendsLeft: number; handle: string }
  | { status: "unavailable" }
  | { status: "already_verified" };

/** SMS hesabı bağlı değilse doğrulama sunulmaz. */
export async function verificationAvailable(tenantId: string): Promise<boolean> {
  return (await smsSenderFor(tenantId)) !== null;
}

/**
 * Doğrulama kodu gönderir. Aynı numara için açık bir kayıt varsa üzerine yazılır
 * (tek geçerli kod olur).
 */
export async function startPhoneVerification(
  tenantId: string,
  rawPhone: string,
  meta: { ip: string },
  now = new Date(),
): Promise<StartResult> {
  const parsed = normalizePhone(rawPhone);
  if (!parsed || !parsed.ok) throw new ValidationError({ phone: ["Geçerli bir telefon numarası girin."] });
  const phone = parsed.e164;

  const already = await db.customer.findFirst({
    where: { tenantId, phone, phoneVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (already) return { status: "already_verified" };

  const sender = await smsSenderFor(tenantId);
  if (!sender) return { status: "unavailable" };

  if (!(await ipLimiter.hit(meta.ip, now.getTime())).allowed) {
    throw new ConflictError("Çok fazla doğrulama isteği yapıldı. Biraz sonra tekrar deneyin.", "RATE_LIMITED");
  }
  const sendLimit = await sendLimiter.hit(`${tenantId}|${phone}`, now.getTime());
  if (!sendLimit.allowed) {
    throw new ConflictError("Bu numaraya kısa sürede çok fazla kod gönderildi. Bir süre sonra tekrar deneyin.", "RATE_LIMITED");
  }

  const code = newCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  const existing = await db.phoneVerification.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
  if (existing && !existing.verifiedAt && existing.sentCount >= MAX_SENDS && existing.expiresAt > now) {
    throw new ConflictError("Bu numara için kod sınırına ulaşıldı. Biraz sonra tekrar deneyin.", "TOO_MANY_SENDS");
  }

  const record = await db.phoneVerification.upsert({
    where: { tenantId_phone: { tenantId, phone } },
    create: { tenantId, phone, codeHash: hashCode(code), expiresAt },
    update: {
      codeHash: hashCode(code),
      expiresAt,
      attempts: 0,
      verifiedAt: null,
      // Süresi dolmuşsa sayaç sıfırlanır; açık kayıtta artar.
      sentCount: existing && existing.expiresAt > now ? { increment: 1 } : 1,
    },
  });

  await sendVerificationSms(sender, phone, code);
  return { status: "sent", expiresAt, sendsLeft: Math.max(0, MAX_SENDS - record.sentCount), handle: verificationHandle(record.id) };
}

export type ConfirmResult = { ok: true; phone: string } | { ok: false; reason: "INVALID" | "EXPIRED" | "TOO_MANY" | "NOT_FOUND" };

/**
 * Kodu doğrular. Doğruysa numarası bu olan müşteri kayıtları `phoneVerifiedAt` ile işaretlenir.
 * Yanlış kod denemesi sayılır; sınıra ulaşılınca kod geçersizleşir (yeni kod istenmeli).
 */
export async function confirmPhoneVerification(tenantId: string, rawPhone: string, rawCode: string, now = new Date()): Promise<ConfirmResult> {
  const parsed = normalizePhone(rawPhone);
  if (!parsed || !parsed.ok) return { ok: false, reason: "NOT_FOUND" };
  const phone = parsed.e164;
  const code = rawCode.replace(/\D/g, "");

  const record = await db.phoneVerification.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
  if (!record || record.verifiedAt) return { ok: false, reason: "NOT_FOUND" };
  if (record.expiresAt <= now) return { ok: false, reason: "EXPIRED" };
  if (record.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "TOO_MANY" };

  const given = Buffer.from(hashCode(code));
  const expected = Buffer.from(record.codeHash);
  const match = given.length === expected.length && timingSafeEqual(given, expected);
  if (!match) {
    await db.phoneVerification.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: record.attempts + 1 >= MAX_ATTEMPTS ? "TOO_MANY" : "INVALID" };
  }

  await db.$transaction([
    db.phoneVerification.update({ where: { id: record.id }, data: { verifiedAt: now } }),
    db.customer.updateMany({ where: { tenantId, phone }, data: { phoneVerifiedAt: now } }),
  ]);
  return { ok: true, phone };
}

export type HandleState = { open: true; maskedPhone: string } | { open: false };

/** Kolun gösterdiği doğrulamanın hâlâ açık olup olmadığı (sayfa kod kutusunu buna göre gösterir). */
export async function readVerificationHandle(handle: string, now = new Date()): Promise<HandleState> {
  const id = readHandle(handle);
  if (!id) return { open: false };
  const record = await db.phoneVerification.findUnique({ where: { id } });
  if (!record || record.verifiedAt || record.expiresAt <= now || record.attempts >= MAX_ATTEMPTS) return { open: false };
  // Numara maskelenir: bağlantı başkasının eline geçse de tam numara görünmez.
  return { open: true, maskedPhone: `${record.phone.slice(0, 4)}•••${record.phone.slice(-2)}` };
}

/** Kod onayı (imzalı kol üzerinden; telefon numarası istemciden gelmez). */
export async function confirmByHandle(handle: string, rawCode: string, now = new Date()): Promise<ConfirmResult> {
  const id = readHandle(handle);
  if (!id) return { ok: false, reason: "NOT_FOUND" };
  const record = await db.phoneVerification.findUnique({ where: { id }, select: { tenantId: true, phone: true } });
  if (!record) return { ok: false, reason: "NOT_FOUND" };
  return confirmPhoneVerification(record.tenantId, record.phone, rawCode, now);
}

/** Süresi dolmuş doğrulama kayıtlarını siler (kampanya işçisi turunda). */
export async function prunePhoneVerifications(now = new Date()): Promise<number> {
  const { count } = await db.phoneVerification.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 24 * 3600_000) } },
  });
  return count;
}
