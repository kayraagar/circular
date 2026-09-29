import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createRateLimiter } from "@/lib/rate-limit";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { brand } from "@/config/brand";
import { brevoConfig, brevoReady, sendEmail } from "@/modules/campaigns/brevo-api";
import { sendVerificationSms, smsSenderFor } from "@/modules/verification/sms";

/**
 * Üyelik alanı — kişinin şifresiz girip kendi kaydını gördüğü bölüm.
 *
 * Giriş tek kullanımlık kodla yapılır: kişi telefonunu veya e-postasını yazar, koda sahip
 * olduğunu kanıtlar. **Hesabın var olup olmadığı hiçbir durumda belli edilmez** — aksi hâlde
 * form, "bu numara bu mekana üye mi?" sorusunu yanıtlayan bir tarama aracına dönerdi.
 *
 * Üyelik oturumu panel oturumundan tamamen ayrıdır (ayrı cookie, ayrı tablo) ve hiçbir panel
 * yetkisi vermez: yalnızca o kişinin kendi kaydını açar.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const MEMBER_COOKIE = "circular_member";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Adres/numara deneyerek üye taramayı ve kod bombardımanını engeller. */
const requestLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 5, prefix: "member-code:" });
const ipLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 20, prefix: "member-ip:" });

export async function resetMemberRateLimits() {
  await requestLimiter.reset();
  await ipLimiter.reset();
}

export type Identifier = { channel: "SMS"; destination: string } | { channel: "EMAIL"; destination: string };

/** Girilen metin telefon mu e-posta mı? Belirsizse doğrulama hatası. */
export function parseIdentifier(raw: string): Identifier {
  const value = raw.trim();
  if (value.includes("@")) {
    const email = normalizeEmail(value);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ValidationError({ identifier: ["Geçerli bir e-posta adresi girin."] });
    }
    return { channel: "EMAIL", destination: email };
  }
  const phone = normalizePhone(value);
  if (!phone || !phone.ok) throw new ValidationError({ identifier: ["Geçerli bir telefon numarası veya e-posta girin."] });
  return { channel: "SMS", destination: phone.e164 };
}

export type RequestResult = { deliverable: boolean };

/**
 * Giriş kodu ister. Dönen değer hesabın varlığını açık etmez; `deliverable` yalnızca o kanalın
 * (SMS/e-posta) işletmede bağlı olup olmadığını söyler.
 */
export async function requestMemberCode(
  venueSlug: string,
  rawIdentifier: string,
  meta: { ip: string },
  now = new Date(),
): Promise<RequestResult> {
  const venue = await db.venue.findUnique({
    where: { slug: venueSlug },
    select: { tenantId: true, isActive: true, tenant: { select: { name: true, status: true } } },
  });
  if (!venue || !venue.isActive || venue.tenant.status !== "ACTIVE") throw new NotFoundError("Mekan bulunamadı.");

  const id = parseIdentifier(rawIdentifier);
  const deliverable = id.channel === "EMAIL" ? brevoReady() : (await smsSenderFor(venue.tenantId)) !== null;

  if (!(await ipLimiter.hit(meta.ip, now.getTime())).allowed) {
    throw new ConflictError("Çok fazla giriş isteği yapıldı. Biraz sonra tekrar deneyin.", "RATE_LIMITED");
  }
  if (!(await requestLimiter.hit(`${venue.tenantId}|${id.destination}`, now.getTime())).allowed) {
    throw new ConflictError("Bu adrese kısa sürede çok fazla kod gönderildi. Biraz sonra tekrar deneyin.", "RATE_LIMITED");
  }
  if (!deliverable) return { deliverable };

  const customer = await db.customer.findFirst({
    where: {
      tenantId: venue.tenantId,
      anonymizedAt: null,
      ...(id.channel === "EMAIL" ? { email: id.destination } : { phone: id.destination }),
    },
    select: { id: true, firstName: true },
  });
  // Kayıt yoksa hiçbir şey gönderilmez ama cevap aynıdır (üye taraması engellenir).
  if (!customer) return { deliverable };

  const code = newCode();
  await db.memberLoginCode.upsert({
    where: { tenantId_destination: { tenantId: venue.tenantId, destination: id.destination } },
    create: {
      tenantId: venue.tenantId,
      channel: id.channel,
      destination: id.destination,
      codeHash: hash(code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
    update: {
      channel: id.channel,
      codeHash: hash(code),
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
  });

  await deliver(venue.tenantId, venue.tenant.name, id, code, customer.firstName).catch((error) => {
    // Gönderim hatası kullanıcıya yansıtılmaz (hesap varlığını sızdırır); kayda düşer.
    console.error("[member] giriş kodu gönderilemedi", error);
  });
  return { deliverable };
}

async function deliver(tenantId: string, tenantName: string, id: Identifier, code: string, firstName: string) {
  if (id.channel === "SMS") {
    const sender = await smsSenderFor(tenantId);
    if (sender) await sendVerificationSms(sender, id.destination, code);
    return;
  }
  const { senderEmail } = brevoConfig();
  if (!senderEmail) return;
  await sendEmail({
    to: { email: id.destination, name: firstName },
    sender: { name: tenantName, email: senderEmail },
    subject: `${tenantName} üyelik giriş kodunuz: ${code}`,
    htmlContent: `<!doctype html><html lang="tr"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#111">
<p>Merhaba,</p>
<p>${tenantName} üyelik alanına giriş kodunuz:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:600">${code}</p>
<p style="font-size:13px;color:#555">Kod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayın.</p>
<p style="font-size:12px;color:#888">${brand.name} altyapısıyla gönderilmiştir.</p>
</body></html>`,
    tags: ["member-login"],
  });
}

export type ConfirmResult = { ok: true; token: string; expiresAt: Date } | { ok: false; reason: "INVALID" | "EXPIRED" | "TOO_MANY" | "NOT_FOUND" };

/** Kodu doğrular ve üyelik oturumu açar. */
export async function confirmMemberCode(venueSlug: string, rawIdentifier: string, rawCode: string, now = new Date()): Promise<ConfirmResult> {
  const venue = await db.venue.findUnique({ where: { slug: venueSlug }, select: { tenantId: true, isActive: true } });
  if (!venue || !venue.isActive) return { ok: false, reason: "NOT_FOUND" };

  let id: Identifier;
  try {
    id = parseIdentifier(rawIdentifier);
  } catch {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const record = await db.memberLoginCode.findUnique({
    where: { tenantId_destination: { tenantId: venue.tenantId, destination: id.destination } },
  });
  if (!record || record.usedAt) return { ok: false, reason: "NOT_FOUND" };
  if (record.expiresAt <= now) return { ok: false, reason: "EXPIRED" };
  if (record.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "TOO_MANY" };

  const given = Buffer.from(hash(rawCode.replace(/\D/g, "")));
  const expected = Buffer.from(record.codeHash);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    await db.memberLoginCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: record.attempts + 1 >= MAX_ATTEMPTS ? "TOO_MANY" : "INVALID" };
  }

  const customer = await db.customer.findFirst({
    where: {
      tenantId: venue.tenantId,
      anonymizedAt: null,
      ...(id.channel === "EMAIL" ? { email: id.destination } : { phone: id.destination }),
    },
    select: { id: true },
  });
  if (!customer) return { ok: false, reason: "NOT_FOUND" };

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.$transaction([
    db.memberLoginCode.update({ where: { id: record.id }, data: { usedAt: now } }),
    db.memberSession.create({ data: { tokenHash: hash(token), tenantId: venue.tenantId, customerId: customer.id, expiresAt } }),
  ]);
  // Numarasıyla giriş yapan kişi numarasının sahibi olduğunu kanıtlamıştır.
  if (id.channel === "SMS") {
    await db.customer.updateMany({ where: { id: customer.id, phoneVerifiedAt: null }, data: { phoneVerifiedAt: now } });
  }
  return { ok: true, token, expiresAt };
}

export type MemberContext = { customerId: string; tenantId: string; sessionId: string };

export async function readMemberSession(token: string | undefined, now = new Date()): Promise<MemberContext | null> {
  if (!token) return null;
  const session = await db.memberSession.findUnique({
    where: { tokenHash: hash(token) },
    include: { customer: { select: { id: true, archivedAt: true, anonymizedAt: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= now || session.customer.anonymizedAt) {
    await db.memberSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return { customerId: session.customerId, tenantId: session.tenantId, sessionId: session.id };
}

export async function endMemberSession(token: string | undefined) {
  if (token) await db.memberSession.deleteMany({ where: { tokenHash: hash(token) } });
}

/** Süresi dolmuş kod ve oturumları siler (kampanya işçisi turunda). */
export async function pruneMemberRecords(now = new Date()): Promise<number> {
  const [codes, sessions] = await db.$transaction([
    db.memberLoginCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } }),
    db.memberSession.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return codes.count + sessions.count;
}
