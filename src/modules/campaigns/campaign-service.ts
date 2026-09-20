import "server-only";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanText, formatPhone, fullName } from "@/lib/normalize";
import { isOneOf } from "@/lib/domain";
import { logActivity } from "@/modules/activity/service";
import { loadSendingAccount } from "./accounts";
import { loadSendableCustomers, parseAudience, summarizeAudience, type AudienceSpec, type AudienceSummary } from "./audience";
import { getIysGateway } from "./iys";
import { CONCURRENCY, claimBatch, completeIfDone, failMessages, firstNamesFor, recheckRecipients, runLimited, skipMessage, type Claimed } from "./queue";
import { processSmsCampaign, smsSendBlock } from "./sms-service";
import { emailSendBlock, processEmailCampaign } from "./email-service";
import {
  CAMPAIGN_CHANNELS,
  EXCLUSION_REASONS,
  MARKETING_RATE_AS_OF,
  MESSAGE_STATUSES,
  OPT_OUT_PAYLOAD,
  STUCK_SENDING_MS,
  estimateCostMicroUsd,
  usesNameVariable,
  type CampaignChannel,
  type ExclusionReason,
  type MessageStatus,
  type StatusCounts,
} from "./rules";
import { GraphError, sendTemplateMessage } from "./whatsapp-api";

/**
 * WhatsApp kampanyası: önizleme, test gönderimi, canlı gönderim ve gönderim kuyruğu.
 * - Canlı gönderim İYS entegratörü bağlı değilse kapalıdır (işletme kararı + mevzuat).
 * - Gönderim anında her kişi için izin ve arşiv durumu yeniden kontrol edilir; İYS toplu olarak sorgulanır.
 * - Meta'ya iletilip iletilmediği bilinmeyen mesaj (SENDING'de kalan) tekrar gönderilmez.
 */

export type SendBlock = { code: string; message: string } | null;

async function loadUsableTemplate(tenantId: string, templateId: string, wabaId: string) {
  const template = await db.messageTemplate.findFirst({ where: { id: templateId, tenantId } });
  if (!template) throw new NotFoundError("Şablon bulunamadı.");
  if (template.wabaId !== wabaId) throw new ConflictError("Bu şablon şu an bağlı WhatsApp hesabında değil.", "TEMPLATE_OTHER_ACCOUNT");
  if (template.status !== "APPROVED") throw new ConflictError("Yalnızca Meta'nın onayladığı şablonla gönderim yapılabilir.", "TEMPLATE_NOT_APPROVED");
  return template;
}

// ─────────────────────────────────────────────── Önizleme

export type CampaignPreview = AudienceSummary & {
  estimatedCostMicroUsd: number;
  rateAsOf: string;
  liveBlock: SendBlock;
  testRecipientCount: number;
};

export async function previewCampaign(ctx: ServiceContext, raw: { audience: unknown; channel?: unknown }, now = new Date()): Promise<CampaignPreview> {
  assertCan(ctx, "campaigns.manage");
  const channel: CampaignChannel = isOneOf(CAMPAIGN_CHANNELS, raw.channel) ? raw.channel : "WHATSAPP";
  const spec = parseAudience(raw.audience);
  const [summary, liveBlock, testRecipientCount] = await Promise.all([
    summarizeAudience(ctx, spec, now, channel),
    channelSendBlock(ctx.tenantId, channel),
    channel === "EMAIL"
      ? db.emailTestRecipient.count({ where: { tenantId: ctx.tenantId } })
      : db.messagingTestRecipient.count({ where: { tenantId: ctx.tenantId, ...(channel === "SMS" ? { phone: { startsWith: "+90" } } : {}) } }),
  ]);
  return {
    ...summary,
    estimatedCostMicroUsd: channel === "WHATSAPP" ? estimateCostMicroUsd(summary.sendableTr) : 0,
    rateAsOf: MARKETING_RATE_AS_OF,
    liveBlock,
    testRecipientCount,
  };
}

/** Kanalın canlı gönderimini engelleyen durum. */
async function channelSendBlock(tenantId: string, channel: CampaignChannel): Promise<SendBlock> {
  if (channel === "SMS") return smsSendBlock(tenantId);
  if (channel === "EMAIL") return emailSendBlock(tenantId);
  return liveSendBlock(Boolean(await loadSendingAccount(tenantId)));
}

function liveSendBlock(hasAccount: boolean): SendBlock {
  if (!hasAccount) return { code: "NO_ACCOUNT", message: "WhatsApp numarası bağlı değil." };
  if (!getIysGateway().configured) {
    return { code: "IYS_NOT_CONFIGURED", message: "İYS entegratörü bağlanana kadar müşterilere pazarlama mesajı gönderilmez; test numaralarına gönderebilirsiniz." };
  }
  return null;
}

function campaignName(raw: unknown, fallback: string) {
  const name = cleanText(typeof raw === "string" ? raw : "").slice(0, 80);
  return name.length >= 2 ? name : fallback;
}

// ─────────────────────────────────────────────── Test gönderimi

/** Onaylı şablonu ekibin test numaralarına gönderir ({{ad}} yerine numaranın etiketindeki ilk kelime). */
export async function startTestCampaign(ctx: ServiceContext, raw: { templateId: unknown; name?: unknown }) {
  assertCan(ctx, "campaigns.manage");
  const sending = await loadSendingAccount(ctx.tenantId);
  if (!sending) throw new ConflictError("Test gönderimi için önce WhatsApp numarasını bağlayın.", "NO_ACCOUNT");
  if (typeof raw.templateId !== "string" || !raw.templateId) throw new ValidationError({ templateId: ["Şablon seçin."] });
  const template = await loadUsableTemplate(ctx.tenantId, raw.templateId, sending.account.wabaId);
  const recipients = await db.messagingTestRecipient.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } });
  if (recipients.length === 0) throw new ConflictError("Önce WhatsApp ekranından en az bir test numarası ekleyin.", "NO_TEST_RECIPIENTS");

  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        tenantId: ctx.tenantId,
        mode: "TEST",
        name: campaignName(raw.name, `Test · ${template.name}`),
        templateId: template.id,
        audienceKind: "TEST_NUMBERS",
        audienceLabel: `${recipients.length} test numarası`,
        recipientCount: recipients.length,
        createdByUserId: ctx.userId,
      },
    });
    // İlişkili toplu oluşturma: composite ilişkide iç içe create tenantId kabul etmez
    await tx.campaignMessage.createMany({ data: recipients.map((r) => ({ tenantId: ctx.tenantId, campaignId: campaign.id, toPhone: r.phone })) });
    await logActivity(tx, ctx, {
      action: "campaign.test_sent",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { name: campaign.name, recipientCount: recipients.length },
    });
    return campaign;
  });
}

// ─────────────────────────────────────────────── Canlı gönderim

export async function startLiveCampaign(ctx: ServiceContext, raw: { templateId: unknown; audience: unknown; name?: unknown }, now = new Date()) {
  assertCan(ctx, "campaigns.manage");
  const sending = await loadSendingAccount(ctx.tenantId);
  const block = liveSendBlock(Boolean(sending));
  if (block || !sending) throw new ConflictError(block?.message ?? "WhatsApp numarası bağlı değil.", block?.code ?? "NO_ACCOUNT");
  if (typeof raw.templateId !== "string" || !raw.templateId) throw new ValidationError({ templateId: ["Şablon seçin."] });
  const template = await loadUsableTemplate(ctx.tenantId, raw.templateId, sending.account.wabaId);
  const spec: AudienceSpec = parseAudience(raw.audience);

  const [summary, list] = await Promise.all([summarizeAudience(ctx, spec, now), loadSendableCustomers(ctx, spec, now)]);
  if (list.customers.length === 0) throw new ConflictError("Bu kitlede gönderime uygun kişi yok.", "EMPTY_AUDIENCE");

  const excluded = Object.values(summary.exclusions).reduce((a, b) => a + (b ?? 0), 0);
  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        tenantId: ctx.tenantId,
        mode: "LIVE",
        name: campaignName(raw.name, list.label),
        templateId: template.id,
        audienceKind: spec.kind,
        audienceKey: list.key,
        audienceLabel: list.label,
        recipientCount: list.customers.length,
        excludedCount: excluded,
        exclusionSummary: excluded ? JSON.stringify(summary.exclusions) : null,
        estimatedCostMicroUsd: estimateCostMicroUsd(list.customers.filter((c) => c.phone?.startsWith("+90")).length),
        createdByUserId: ctx.userId,
      },
    });
    await tx.campaignMessage.createMany({
      data: list.customers.map((c) => ({ tenantId: ctx.tenantId, campaignId: campaign.id, customerId: c.id, toPhone: c.phone })),
    });
    await logActivity(tx, ctx, {
      action: "campaign.sent",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { name: campaign.name, recipientCount: list.customers.length, audienceLabel: list.label, templateName: template.name, channel: "WHATSAPP" },
    });
    return campaign;
  });
}

// ─────────────────────────────────────────────── Kuyruk

/** WhatsApp'ta canlı gönderim anı kontrolü: izin/arşiv (ortak) + İYS (entegratör). */
async function recheckWhatsApp(tenantId: string, batch: Claimed[]): Promise<Map<string, ExclusionReason>> {
  const reasons = await recheckRecipients(tenantId, batch, "WHATSAPP");
  const gateway = getIysGateway();
  const pending = batch.filter((m) => !reasons.has(m.id) && m.toPhone);
  if (!gateway.configured) {
    for (const m of pending) reasons.set(m.id, "IYS_NOT_APPROVED");
    return reasons;
  }
  const iys = await gateway.checkMessageConsents(tenantId, pending.map((m) => m.toPhone!));
  for (const m of pending) if (iys.get(m.toPhone!) !== "ONAY") reasons.set(m.id, "IYS_NOT_APPROVED");
  return reasons;
}

/**
 * Kampanyanın sıradaki mesajlarını kanalına göre gönderir. Aynı anda iki kez çalışsa bile her mesaj yalnızca bir kez alınır
 * (QUEUED → SENDING koşullu güncelleme). Sunucu isteği bittikten sonra `after()` ile çağrılır.
 */
export async function processCampaign(campaignId: string) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, include: { template: true } });
  if (!campaign || campaign.status === "COMPLETED") return;
  if (campaign.channel === "SMS") return processSmsCampaign(campaign);
  if (campaign.channel === "EMAIL") return processEmailCampaign(campaign);
  const template = campaign.template;
  const sending = await loadSendingAccount(campaign.tenantId);
  const testLabels =
    campaign.mode === "TEST"
      ? new Map((await db.messagingTestRecipient.findMany({ where: { tenantId: campaign.tenantId } })).map((r) => [r.phone, r.label]))
      : null;
  const withName = template ? usesNameVariable(template.bodyText) : false;

  for (;;) {
    const batch = await claimBatch(campaignId);
    if (batch === null) break;
    if (batch.length === 0) continue;

    if (!template || !sending || sending.account.wabaId !== template.wabaId) {
      await failMessages(batch.map((m) => m.id), "ACCOUNT_DISCONNECTED", "WhatsApp numarası bağlı değil.");
      continue;
    }

    const reasons = campaign.mode === "LIVE" ? await recheckWhatsApp(campaign.tenantId, batch) : new Map<string, ExclusionReason>();
    const firstNames = campaign.mode === "LIVE" && withName ? await firstNamesFor(batch) : null;

    await runLimited(batch, CONCURRENCY, async (m) => {
      const reason = reasons.get(m.id) ?? (m.toPhone ? undefined : "NO_PHONE");
      if (reason) return skipMessage(m.id, reason);
      const to = m.toPhone!;
      const firstName = !withName
        ? null
        : campaign.mode === "TEST"
          ? (testLabels?.get(to) ?? "").split(" ")[0] || "Merhaba"
          : firstNames?.get(m.customerId ?? "") || "Değerli misafirimiz";
      try {
        const { wamid } = await sendTemplateMessage({
          phoneNumberId: sending.account.phoneNumberId,
          token: sending.token,
          to,
          templateName: template.name,
          language: template.language,
          firstName,
          optOutPayload: OPT_OUT_PAYLOAD,
        });
        await db.campaignMessage.update({ where: { id: m.id }, data: { status: "ACCEPTED", wamid, acceptedAt: new Date() } });
      } catch (error) {
        const e = error instanceof GraphError ? error : new GraphError("Beklenmeyen gönderim hatası.", "UNKNOWN", 0);
        if (!(error instanceof GraphError)) console.error("[campaign] gönderim hatası", error);
        await db.campaignMessage.update({
          where: { id: m.id },
          data: { status: "FAILED", errorCode: e.code, errorMessage: e.message, failedAt: new Date() },
        });
      }
    });
  }
  await completeIfDone(campaignId);
}

/** Sunucu yeniden başlarsa sırada kalan mesajlar için "Gönderime devam et". */
export async function assertCanResume(ctx: ServiceContext, campaignId: string) {
  assertCan(ctx, "campaigns.manage");
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId: ctx.tenantId }, select: { id: true, status: true } });
  if (!campaign) throw new NotFoundError("Kampanya bulunamadı.");
  const queued = await db.campaignMessage.count({ where: { campaignId, status: "QUEUED" } });
  if (queued === 0) throw new ConflictError("Sırada bekleyen mesaj yok.", "NOTHING_QUEUED");
  return campaign;
}

// ─────────────────────────────────────────────── Listeleme ve rapor

function emptyCounts(): StatusCounts {
  return Object.fromEntries(MESSAGE_STATUSES.map((s) => [s, 0])) as StatusCounts;
}

export async function listCampaigns(ctx: ServiceContext, opts: { limit?: number } = {}) {
  assertCan(ctx, "campaigns.manage");
  const campaigns = await db.campaign.findMany({
    where: { tenantId: ctx.tenantId },
    include: { template: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 50, 100),
  });
  const grouped = campaigns.length
    ? await db.campaignMessage.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaigns.map((c) => c.id) } }, _count: { _all: true } })
    : [];
  return campaigns.map((c) => {
    const counts = emptyCounts();
    for (const g of grouped) if (g.campaignId === c.id && isOneOf(MESSAGE_STATUSES, g.status)) counts[g.status] = g._count._all;
    return {
      id: c.id,
      name: c.name,
      channel: (isOneOf(CAMPAIGN_CHANNELS, c.channel) ? c.channel : "WHATSAPP") as CampaignChannel,
      mode: c.mode as "LIVE" | "TEST",
      status: c.status as "SENDING" | "COMPLETED",
      audienceLabel: c.audienceLabel,
      templateName: c.template?.name ?? null,
      recipientCount: c.recipientCount,
      createdAt: c.createdAt,
      counts,
    };
  });
}

export async function getCampaignDetail(ctx: ServiceContext, id: string, now = new Date()) {
  assertCan(ctx, "campaigns.manage");
  const campaign = await db.campaign.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: { template: true },
  });
  if (!campaign) throw new NotFoundError("Kampanya bulunamadı.");
  const [grouped, messages, creator, engagement] = await Promise.all([
    db.campaignMessage.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
    db.campaignMessage.findMany({
      where: { campaignId: id },
      include: { customer: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    campaign.createdByUserId ? db.user.findUnique({ where: { id: campaign.createdByUserId }, select: { name: true } }) : null,
    campaign.channel === "EMAIL"
      ? Promise.all([
          db.campaignMessage.count({ where: { campaignId: id, openedAt: { not: null } } }),
          db.campaignMessage.count({ where: { campaignId: id, clickedAt: { not: null } } }),
        ])
      : Promise.resolve(null),
  ]);
  const counts = emptyCounts();
  for (const g of grouped) if (isOneOf(MESSAGE_STATUSES, g.status)) counts[g.status] = g._count._all;
  const testLabels =
    campaign.mode !== "TEST"
      ? new Map<string, string>()
      : campaign.channel === "EMAIL"
        ? new Map((await db.emailTestRecipient.findMany({ where: { tenantId: ctx.tenantId } })).map((r) => [r.email, r.label]))
        : new Map((await db.messagingTestRecipient.findMany({ where: { tenantId: ctx.tenantId } })).map((r) => [r.phone, r.label]));
  const channel: CampaignChannel = isOneOf(CAMPAIGN_CHANNELS, campaign.channel) ? campaign.channel : "WHATSAPP";

  let exclusions: Partial<Record<ExclusionReason, number>> = {};
  try {
    const parsed = campaign.exclusionSummary ? JSON.parse(campaign.exclusionSummary) : {};
    exclusions = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => isOneOf(EXCLUSION_REASONS, k) && typeof v === "number"));
  } catch {
    exclusions = {};
  }

  return {
    id: campaign.id,
    name: campaign.name,
    channel,
    mode: campaign.mode as "LIVE" | "TEST",
    status: campaign.status as "SENDING" | "COMPLETED",
    audienceLabel: campaign.audienceLabel,
    recipientCount: campaign.recipientCount,
    excludedCount: campaign.excludedCount,
    exclusions,
    estimatedCostMicroUsd: campaign.estimatedCostMicroUsd,
    createdAt: campaign.createdAt,
    completedAt: campaign.completedAt,
    createdByName: creator?.name ?? null,
    template: campaign.template
      ? {
          name: campaign.template.name,
          headerText: campaign.template.headerText,
          bodyText: campaign.template.bodyText,
          footerText: campaign.template.footerText,
          optOutLabel: campaign.template.optOutLabel,
        }
      : null,
    content: { subject: campaign.subject, body: campaign.body, ctaLabel: campaign.ctaLabel, ctaUrl: campaign.ctaUrl },
    engagement: engagement ? { opened: engagement[0], clicked: engagement[1] } : null,
    counts,
    stuckSending: messages.filter((m) => m.status === "SENDING" && m.attemptedAt && now.getTime() - m.attemptedAt.getTime() > STUCK_SENDING_MS).length,
    billable: messages.filter((m) => m.billable === true).length,
    messages: messages.map((m) => ({
      id: m.id,
      recipient: m.customer ? fullName(m.customer) : (testLabels.get(m.toEmail ?? m.toPhone ?? "") ?? (channel === "EMAIL" ? "Test adresi" : "Test numarası")),
      customerId: m.customer?.id ?? null,
      phoneLabel: m.toEmail ?? formatPhone(m.toPhone),
      status: (isOneOf(MESSAGE_STATUSES, m.status) ? m.status : "QUEUED") as MessageStatus,
      skipReason: isOneOf(EXCLUSION_REASONS, m.skipReason) ? m.skipReason : null,
      errorMessage: m.errorMessage,
      updatedAt: m.readAt ?? m.deliveredAt ?? m.sentAt ?? m.acceptedAt ?? m.failedAt ?? m.createdAt,
    })),
    truncated: campaign.recipientCount > messages.length,
  };
}
