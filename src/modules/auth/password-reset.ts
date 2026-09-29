import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { hashPassword } from "@/lib/auth/password";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/normalize";
import { createRateLimiter } from "@/lib/rate-limit";
import { brand } from "@/config/brand";
import { absoluteUrl } from "@/modules/passes/token";
import { brevoConfig, brevoReady, sendEmail } from "@/modules/campaigns/brevo-api";
import { logActivity } from "@/modules/activity/service";

/**
 * Şifre sıfırlama.
 *
 * İki yol vardır:
 *  - Kişinin kendi talebi (`/sifremi-unuttum`): e-posta servisi bağlıysa bağlantı e-postayla gider.
 *    Hesabın var olup olmadığı **hiçbir durumda** belli edilmez (aynı mesaj, aynı süre).
 *  - İşletme sahibinin ürettiği bağlantı (Ayarlar › Ekip): e-posta servisi olmadan da çalışır;
 *    sahip bağlantıyı kendi kanalıyla iletir (davet bağlantısıyla aynı mantık).
 *
 * Bağlantının ham kodu saklanmaz (yalnızca SHA-256 özeti), tek kullanımlıktır ve bir saatte
 * geçersizleşir. Şifre değişince kişinin tüm oturumları kapatılır.
 */

export const RESET_TTL_MINUTES = 60;
export const MIN_PASSWORD = 10;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function resetPath(token: string) {
  return `/sifre/${token}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Adres deneyerek hesap taramasını ve e-posta bombardımanını engeller. */
const requestLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });
/** Bağlantı kodunu deneyerek şifre değiştirmeyi engeller. */
const completeLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10 });

export async function resetPasswordRateLimits() {
  await requestLimiter.reset();
  await completeLimiter.reset();
}

// ─────────────────────────────────────────────── Bağlantı üretme

async function issueToken(userId: string, origin: "SELF" | "OWNER", createdByUserId: string | null, now: Date) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000);
  // Yeni bağlantı üretilince eskiler geçersizleşir: aynı anda tek geçerli kod bulunur.
  await db.$transaction([
    db.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } }),
    db.passwordReset.create({ data: { userId, tokenHash: hashToken(token), origin, createdByUserId, expiresAt } }),
  ]);
  return { token, url: absoluteUrl(resetPath(token)), expiresAt };
}

const requestSchema = z.object({ email: z.email("Geçerli bir e-posta adresi girin.").max(254) });

/**
 * Kişinin kendi sıfırlama talebi. Dönüş değeri hesabın varlığını **açık etmez**:
 * `delivered` yalnızca e-posta servisinin bağlı olup olmadığını söyler.
 */
export async function requestPasswordReset(raw: unknown, ip: string, now = new Date()): Promise<{ emailConfigured: boolean }> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const email = normalizeEmail(parsed.data.email) ?? "";
  const emailConfigured = brevoReady();

  if (!(await requestLimiter.hit(`${ip}`, now.getTime())).allowed || !(await requestLimiter.hit(email, now.getTime())).allowed) {
    throw new ConflictError("Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.", "RATE_LIMITED");
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, isActive: true } });
  if (!user || !user.isActive || !emailConfigured) return { emailConfigured };

  const { url } = await issueToken(user.id, "SELF", null, now);
  await deliverResetEmail(user, url).catch((error) => {
    // Gönderim hatası kullanıcıya yansıtılmaz (hesap varlığını sızdırır); kayda düşer.
    console.error("[password-reset] e-posta gönderilemedi", error);
  });
  return { emailConfigured };
}

async function deliverResetEmail(user: { name: string; email: string }, url: string) {
  const { senderEmail } = brevoConfig();
  if (!senderEmail) return;
  await sendEmail({
    to: { email: user.email, name: user.name },
    sender: { name: brand.name, email: senderEmail },
    subject: `${brand.name} şifre sıfırlama`,
    htmlContent: `<!doctype html><html lang="tr"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#111">
<p>Merhaba ${escapeHtml(user.name)},</p>
<p>${brand.name} hesabınız için şifre sıfırlama talebi aldık. Yeni şifrenizi belirlemek için:</p>
<p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Şifremi belirle</a></p>
<p style="font-size:13px;color:#555">Bağlantı ${RESET_TTL_MINUTES} dakika geçerlidir ve bir kez kullanılabilir.
Bu talebi siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.</p>
</body></html>`,
    tags: ["password-reset"],
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** İşletme sahibi, ekip üyesi için sıfırlama bağlantısı üretir (e-posta servisi gerekmez). */
export async function createResetLinkForMember(ctx: ServiceContext, membershipId: string, now = new Date()) {
  assertCan(ctx, "team.manage");
  const membership = await db.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenantId },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  if (!membership) throw new NotFoundError("Ekip üyesi bulunamadı.");
  if (!membership.user.isActive) throw new ConflictError("Hesap kapalı. Önce erişimi açın.", "USER_INACTIVE");

  const { url, expiresAt } = await issueToken(membership.user.id, "OWNER", ctx.userId, now);
  await db.$transaction(async (tx) => {
    await logActivity(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
      action: "team.reset_link_created",
      entityType: "membership",
      entityId: membership.id,
      metadata: { name: membership.user.name, email: membership.user.email },
    });
  });
  return { url, expiresAt, email: membership.user.email };
}

// ─────────────────────────────────────────────── Bağlantıyı kullanma

export type ResetView = { name: string; email: string; expiresAt: Date };

async function loadReset(token: string, now: Date) {
  if (!TOKEN_RE.test(token)) throw new NotFoundError("Bağlantı geçersiz.");
  const reset = await db.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  if (!reset) throw new NotFoundError("Bağlantı geçersiz.");
  if (reset.usedAt) throw new ConflictError("Bu bağlantı daha önce kullanıldı. Yeni bağlantı isteyin.", "ALREADY_USED");
  if (reset.expiresAt < now) throw new ConflictError("Bağlantının süresi doldu. Yeni bağlantı isteyin.", "EXPIRED");
  if (!reset.user.isActive) throw new ConflictError("Hesap kapalı. İşletme sahibiyle görüşün.", "USER_INACTIVE");
  return reset;
}

export async function readReset(token: string, now = new Date()): Promise<ResetView> {
  const reset = await loadReset(token, now);
  return { name: reset.user.name, email: reset.user.email, expiresAt: reset.expiresAt };
}

const completeSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD, `Şifre en az ${MIN_PASSWORD} karakter olmalı.`).max(200),
    passwordRepeat: z.string().max(200),
  })
  .refine((v) => v.password === v.passwordRepeat, { path: ["passwordRepeat"], message: "Şifreler aynı değil." });

/** Yeni şifreyi yazar, bağlantıyı tüketir ve kişinin tüm oturumlarını kapatır. */
export async function completePasswordReset(token: string, raw: unknown, now = new Date()): Promise<{ email: string }> {
  const reset = await loadReset(token, now);
  if (!(await completeLimiter.hit(reset.tokenHash, now.getTime())).allowed) {
    throw new ConflictError("Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.", "RATE_LIMITED");
  }
  const parsed = completeSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);

  const passwordHash = await hashPassword(parsed.data.password);
  const memberships = await db.membership.findMany({
    where: { userId: reset.userId, status: "ACTIVE" },
    select: { id: true, tenantId: true },
  });

  await db.$transaction(async (tx) => {
    const consumed = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: now } });
    // Aynı bağlantıyla eşzamanlı ikinci istek buraya düşerse işlem geri alınır.
    if (consumed.count !== 1) throw new ConflictError("Bu bağlantı daha önce kullanıldı.", "ALREADY_USED");
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    // Şifre değişti: eski oturumlar (ör. kaybolan telefon) geçersiz olmalı.
    await tx.session.deleteMany({ where: { userId: reset.userId } });
    for (const membership of memberships) {
      await logActivity(tx, { tenantId: membership.tenantId, userId: reset.userId }, {
        action: "team.password_reset",
        entityType: "membership",
        entityId: membership.id,
        metadata: { name: reset.user.name, email: reset.user.email },
      });
    }
  });

  await completeLimiter.reset(reset.tokenHash);
  return { email: reset.user.email };
}
