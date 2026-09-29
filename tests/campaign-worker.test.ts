import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { MAX_ATTEMPTS, failMessages, isRetryableErrorCode } from "@/modules/campaigns/queue";
import { runCampaignWorker } from "@/modules/campaigns/worker";
import { cancelScheduledCampaign, scheduleCampaign } from "@/modules/campaigns/schedule";
import { toLocalInputValue } from "@/lib/datetime";
import { makeTenant, resetDb } from "./helpers";

/**
 * Kalıcı gönderim işçisi ve zamanlanmış kampanya.
 * Testlerde sağlayıcı hesabı bağlı değildir; kuyruk mekaniği ağ olmadan doğrulanır.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

const MINUTE = 60_000;

async function makeCampaign(tenantId: string, status: string, extra: Record<string, unknown> = {}) {
  return db.campaign.create({
    data: {
      tenantId,
      channel: "SMS",
      mode: "LIVE",
      name: "Test kampanyası",
      body: "Merhaba",
      audienceKind: "SEGMENT",
      audienceLabel: "Tüm izinliler",
      recipientCount: 1,
      status,
      ...extra,
    },
  });
}

async function makeMessage(tenantId: string, campaignId: string, data: Record<string, unknown>) {
  return db.campaignMessage.create({
    data: { tenantId, campaignId, toPhone: `+9055500${Math.floor(Math.random() * 90000) + 10000}`, ...data },
  });
}

before(async () => {
  await resetDb();
  A = await makeTenant("wa");
  B = await makeTenant("wb");
});

after(async () => {
  await db.$disconnect();
});

describe("Yeniden denenebilir hatalar", () => {
  test("yalnızca sağlayıcının açıkça reddettiği kodlar tekrarlanır", () => {
    assert.equal(isRetryableErrorCode("429"), true);
    assert.equal(isRetryableErrorCode("503"), true);
    assert.equal(isRetryableErrorCode("NETGSM_80"), true, "kanal öneki ayıklanır");
    assert.equal(isRetryableErrorCode("130429"), true, "Meta hız sınırı");
    // Sonucu bilinmeyen ve kalıcı hatalar tekrarlanmaz.
    assert.equal(isRetryableErrorCode("NETWORK"), false);
    assert.equal(isRetryableErrorCode("UNKNOWN_OUTCOME"), false);
    assert.equal(isRetryableErrorCode("ACCOUNT_DISCONNECTED"), false);
    assert.equal(isRetryableErrorCode("NETGSM_30"), false, "kimlik hatası tekrarlanmaz");
    assert.equal(isRetryableErrorCode(null), false);
  });

  test("failMessages yalnızca tekrarlanabilir hatada bekleme koyar", async () => {
    const campaign = await makeCampaign(A.tenant.id, "SENDING");
    const retryable = await makeMessage(A.tenant.id, campaign.id, { status: "SENDING" });
    const permanent = await makeMessage(A.tenant.id, campaign.id, { status: "SENDING" });

    await failMessages([retryable.id], "NETGSM_100", "Netgsm sistem hatası.");
    await failMessages([permanent.id], "NETGSM_30", "Kimlik hatalı.");

    const [r, p] = await Promise.all([
      db.campaignMessage.findUniqueOrThrow({ where: { id: retryable.id } }),
      db.campaignMessage.findUniqueOrThrow({ where: { id: permanent.id } }),
    ]);
    assert.ok(r.nextAttemptAt, "tekrarlanabilir hata beklemeye alınır");
    assert.equal(p.nextAttemptAt, null, "kalıcı hata tekrarlanmaz");
    assert.equal(r.status, "FAILED");
  });
});

describe("İşçi: askıda kalan mesajlar", () => {
  test("süreç ölünce SENDING'de kalan mesaj 'bilinmiyor' olarak kapanır, tekrar gönderilmez", async () => {
    const campaign = await makeCampaign(A.tenant.id, "SENDING");
    const now = new Date();
    const stuck = await makeMessage(A.tenant.id, campaign.id, {
      status: "SENDING",
      attempts: 1,
      attemptedAt: new Date(now.getTime() - 30 * MINUTE),
    });
    const fresh = await makeMessage(A.tenant.id, campaign.id, { status: "SENDING", attempts: 1, attemptedAt: now });

    const report = await runCampaignWorker(now);
    assert.ok(report.abandonedMessages >= 1);

    const after1 = await db.campaignMessage.findUniqueOrThrow({ where: { id: stuck.id } });
    assert.equal(after1.status, "FAILED");
    assert.equal(after1.errorCode, "UNKNOWN_OUTCOME", "mükerrer gönderim riski nedeniyle otomatik tekrarlanmaz");
    assert.equal(after1.nextAttemptAt, null);

    const after2 = await db.campaignMessage.findUniqueOrThrow({ where: { id: fresh.id } });
    assert.equal(after2.status, "SENDING", "yeni denenen mesaja dokunulmaz");
  });

  test("sağlayıcı reddi beklemesi dolunca mesaj sıraya geri alınır", async () => {
    const campaign = await makeCampaign(A.tenant.id, "SENDING");
    const now = new Date();
    const due = await makeMessage(A.tenant.id, campaign.id, {
      status: "FAILED",
      attempts: 1,
      errorCode: "NETGSM_80",
      nextAttemptAt: new Date(now.getTime() - MINUTE),
    });
    const waiting = await makeMessage(A.tenant.id, campaign.id, {
      status: "FAILED",
      attempts: 1,
      errorCode: "NETGSM_80",
      nextAttemptAt: new Date(now.getTime() + 10 * MINUTE),
    });
    const exhausted = await makeMessage(A.tenant.id, campaign.id, {
      status: "FAILED",
      attempts: MAX_ATTEMPTS,
      errorCode: "NETGSM_80",
      nextAttemptAt: new Date(now.getTime() - MINUTE),
    });

    await runCampaignWorker(now);

    const rows = await db.campaignMessage.findMany({ where: { id: { in: [due.id, waiting.id, exhausted.id] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Sıraya alınan mesaj aynı turda işlendi; hesap bağlı olmadığı için tekrar FAILED olur,
    // ama artık ACCOUNT_DISCONNECTED hatasıyla — yani yeniden denendiği kesin.
    assert.notEqual(byId.get(due.id)!.errorCode, "NETGSM_80", "bekleme dolan mesaj yeniden denendi");
    assert.equal(byId.get(waiting.id)!.status, "FAILED", "beklemesi dolmayan mesaja dokunulmaz");
    assert.equal(byId.get(waiting.id)!.errorCode, "NETGSM_80");
    assert.equal(byId.get(exhausted.id)!.errorCode, "NETGSM_80", "deneme hakkı biten mesaj tekrarlanmaz");
  });
});

describe("Zamanlanmış kampanya", () => {
  test("yalnızca yetkili planlar; geçmiş ve çok ileri tarih reddedilir", async () => {
    const campaign = await makeCampaign(A.tenant.id, "SENDING");
    await makeMessage(A.tenant.id, campaign.id, { status: "QUEUED" });

    await assert.rejects(scheduleCampaign(A.pr, campaign.id, toLocalInputValue(new Date(Date.now() + 864e5))), ForbiddenError);
    await assert.rejects(scheduleCampaign(A.owner, campaign.id, toLocalInputValue(new Date(Date.now() + MINUTE))), ValidationError);
    await assert.rejects(scheduleCampaign(A.owner, campaign.id, toLocalInputValue(new Date(Date.now() + 90 * 864e5))), ValidationError);
    await assert.rejects(scheduleCampaign(A.owner, campaign.id, "olmayan-tarih"), ValidationError);
  });

  test("başka işletmenin kampanyası planlanamaz", async () => {
    const campaign = await makeCampaign(B.tenant.id, "SENDING");
    await assert.rejects(scheduleCampaign(A.owner, campaign.id, toLocalInputValue(new Date(Date.now() + 864e5))));
  });

  test("gönderimi başlamış kampanya planlanamaz", async () => {
    const campaign = await makeCampaign(A.tenant.id, "SENDING");
    await makeMessage(A.tenant.id, campaign.id, { status: "ACCEPTED" });
    await assert.rejects(scheduleCampaign(A.owner, campaign.id, toLocalInputValue(new Date(Date.now() + 864e5))), ConflictError);
  });

  test("test gönderimi planlanamaz", async () => {
    const campaign = await makeCampaign(A.tenant.id, "SENDING", { mode: "TEST" });
    await assert.rejects(scheduleCampaign(A.owner, campaign.id, toLocalInputValue(new Date(Date.now() + 864e5))), ConflictError);
  });

  test("zamanı gelen kampanyayı işçi başlatır, gelmeyene dokunmaz", async () => {
    const soon = await makeCampaign(A.tenant.id, "SCHEDULED", { scheduledAt: new Date(Date.now() - MINUTE) });
    await makeMessage(A.tenant.id, soon.id, { status: "QUEUED" });
    const later = await makeCampaign(A.tenant.id, "SCHEDULED", { scheduledAt: new Date(Date.now() + 3 * 864e5) });
    await makeMessage(A.tenant.id, later.id, { status: "QUEUED" });

    const report = await runCampaignWorker();
    assert.ok(report.startedScheduled >= 1);

    assert.notEqual((await db.campaign.findUniqueOrThrow({ where: { id: soon.id } })).status, "SCHEDULED");
    assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: later.id } })).status, "SCHEDULED");
    assert.equal(
      (await db.campaignMessage.findFirstOrThrow({ where: { campaignId: later.id } })).status,
      "QUEUED",
      "zamanı gelmeyen kampanyanın kuyruğuna dokunulmaz",
    );
  });

  test("planlanan gönderim iptal edilince kampanya ve mesajları silinir", async () => {
    const campaign = await makeCampaign(A.tenant.id, "SCHEDULED", { scheduledAt: new Date(Date.now() + 2 * 864e5) });
    await makeMessage(A.tenant.id, campaign.id, { status: "QUEUED" });

    // Kampanya yetkisi olmayan rol (PR) iptal edemez; CRM yöneticisinin yetkisi vardır.
    await assert.rejects(cancelScheduledCampaign(A.pr, campaign.id), ForbiddenError);
    await cancelScheduledCampaign(A.owner, campaign.id);

    assert.equal(await db.campaign.count({ where: { id: campaign.id } }), 0);
    assert.equal(await db.campaignMessage.count({ where: { campaignId: campaign.id } }), 0);
    const log = await db.activityLog.findFirst({ where: { action: "campaign.schedule_cancelled" } });
    assert.ok(log, "iptal denetim kaydına düşer");
  });

  test("planlanmamış kampanya iptal edilemez", async () => {
    const campaign = await makeCampaign(A.tenant.id, "SENDING");
    await assert.rejects(cancelScheduledCampaign(A.owner, campaign.id), ConflictError);
  });
});
