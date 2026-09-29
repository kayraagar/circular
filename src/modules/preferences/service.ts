import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { maskedName } from "@/modules/passes/rules";
import { absoluteUrl } from "@/modules/passes/token";
import { createRateLimiter } from "@/lib/rate-limit";
import { CHANNELS, CHANNEL_LABELS, type Channel } from "@/lib/domain";
import { logActivity } from "@/modules/activity/service";

/**
 * Tercih merkezi — kişinin kendi iletişim izinlerini görüp değiştirdiği herkese açık sayfa.
 *
 * KVKK ve İYS açısından gereklidir: ticari ileti alan kişi, izni verdiği kolaylıkta geri
 * alabilmelidir. E-postadaki "Abonelikten çık" tek mesajı/kanalı kapatır; burası üç kanalı
 * birden yönetir.
 *
 * Bağlantı, kişi kimliğinin HMAC imzasıdır (veritabanında satır tutulmaz). Sayfada kişisel
 * veri olarak yalnızca **maskeli ad** gösterilir — telefon, e-posta ve geçmiş gösterilmez;
 * böylece bağlantı başkasının eline geçse bile bilgi sızmaz.
 */

export const PREFERENCE_TEXT_VERSION = "preference-center-v1";

export const PREFERENCE_TEXTS: Record<Channel, string> = {
  WHATSAPP: "Kampanya, ikram ve etkinlik duyurularını WhatsApp ile almak istiyorum.",
  SMS: "Kampanya, ikram ve etkinlik duyurularını SMS ile almak istiyorum.",
  EMAIL: "Kampanya, ikram ve etkinlik duyurularını e-posta ile almak istiyorum.",
};

function key(): Buffer {
  const secret = process.env.CHANNEL_TOKEN_SECRET ?? "";
  if (secret.length < 32) throw new Error("CHANNEL_TOKEN_SECRET tanımlı değil veya 32 karakterden kısa.");
  return createHmac("sha256", secret).update("circular-preference-center:v1").digest();
}

function sign(customerId: string): string {
  return createHmac("sha256", key()).update(customerId).digest().subarray(0, 18).toString("base64url");
}

export function preferenceToken(customerId: string): string {
  return `${customerId}.${sign(customerId)}`;
}

export function preferenceUrl(customerId: string): string {
  return absoluteUrl(`/tercih/${preferenceToken(customerId)}`);
}

function verify(token: string): string | null {
  const [customerId, sig] = token.split(".");
  if (!customerId || !sig || !/^[a-z0-9]{10,40}$/i.test(customerId)) return null;
  const expected = Buffer.from(sign(customerId));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? customerId : null;
}

/** Bağlantıyı deneyerek kişi taramayı engeller. */
const limiter = createRateLimiter({ windowMs: 10 * 60_000, max: 30, prefix: "pref:" });
export async function resetPreferenceRateLimit() {
  await limiter.reset();
}

export type PreferenceChannel = { channel: Channel; label: string; text: string; granted: boolean; available: boolean };

export type PreferenceView = {
  tenantName: string;
  /** Yalnızca maskeli ad ("D*** K***"); başka kişisel veri gösterilmez. */
  holder: string;
  channels: PreferenceChannel[];
};

export async function readPreferences(token: string): Promise<PreferenceView | null> {
  const customerId = verify(token);
  if (!customerId) return null;
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      archivedAt: true,
      anonymizedAt: true,
      tenant: { select: { name: true, status: true } },
      consents: { select: { channel: true, status: true } },
    },
  });
  if (!customer || customer.anonymizedAt || customer.tenant.status !== "ACTIVE") return null;

  const granted = new Set(customer.consents.filter((c) => c.status === "GRANTED").map((c) => c.channel));
  return {
    tenantName: customer.tenant.name,
    holder: maskedName(customer.firstName, customer.lastName),
    channels: CHANNELS.map((channel) => ({
      channel,
      label: CHANNEL_LABELS[channel],
      text: PREFERENCE_TEXTS[channel],
      granted: granted.has(channel),
      // İletişim bilgisi olmayan kanal açılamaz (ör. e-posta adresi yoksa e-posta izni).
      available: channel === "EMAIL" ? Boolean(customer.email) : Boolean(customer.phone),
    })),
  };
}

/**
 * Kişinin seçimini kaydeder. Seçilmeyen kanalların izni kaldırılır — "hepsini kapat"
 * işlemi de budur. Arşivlenmiş kişi izni geri açamaz (işletme kaydını kapatmıştır).
 */
export async function savePreferences(token: string, wanted: string[], now = new Date()): Promise<PreferenceView | null> {
  const customerId = verify(token);
  if (!customerId) return null;
  if (!(await limiter.hit(customerId, now.getTime())).allowed) {
    throw new ConflictError("Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.", "RATE_LIMITED");
  }

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, tenantId: true, firstName: true, lastName: true, phone: true, email: true, archivedAt: true, anonymizedAt: true, tenant: { select: { status: true } } },
  });
  if (!customer || customer.anonymizedAt || customer.tenant.status !== "ACTIVE") return null;

  const selected = new Set(wanted.filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c)));

  await db.$transaction(async (tx) => {
    for (const channel of CHANNELS) {
      const hasContact = channel === "EMAIL" ? Boolean(customer.email) : Boolean(customer.phone);
      // İzni açmak iletişim bilgisi ve aktif kayıt ister; kapatmak her zaman mümkündür.
      const grant = selected.has(channel) && hasContact && !customer.archivedAt;
      const existing = await tx.contactConsent.findUnique({ where: { customerId_channel: { customerId, channel } } });
      const current = existing?.status === "GRANTED";
      if (current === grant) continue;

      const data = {
        status: grant ? "GRANTED" : "REVOKED",
        source: "PREFERENCE_CENTER",
        consentTextVersion: PREFERENCE_TEXT_VERSION,
        note: grant ? "Tercih merkezinden açıldı" : "Tercih merkezinden kapatıldı",
        // Kişinin kendi işlemi: personel kaydı değildir.
        recordedByUserId: null,
        grantedAt: grant ? now : existing?.grantedAt ?? null,
        revokedAt: grant ? null : now,
      };
      const consent = existing
        ? await tx.contactConsent.update({ where: { id: existing.id }, data })
        : await tx.contactConsent.create({ data: { tenantId: customer.tenantId, customerId, channel, ...data } });

      await logActivity(tx, { tenantId: customer.tenantId, userId: null }, {
        action: grant ? "consent.granted" : "consent.revoked",
        entityType: "consent",
        entityId: consent.id,
        customerId,
        metadata: { channel, via: "PREFERENCE_CENTER" },
      });
    }
  });

  return readPreferences(token);
}
