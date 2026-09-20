import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { fullName } from "@/lib/normalize";
import { absoluteUrl } from "@/modules/passes/token";
import { logActivity } from "@/modules/activity/service";

/**
 * E-postadaki "Abonelikten çık" bağlantısı. Bağlantı mesaj kimliği + HMAC imzası taşır (tahmin edilemez, değiştirilemez).
 * Tek tıkla çıkış (List-Unsubscribe-Post) ve sayfadan onayla çıkış aynı işlevi kullanır.
 */

function key(): Buffer {
  const secret = process.env.CHANNEL_TOKEN_SECRET ?? "";
  if (secret.length < 32) throw new Error("CHANNEL_TOKEN_SECRET tanımlı değil veya 32 karakterden kısa.");
  return createHmac("sha256", secret).update("circular-email-unsubscribe:v1").digest();
}

function sign(messageId: string): string {
  return createHmac("sha256", key()).update(messageId).digest().subarray(0, 18).toString("base64url");
}

export function unsubscribeToken(messageId: string): string {
  return `${messageId}.${sign(messageId)}`;
}

export function unsubscribePageUrl(messageId: string): string {
  return absoluteUrl(`/abonelik/${unsubscribeToken(messageId)}`);
}

export function unsubscribeOneClickUrl(messageId: string): string {
  return absoluteUrl(`/api/abonelik/${unsubscribeToken(messageId)}`);
}

function verify(token: string): string | null {
  const [messageId, sig] = token.split(".");
  if (!messageId || !sig || !/^[a-z0-9]{10,40}$/i.test(messageId)) return null;
  const expected = Buffer.from(sign(messageId));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? messageId : null;
}

export type UnsubscribeTarget = { tenantName: string; test: boolean; alreadyRevoked: boolean };

/** Bağlantının gösterdiği işletme ve durum (geçersizse null). */
export async function resolveUnsubscribe(token: string): Promise<UnsubscribeTarget | null> {
  const messageId = verify(token);
  if (!messageId) return null;
  const message = await db.campaignMessage.findUnique({
    where: { id: messageId },
    select: { customerId: true, tenantId: true, campaign: { select: { channel: true, tenant: { select: { name: true } } } } },
  });
  if (!message || message.campaign.channel !== "EMAIL") return null;
  const consent = message.customerId
    ? await db.contactConsent.findUnique({ where: { customerId_channel: { customerId: message.customerId, channel: "EMAIL" } }, select: { status: true } })
    : null;
  return { tenantName: message.campaign.tenant.name, test: !message.customerId, alreadyRevoked: consent?.status === "REVOKED" };
}

/** Müşterinin e-posta iznini kaldırır. Test e-postasında işlem yapılmaz. Tekrar çağrılabilir. */
export async function unsubscribeByToken(token: string): Promise<{ ok: boolean }> {
  const messageId = verify(token);
  if (!messageId) return { ok: false };
  const message = await db.campaignMessage.findUnique({
    where: { id: messageId },
    select: { customerId: true, tenantId: true, campaign: { select: { channel: true } } },
  });
  if (!message || message.campaign.channel !== "EMAIL") return { ok: false };
  if (!message.customerId) return { ok: true };
  await revokeEmailConsent(message.tenantId, message.customerId, "UNSUBSCRIBE_LINK");
  return { ok: true };
}

/** E-posta iznini kaldırır (bağlantı, spam şikâyeti veya sağlayıcının abonelik bildirimi). */
export async function revokeEmailConsent(tenantId: string, customerId: string, via: "UNSUBSCRIBE_LINK" | "SPAM_COMPLAINT" | "PROVIDER_UNSUBSCRIBE") {
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) return false;
  return db.$transaction(async (tx) => {
    const existing = await tx.contactConsent.findUnique({ where: { customerId_channel: { customerId, channel: "EMAIL" } } });
    if (existing?.status === "REVOKED") return false;
    const now = new Date();
    const note = via === "SPAM_COMPLAINT" ? "E-postayı istenmeyen olarak işaretledi" : "E-postadaki bağlantıyla abonelikten çıktı";
    const consent = existing
      ? await tx.contactConsent.update({ where: { id: existing.id }, data: { status: "REVOKED", revokedAt: now, recordedByUserId: null, note } })
      : await tx.contactConsent.create({ data: { tenantId, customerId, channel: "EMAIL", status: "REVOKED", source: "OPT_OUT_REPLY", note, revokedAt: now } });
    await logActivity(tx, { tenantId, userId: null }, {
      action: "consent.revoked",
      entityType: "consent",
      entityId: consent.id,
      customerId,
      metadata: { customerName: fullName(customer), channel: "EMAIL", via },
    });
    return true;
  });
}
