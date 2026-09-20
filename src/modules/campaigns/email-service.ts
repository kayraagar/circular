import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText, normalizeEmail } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";
import { loadSendableCustomers, parseAudience, summarizeAudience } from "./audience";
import { BrevoError, brevoConfig, brevoReady, isBrevoConfigError, sendEmail } from "./brevo-api";
import { channelSecretReady } from "./config";
import { renderCampaignEmail, type EmailContent } from "./email-template";
import { CONCURRENCY, claimBatch, completeIfDone, failMessages, firstNamesFor, recheckRecipients, runLimited, skipMessage } from "./queue";
import { EMAIL_LIMITS, MAX_TEST_RECIPIENTS, NAME_VARIABLE, templateVariables, type ExclusionReason } from "./rules";
import { revokeEmailConsent, unsubscribeOneClickUrl, unsubscribePageUrl } from "./unsubscribe";

/**
 * E-posta kampanyaları (Brevo).
 * - Gönderim Circular'ın doğrulanmış alan adındaki adresten, işletmenin görünen adıyla yapılır.
 * - Her e-postada işletmenin yasal bilgisi ve "Abonelikten çık" bağlantısı bulunur; tek tıkla çıkış başlığı eklenir.
 * - Gönderim anında müşterinin e-posta izni ve arşiv durumu yeniden kontrol edilir.
 */

const EMAIL_SCHEMA = z.string().trim().toLowerCase().email("Geçerli bir e-posta adresi girin.").max(200);

// ─────────────────────────────────────────────── Ayarlar

export async function getEmailOverview(ctx: ServiceContext) {
  assertCan(ctx, "campaigns.manage");
  const [settings, testRecipients] = await Promise.all([
    db.emailSettings.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.emailTestRecipient.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } }),
  ]);
  const config = brevoConfig();
  return {
    settings: settings ? { senderName: settings.senderName, replyTo: settings.replyTo, legalFooter: settings.legalFooter } : null,
    provider: { ready: brevoReady(), senderEmail: config.senderEmail, webhookReady: Boolean(config.webhookToken) },
    testRecipients: testRecipients.map((r) => ({ id: r.id, email: r.email, label: r.label })),
  };
}

const settingsSchema = z.object({
  senderName: z
    .string()
    .transform((v) => cleanText(v))
    .pipe(z.string().min(2, "Görünen adı yazın.").max(EMAIL_LIMITS.senderName, `En fazla ${EMAIL_LIMITS.senderName} karakter.`)),
  replyTo: z.union([z.literal(""), EMAIL_SCHEMA]),
  legalFooter: z
    .string()
    .transform((v) => cleanText(v))
    .pipe(z.string().min(20, "Ticari e-postada zorunlu tanıtıcı bilgiyi yazın: unvan, adres ve iletişim (MERSIS varsa).").max(EMAIL_LIMITS.footer, `En fazla ${EMAIL_LIMITS.footer} karakter.`)),
});

export async function saveEmailSettings(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "channels.connect");
  const parsed = settingsSchema.safeParse({ senderName: raw.senderName ?? "", replyTo: raw.replyTo ?? "", legalFooter: raw.legalFooter ?? "" });
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  const data = { senderName: v.senderName, replyTo: v.replyTo || null, legalFooter: v.legalFooter, updatedByUserId: ctx.userId };
  return db.$transaction(async (tx) => {
    const settings = await tx.emailSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
    await logActivity(tx, ctx, { action: "email.settings_updated", entityType: "email", entityId: settings.id, metadata: { senderName: v.senderName } });
    return settings;
  });
}

export async function addEmailTestRecipient(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "campaigns.manage");
  const errors: FieldErrors = {};
  const label = cleanText(String(raw.label ?? "")).slice(0, 60);
  const email = EMAIL_SCHEMA.safeParse(String(raw.email ?? ""));
  if (label.length < 2) errors.label = ["Adresin kime ait olduğunu yazın."];
  if (!email.success) errors.email = ["Geçerli bir e-posta adresi girin."];
  if (raw.confirmed !== "on" && raw.confirmed !== true) errors.confirmed = ["Adres sahibinin test e-postası almayı kabul ettiğini onaylayın."];
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const count = await db.emailTestRecipient.count({ where: { tenantId: ctx.tenantId } });
  if (count >= MAX_TEST_RECIPIENTS) throw new ConflictError(`En fazla ${MAX_TEST_RECIPIENTS} test adresi eklenebilir.`, "TEST_LIMIT");
  const address = email.data!;
  const exists = await db.emailTestRecipient.findUnique({ where: { tenantId_email: { tenantId: ctx.tenantId, email: address } } });
  if (exists) throw new ValidationError({ email: ["Bu adres zaten test listesinde."] });
  return db.emailTestRecipient.create({ data: { tenantId: ctx.tenantId, email: address, label, createdByUserId: ctx.userId } });
}

export async function removeEmailTestRecipient(ctx: ServiceContext, id: string) {
  assertCan(ctx, "campaigns.manage");
  const { count } = await db.emailTestRecipient.deleteMany({ where: { id, tenantId: ctx.tenantId } });
  if (count === 0) throw new NotFoundError("Test adresi bulunamadı.");
}

/** Canlı e-posta gönderimini engelleyen durum. */
export async function emailSendBlock(tenantId: string): Promise<{ code: string; message: string } | null> {
  if (!brevoReady() || !channelSecretReady()) return { code: "EMAIL_NOT_CONFIGURED", message: "Circular'ın e-posta servisi (Brevo) henüz yapılandırılmadı." };
  const settings = await db.emailSettings.findUnique({ where: { tenantId }, select: { id: true } });
  if (!settings) return { code: "NO_EMAIL_SETTINGS", message: "E-posta ekranından görünen adı ve yasal bilgiyi kaydedin." };
  return null;
}

// ─────────────────────────────────────────────── İçerik

export function validateEmailContent(raw: Record<string, unknown>): EmailContent {
  const errors: FieldErrors = {};
  const subject = cleanText(String(raw.subject ?? ""));
  const body = String(raw.body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const ctaLabel = cleanText(String(raw.ctaLabel ?? ""));
  const ctaUrl = String(raw.ctaUrl ?? "").trim();
  const onlyName = (text: string) => templateVariables(text).every((v) => v === NAME_VARIABLE) && !/[{}]/.test(text.replace(/\{\{\s*ad\s*\}\}/g, ""));

  if (subject.length < 3) errors.subject = ["E-posta konusunu yazın."];
  else if (subject.length > EMAIL_LIMITS.subject) errors.subject = [`Konu en fazla ${EMAIL_LIMITS.subject} karakter olabilir.`];
  if (body.length < 10) errors.body = ["E-posta metnini yazın (en az 10 karakter)."];
  else if (body.length > EMAIL_LIMITS.body) errors.body = [`Metin en fazla ${EMAIL_LIMITS.body} karakter olabilir.`];
  else if (!onlyName(body)) errors.body = [`Yalnızca {{${NAME_VARIABLE}}} değişkeni kullanılabilir.`];
  if (ctaLabel || ctaUrl) {
    if (ctaLabel.length < 2 || ctaLabel.length > EMAIL_LIMITS.ctaLabel) errors.ctaLabel = [`Düğme metni 2–${EMAIL_LIMITS.ctaLabel} karakter olmalı.`];
    let valid = false;
    try {
      valid = ["https:", "http:"].includes(new URL(ctaUrl).protocol) && ctaUrl.length <= EMAIL_LIMITS.ctaUrl;
    } catch {
      valid = false;
    }
    if (!valid) errors.ctaUrl = ["Düğme bağlantısı https:// ile başlayan geçerli bir adres olmalı."];
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { subject, body, ctaLabel: ctaLabel || null, ctaUrl: ctaUrl || null };
}

function campaignName(raw: unknown, fallback: string) {
  const name = cleanText(typeof raw === "string" ? raw : "").slice(0, 80);
  return name.length >= 2 ? name : fallback;
}

// ─────────────────────────────────────────────── Gönderim

export async function startEmailTest(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "campaigns.manage");
  const content = validateEmailContent(raw);
  const block = await emailSendBlock(ctx.tenantId);
  if (block) throw new ConflictError(block.message, block.code);
  const recipients = await db.emailTestRecipient.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } });
  if (recipients.length === 0) throw new ConflictError("Önce E-posta ekranından en az bir test adresi ekleyin.", "NO_TEST_RECIPIENTS");

  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        tenantId: ctx.tenantId,
        channel: "EMAIL",
        mode: "TEST",
        name: campaignName(raw.name, `Test · ${content.subject}`),
        ...content,
        audienceKind: "TEST_NUMBERS",
        audienceLabel: `${recipients.length} test adresi`,
        recipientCount: recipients.length,
        createdByUserId: ctx.userId,
      },
    });
    await tx.campaignMessage.createMany({ data: recipients.map((r) => ({ tenantId: ctx.tenantId, campaignId: campaign.id, toEmail: r.email })) });
    await logActivity(tx, ctx, { action: "campaign.test_sent", entityType: "campaign", entityId: campaign.id, metadata: { name: campaign.name, recipientCount: recipients.length, channel: "EMAIL" } });
    return campaign;
  });
}

export async function startEmailCampaign(ctx: ServiceContext, raw: Record<string, unknown> & { audience: unknown }, now = new Date()) {
  assertCan(ctx, "campaigns.manage");
  const content = validateEmailContent(raw);
  const block = await emailSendBlock(ctx.tenantId);
  if (block) throw new ConflictError(block.message, block.code);
  const spec = parseAudience(raw.audience);
  const [summary, list] = await Promise.all([summarizeAudience(ctx, spec, now, "EMAIL"), loadSendableCustomers(ctx, spec, now, "EMAIL")]);
  if (list.customers.length === 0) throw new ConflictError("Bu kitlede e-posta gönderimine uygun kişi yok.", "EMPTY_AUDIENCE");
  const excluded = Object.values(summary.exclusions).reduce((a, b) => a + (b ?? 0), 0);

  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        tenantId: ctx.tenantId,
        channel: "EMAIL",
        mode: "LIVE",
        name: campaignName(raw.name, content.subject),
        ...content,
        audienceKind: spec.kind,
        audienceKey: list.key,
        audienceLabel: list.label,
        recipientCount: list.customers.length,
        excludedCount: excluded,
        exclusionSummary: excluded ? JSON.stringify(summary.exclusions) : null,
        createdByUserId: ctx.userId,
      },
    });
    await tx.campaignMessage.createMany({
      data: list.customers.map((c) => ({ tenantId: ctx.tenantId, campaignId: campaign.id, customerId: c.id, toEmail: c.email })),
    });
    await logActivity(tx, ctx, {
      action: "campaign.sent",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { name: campaign.name, recipientCount: list.customers.length, audienceLabel: list.label, channel: "EMAIL" },
    });
    return campaign;
  });
}

export async function processEmailCampaign(campaign: {
  id: string;
  tenantId: string;
  mode: string;
  subject: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
}) {
  const [settings, testLabels] = await Promise.all([
    db.emailSettings.findUnique({ where: { tenantId: campaign.tenantId } }),
    campaign.mode === "TEST"
      ? db.emailTestRecipient.findMany({ where: { tenantId: campaign.tenantId } }).then((rows) => new Map(rows.map((r) => [r.email, r.label])))
      : Promise.resolve(null),
  ]);
  const { senderEmail } = brevoConfig();
  const isTest = campaign.mode === "TEST";
  let stop: { code: string; message: string } | null = null;

  for (;;) {
    const batch = await claimBatch(campaign.id);
    if (batch === null) break;
    if (batch.length === 0) continue;
    if (stop || !settings || !senderEmail || !brevoReady() || !campaign.subject || !campaign.body) {
      const reason = stop ?? { code: "EMAIL_NOT_CONFIGURED", message: "E-posta gönderimi yapılandırılmamış." };
      await failMessages(batch.map((m) => m.id), reason.code, reason.message);
      continue;
    }
    const reasons = isTest ? new Map<string, ExclusionReason>() : await recheckRecipients(campaign.tenantId, batch, "EMAIL");
    const names = isTest ? new Map<string, string>() : await firstNamesFor(batch);

    await runLimited(batch, CONCURRENCY, async (m) => {
      const reason = reasons.get(m.id) ?? (m.toEmail ? undefined : "NO_EMAIL");
      if (reason) return skipMessage(m.id, reason);
      if (stop) return failMessages([m.id], stop.code, stop.message);
      const to = m.toEmail!;
      const firstName = isTest ? (testLabels?.get(to) ?? "").split(" ")[0] || "Merhaba" : names.get(m.customerId ?? "") || "Değerli misafirimiz";
      const html = renderCampaignEmail({
        subject: campaign.subject!,
        body: campaign.body!,
        ctaLabel: campaign.ctaLabel,
        ctaUrl: campaign.ctaUrl,
        senderName: settings.senderName,
        legalFooter: settings.legalFooter,
        firstName,
        unsubscribeUrl: unsubscribePageUrl(m.id),
        test: isTest,
      });
      try {
        const { messageId } = await sendEmail({
          to: { email: to },
          sender: { name: settings.senderName, email: senderEmail },
          replyTo: settings.replyTo,
          subject: isTest ? `[TEST] ${campaign.subject}` : campaign.subject!,
          htmlContent: html,
          headers: {
            "List-Unsubscribe": `<${unsubscribeOneClickUrl(m.id)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          tags: ["circular", isTest ? "test" : "campaign"],
        });
        await db.campaignMessage.update({ where: { id: m.id }, data: { status: "ACCEPTED", providerMessageId: messageId, acceptedAt: new Date() } });
      } catch (error) {
        const e = error instanceof BrevoError ? error : new BrevoError("Beklenmeyen gönderim hatası.", "UNKNOWN", 0);
        if (!(error instanceof BrevoError)) console.error("[email] gönderim hatası", error);
        if (isBrevoConfigError(e)) stop = { code: `BREVO_${e.code}`, message: e.message };
        await failMessages([m.id], `BREVO_${e.code}`, e.message);
      }
    });
  }
  await completeIfDone(campaign.id);
}

// ─────────────────────────────────────────────── Brevo bildirimleri

type BrevoEvent = { event?: string; "message-id"?: string; email?: string; reason?: string; date?: string; ts_event?: number };

/**
 * Brevo işlemsel e-posta bildirimleri: teslim, geri dönme, açılma, tıklama, spam şikâyeti ve abonelikten çıkma.
 * Mesaj Brevo mesaj kimliğiyle eşleşir; eşleşmeyen bildirim yok sayılır.
 */
export async function handleBrevoWebhook(payload: unknown) {
  const events: BrevoEvent[] = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? [payload as BrevoEvent] : [];
  let applied = 0;
  for (const e of events) {
    const messageId = typeof e["message-id"] === "string" ? e["message-id"] : "";
    if (!messageId) continue;
    const message = await db.campaignMessage.findFirst({
      where: { providerMessageId: messageId, campaign: { channel: "EMAIL" } },
      select: { id: true, status: true, tenantId: true, customerId: true, toEmail: true, openedAt: true, clickedAt: true },
    });
    if (!message) continue;
    if (e.email && message.toEmail && normalizeEmail(e.email) !== message.toEmail) continue;
    const at = typeof e.ts_event === "number" ? new Date(e.ts_event * 1000) : new Date();

    switch (e.event) {
      case "request":
        if (message.status === "ACCEPTED") await db.campaignMessage.update({ where: { id: message.id }, data: { status: "SENT", sentAt: at } });
        break;
      case "delivered":
        if (!["DELIVERED", "READ", "FAILED", "SKIPPED"].includes(message.status)) {
          await db.campaignMessage.update({ where: { id: message.id }, data: { status: "DELIVERED", deliveredAt: at } });
        }
        break;
      case "hard_bounce":
      case "invalid_email":
      case "blocked":
      case "error":
        if (message.status !== "DELIVERED" && message.status !== "READ") {
          await db.campaignMessage.update({
            where: { id: message.id },
            data: { status: "FAILED", failedAt: at, errorCode: `BREVO_${e.event}`, errorMessage: (e.reason || "E-posta teslim edilemedi.").slice(0, 300) },
          });
        }
        break;
      case "opened":
      case "unique_opened":
      case "proxy_open":
        if (!message.openedAt) await db.campaignMessage.update({ where: { id: message.id }, data: { openedAt: at } });
        break;
      case "click":
        await db.campaignMessage.update({ where: { id: message.id }, data: { clickedAt: message.clickedAt ?? at, openedAt: message.openedAt ?? at } });
        break;
      case "spam":
      case "unsubscribed":
        if (message.customerId) await revokeEmailConsent(message.tenantId, message.customerId, e.event === "spam" ? "SPAM_COMPLAINT" : "PROVIDER_UNSUBSCRIBE");
        break;
      default:
        continue;
    }
    applied++;
  }
  return { applied };
}
