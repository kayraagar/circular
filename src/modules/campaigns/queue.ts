import "server-only";
import { db } from "@/lib/db";
import type { CampaignChannel, ExclusionReason } from "./rules";

/**
 * Kampanya gönderim kuyruğunun kanaldan bağımsız parçaları.
 * Mesaj satırları veritabanındadır; her mesaj QUEUED → SENDING koşullu güncellemesiyle yalnızca bir kez alınır.
 */

export type Claimed = { id: string; customerId: string | null; toPhone: string | null; toEmail: string | null };

export const BATCH_SIZE = 25;
export const CONCURRENCY = 5;

/** Sağlayıcı reddinde bir mesaj en fazla kaç kez denenir (ilk deneme dahil). */
export const MAX_ATTEMPTS = 3;
/** Yeniden denemeden önce beklenen süre. */
export const RETRY_DELAY_MS = 2 * 60_000;

/**
 * Sağlayıcının isteği **açıkça** reddettiği, tekrar denemekle düzelebilecek hatalar.
 * Yalnızca bu kodlarda mesajın alıcıya gitmediği kesindir; bağlantı kopması gibi sonucu
 * bilinmeyen hatalar otomatik tekrarlanmaz (mükerrer mesaj riski).
 */
const RETRYABLE_CODES = new Set([
  // HTTP durumu kod olarak yazıldığında (Meta, Brevo)
  "429",
  "500",
  "502",
  "503",
  "504",
  // Meta: uygulama/numara hız sınırı
  "4",
  "80007",
  "130429",
  "131048",
  // Brevo
  "too_many_requests",
  // Netgsm: hız sınırı ve sistem hatası
  "80",
  "85",
  "100",
  "101",
  "110",
]);

/** Kanal önekleri (NETGSM_80, BREVO_error) ayıklanarak bakılır. */
export function isRetryableErrorCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const bare = code.replace(/^(NETGSM|BREVO|SMS)_/, "");
  return RETRYABLE_CODES.has(bare);
}

/** Sıradaki mesajları alır (başka bir işlemin aldıkları atlanır). Sıra boşsa null. */
export async function claimBatch(campaignId: string, take = BATCH_SIZE): Promise<Claimed[] | null> {
  const queued = await db.campaignMessage.findMany({
    where: { campaignId, status: "QUEUED" },
    select: { id: true, customerId: true, toPhone: true, toEmail: true },
    orderBy: { createdAt: "asc" },
    take,
  });
  if (queued.length === 0) return null;
  const batch: Claimed[] = [];
  for (const m of queued) {
    const { count } = await db.campaignMessage.updateMany({
      where: { id: m.id, status: "QUEUED" },
      data: { status: "SENDING", attemptedAt: new Date(), attempts: { increment: 1 } },
    });
    if (count === 1) batch.push(m);
  }
  return batch;
}

export async function skipMessage(messageId: string, reason: ExclusionReason) {
  await db.campaignMessage.update({ where: { id: messageId }, data: { status: "SKIPPED", skipReason: reason } });
}

/**
 * Mesajları başarısız işaretler. Sağlayıcı isteği açıkça reddettiyse mesaj yeniden denemeye
 * hazırlanır (`nextAttemptAt`); işçi bekleme dolunca sıraya geri alır.
 */
export async function failMessages(ids: string[], code: string, message: string, now = new Date()) {
  if (ids.length === 0) return;
  const nextAttemptAt = isRetryableErrorCode(code) ? new Date(now.getTime() + RETRY_DELAY_MS) : null;
  await db.campaignMessage.updateMany({
    where: { id: { in: ids } },
    data: { status: "FAILED", errorCode: code, errorMessage: message.slice(0, 300), failedAt: now, nextAttemptAt },
  });
}

export async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) await fn(items[index++]);
  });
  await Promise.all(workers);
}

/**
 * Canlı gönderim anında yeniden kontrol: müşteri arşivlenmiş mi, iletişim bilgisi değişmiş mi, kanal izni hâlâ var mı.
 * (İYS kontrolü kanala özeldir: WhatsApp'ta entegratör, SMS'te Netgsm.)
 */
export async function recheckRecipients(tenantId: string, batch: Claimed[], channel: CampaignChannel): Promise<Map<string, ExclusionReason>> {
  const reasons = new Map<string, ExclusionReason>();
  const customers = await db.customer.findMany({
    where: { tenantId, id: { in: batch.map((m) => m.customerId).filter((x): x is string => x !== null) } },
    select: { id: true, phone: true, email: true, archivedAt: true, consents: { where: { channel, status: "GRANTED" }, select: { id: true } } },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));
  for (const m of batch) {
    const c = m.customerId ? byId.get(m.customerId) : undefined;
    const contactChanged = channel === "EMAIL" ? c?.email !== m.toEmail : c?.phone !== m.toPhone;
    if (!c || c.archivedAt) reasons.set(m.id, "ARCHIVED");
    else if (contactChanged) reasons.set(m.id, "PHONE_CHANGED");
    else if (c.consents.length === 0) reasons.set(m.id, "NO_CONSENT");
  }
  return reasons;
}

/** Kişiselleştirme için müşteri adları. */
export async function firstNamesFor(batch: Claimed[]): Promise<Map<string, string>> {
  const ids = batch.map((m) => m.customerId).filter((x): x is string => x !== null);
  if (ids.length === 0) return new Map();
  const rows = await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true } });
  return new Map(rows.map((c) => [c.id, c.firstName.trim()]));
}

/** Sırada mesaj kalmadıysa kampanyayı tamamlandı olarak işaretler. */
export async function completeIfDone(campaignId: string) {
  const remaining = await db.campaignMessage.count({ where: { campaignId, status: "QUEUED" } });
  if (remaining === 0) await db.campaign.update({ where: { id: campaignId }, data: { status: "COMPLETED", completedAt: new Date() } });
}
