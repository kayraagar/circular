import "server-only";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseLocalDateTime } from "@/lib/datetime";
import { logActivity } from "@/modules/activity/service";

/**
 * Zamanlanmış kampanya.
 *
 * Kampanya normal akışla oluşturulur (mesajlar kuyruğa yazılır), sonra hemen gönderilmek
 * yerine SCHEDULED durumuna alınır. Zamanı gelince arka plan işçisi (`worker.ts`) başlatır.
 * Kuyruktaki mesajlara kimse dokunmadığı için gönderim anı kontrolleri (izin, arşiv, İYS)
 * yine **gönderim anında** çalışır — planlama sırasında değil.
 */

/** Planlanan an en az bu kadar ileride olmalı (yanlışlıkla "şimdi" planlamayı önler). */
const MIN_LEAD_MS = 2 * 60_000;
/** En fazla bu kadar ileri planlanabilir. */
export const MAX_SCHEDULE_DAYS = 60;

export function parseScheduleAt(value: string, now = new Date()): Date {
  const at = parseLocalDateTime(value);
  if (!at) throw new ValidationError({ scheduledAt: ["Geçerli bir tarih ve saat seçin."] });
  if (at.getTime() < now.getTime() + MIN_LEAD_MS) {
    throw new ValidationError({ scheduledAt: ["Planlanan an en az birkaç dakika ileride olmalı."] });
  }
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 864e5) {
    throw new ValidationError({ scheduledAt: [`En fazla ${MAX_SCHEDULE_DAYS} gün ileri planlanabilir.`] });
  }
  return at;
}

/** Oluşturulmuş kampanyayı planlı gönderime alır. Test gönderimi planlanamaz. */
export async function scheduleCampaign(ctx: ServiceContext, campaignId: string, value: string, now = new Date()) {
  assertCan(ctx, "campaigns.manage");
  const at = parseScheduleAt(value, now);
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, tenantId: ctx.tenantId },
    select: { id: true, name: true, mode: true, status: true, channel: true, recipientCount: true },
  });
  if (!campaign) throw new NotFoundError("Kampanya bulunamadı.");
  if (campaign.mode !== "LIVE") throw new ConflictError("Test gönderimi planlanamaz.", "TEST_CAMPAIGN");

  // Yalnızca hiç mesaj çıkmamış kampanya planlanabilir.
  const started = await db.campaignMessage.count({ where: { campaignId: campaign.id, status: { not: "QUEUED" } } });
  if (started > 0) throw new ConflictError("Gönderim başlamış; artık planlanamaz.", "ALREADY_STARTED");

  const { count } = await db.campaign.updateMany({
    where: { id: campaign.id, tenantId: ctx.tenantId, status: "SENDING" },
    data: { status: "SCHEDULED", scheduledAt: at },
  });
  if (count !== 1) throw new ConflictError("Kampanya planlanabilir durumda değil.", "NOT_SCHEDULABLE");

  await db.$transaction(async (tx) => {
    await logActivity(tx, ctx, {
      action: "campaign.scheduled",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { name: campaign.name, channel: campaign.channel, recipientCount: campaign.recipientCount, scheduledAt: at.toISOString() },
    });
  });
  return { id: campaign.id, scheduledAt: at };
}

/**
 * Planlanan gönderimi iptal eder. Hiçbir mesaj gitmediği için kampanya kaydı tamamen silinir
 * (rapor ve geçmişte "0 gönderimlik kampanya" olarak görünmez). İptal denetim kaydına düşer.
 */
export async function cancelScheduledCampaign(ctx: ServiceContext, campaignId: string) {
  assertCan(ctx, "campaigns.manage");
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, tenantId: ctx.tenantId },
    select: { id: true, name: true, status: true, channel: true, scheduledAt: true },
  });
  if (!campaign) throw new NotFoundError("Kampanya bulunamadı.");
  if (campaign.status !== "SCHEDULED") throw new ConflictError("Yalnızca planlanmış kampanya iptal edilebilir.", "NOT_SCHEDULED");

  await db.$transaction(async (tx) => {
    // Koşullu silme: işçi bu arada kampanyayı başlattıysa satır SENDING olur ve silinmez.
    const { count } = await tx.campaign.deleteMany({ where: { id: campaign.id, tenantId: ctx.tenantId, status: "SCHEDULED" } });
    if (count !== 1) throw new ConflictError("Gönderim bu arada başladı; iptal edilemedi.", "ALREADY_STARTED");
    await logActivity(tx, ctx, {
      action: "campaign.schedule_cancelled",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { name: campaign.name, channel: campaign.channel, scheduledAt: campaign.scheduledAt?.toISOString() ?? null },
    });
  });
  return { id: campaign.id };
}
