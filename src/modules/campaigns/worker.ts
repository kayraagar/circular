import "server-only";
import { db } from "@/lib/db";
import { processCampaign } from "./campaign-service";
import { MAX_ATTEMPTS, isRetryableErrorCode } from "./queue";
import { pruneRateLimitCounters } from "@/lib/rate-limit";
import { prunePhoneVerifications } from "@/modules/verification/service";

/**
 * Kalıcı gönderim işçisi.
 *
 * Gönderim, isteği başlatan sunucu süreci ölse bile durmamalı: kampanya satırları ve mesaj
 * satırları veritabanında olduğu için iş kaybolmaz, ama birinin sırayı yeniden alması gerekir.
 * Bu işçi periyodik olarak (Vercel Cron → `/api/cron/campaigns`) çalışır ve üç işi yapar:
 *
 *  1. Zamanı gelen planlı kampanyaları başlatır (SCHEDULED → SENDING).
 *  2. Yarıda kalmış kampanyaların sırasını sürdürür (SENDING + kuyrukta mesaj var).
 *  3. Askıda kalan ve yeniden denenebilir mesajları kurtarır.
 *
 * **Mükerrer gönderim kuralı:** sağlayıcı isteği açıkça reddettiyse (ör. hız sınırı, sağlayıcı
 * sistem hatası) mesajın gitmediği kesindir; yalnızca bu durumda otomatik yeniden denenir.
 * Bağlantı koptuysa ya da süreç yarıda öldüyse mesajın gidip gitmediği bilinemez — o mesaj
 * otomatik tekrarlanmaz, "bilinmiyor" olarak işaretlenir ve kararı insan verir.
 */

/** Bir mesaj bu süre boyunca SENDING'de kalırsa süreç ölmüş sayılır. */
const STUCK_AFTER_MS = 10 * 60_000;
/** Bir çalışmada en fazla kaç kampanya sürdürülür (işlev süre sınırına takılmasın). */
const MAX_CAMPAIGNS_PER_RUN = 5;

export type WorkerReport = {
  startedScheduled: number;
  resumedCampaigns: number;
  requeuedMessages: number;
  abandonedMessages: number;
};

/**
 * Askıda kalan mesajları kurtarır.
 * Sağlayıcı reddi → sırada bekletilerek yeniden denenir. Belirsiz kalanlar (süreç ölmüş) →
 * UNKNOWN olarak kapatılır; ekran "durumu bilinmiyor" der, tekrarı kullanıcı seçer.
 */
async function recoverMessages(now: Date): Promise<{ requeued: number; abandoned: number }> {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const stuck = await db.campaignMessage.findMany({
    where: { status: "SENDING", attemptedAt: { lt: stuckBefore } },
    select: { id: true },
    take: 500,
  });
  let abandoned = 0;
  if (stuck.length > 0) {
    const { count } = await db.campaignMessage.updateMany({
      where: { id: { in: stuck.map((m) => m.id) }, status: "SENDING" },
      data: {
        status: "FAILED",
        errorCode: "UNKNOWN_OUTCOME",
        errorMessage: "Gönderim yarıda kesildi; mesajın iletilip iletilmediği bilinmiyor. Tekrarı elle seçilmeli.",
        failedAt: now,
      },
    });
    abandoned = count;
  }

  // Sağlayıcının reddettiği mesajlar: bekleme süresi dolanlar sıraya geri alınır.
  const retryable = await db.campaignMessage.findMany({
    where: {
      status: "FAILED",
      attempts: { lt: MAX_ATTEMPTS },
      nextAttemptAt: { not: null, lte: now },
      campaign: { status: "SENDING" },
    },
    select: { id: true, errorCode: true },
    take: 500,
  });
  const ids = retryable.filter((m) => isRetryableErrorCode(m.errorCode)).map((m) => m.id);
  if (ids.length === 0) return { requeued: 0, abandoned };
  const { count } = await db.campaignMessage.updateMany({
    where: { id: { in: ids }, status: "FAILED" },
    data: { status: "QUEUED", nextAttemptAt: null, errorCode: null, errorMessage: null, failedAt: null },
  });
  return { requeued: count, abandoned };
}

/** Zamanı gelen planlı kampanyaları başlatır. Döndürülen kimlikler bu çalışmada işlenir. */
async function startScheduled(now: Date): Promise<string[]> {
  const due = await db.campaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: MAX_CAMPAIGNS_PER_RUN,
  });
  const started: string[] = [];
  for (const c of due) {
    // Koşullu güncelleme: aynı anda çalışan ikinci işçi aynı kampanyayı başlatamaz.
    const { count } = await db.campaign.updateMany({
      where: { id: c.id, status: "SCHEDULED" },
      data: { status: "SENDING", startedAt: now },
    });
    if (count === 1) started.push(c.id);
  }
  return started;
}

/** Kuyruğunda mesaj kalmış, yarıda kesilmiş kampanyalar. */
async function unfinishedCampaigns(exclude: string[]): Promise<string[]> {
  const rows = await db.campaign.findMany({
    where: { status: "SENDING", id: { notIn: exclude }, messages: { some: { status: "QUEUED" } } },
    select: { id: true },
    orderBy: { startedAt: "asc" },
    take: MAX_CAMPAIGNS_PER_RUN,
  });
  return rows.map((r) => r.id);
}

/**
 * Bir tur işçi çalışması. Hata veren kampanya diğerlerini durdurmaz.
 * İşlev süre sınırında kesilirse iş kaybolmaz: mesajlar kuyrukta kalır, sonraki tur devam eder.
 */
export async function runCampaignWorker(now = new Date()): Promise<WorkerReport> {
  const recovered = await recoverMessages(now);
  const scheduled = await startScheduled(now);
  const resumable = await unfinishedCampaigns(scheduled);

  for (const campaignId of [...scheduled, ...resumable]) {
    try {
      await processCampaign(campaignId);
    } catch (error) {
      console.error("[campaign-worker] kampanya işlenemedi", campaignId, error);
    }
  }

  // Süresi dolmuş istek sayaçları bu turda temizlenir (ayrı bir zamanlayıcı gerekmesin).
  await pruneRateLimitCounters(now).catch(() => undefined);
  await prunePhoneVerifications(now).catch(() => undefined);

  return {
    startedScheduled: scheduled.length,
    resumedCampaigns: resumable.length,
    requeuedMessages: recovered.requeued,
    abandonedMessages: recovered.abandoned,
  };
}
