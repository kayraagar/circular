import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText, foldText } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";
import { loadSendableCustomers, parseAudience, summarizeAudience } from "./audience";
import { channelSecretReady } from "./config";
import { NETGSM_CONFIG_ERRORS, NetgsmError, listHeaders, sendSms, smsReport, toNetgsmNumber, type NetgsmCredentials } from "./netgsm-api";
import { claimBatch, completeIfDone, failMessages, firstNamesFor, recheckRecipients, skipMessage } from "./queue";
import { NAME_VARIABLE, SMS_LIMITS, composeSms, smsSegments, templateVariables, type ExclusionReason } from "./rules";
import { open, seal } from "./secret-box";

/**
 * SMS kampanyaları (Netgsm).
 * - Her işletmenin kendi Netgsm hesabı/alt hesabı, onaylı başlığı ve İYS markası vardır; kurulumu işletme sahibi yapar.
 * - Canlı gönderim "iysfilter=11" ile yapılır: Netgsm İYS iş ortağı olarak İYS'de onayı olmayan numaraya iletmez.
 * - Her ticari SMS'in sonuna işletmenin yasal bilgisi (unvan/MERSIS ve 0800 ret bilgisi) eklenir.
 * - Gönderim anında müşterinin SMS izni ve arşiv durumu yeniden kontrol edilir.
 */

const SMS_BATCH = 100;

export type SmsAccountView = {
  status: "ACTIVE" | "DISCONNECTED";
  username: string;
  msgheader: string;
  legalFooter: string;
  connectedAt: Date;
  passwordUsable: boolean;
};

async function loadSmsAccount(tenantId: string) {
  const account = await db.smsAccount.findUnique({ where: { tenantId } });
  if (!account || account.status !== "ACTIVE") return null;
  const password = open(account.passwordEnc);
  if (!password) return null;
  return { account, creds: { username: account.username, password } satisfies NetgsmCredentials };
}

export async function getSmsAccount(ctx: ServiceContext): Promise<SmsAccountView | null> {
  assertCan(ctx, "campaigns.manage");
  const a = await db.smsAccount.findUnique({ where: { tenantId: ctx.tenantId } });
  if (!a) return null;
  return {
    status: a.status === "ACTIVE" ? "ACTIVE" : "DISCONNECTED",
    username: a.username,
    msgheader: a.msgheader,
    legalFooter: a.legalFooter,
    connectedAt: a.connectedAt,
    passwordUsable: a.status === "ACTIVE" && open(a.passwordEnc) !== null,
  };
}

const connectSchema = z.object({
  username: z.string().trim().regex(/^[0-9A-Za-z._-]{3,40}$/, "Netgsm kullanıcı adını (abone numarası) yazın."),
  password: z.string().max(200),
  msgheader: z.string().trim().min(2, "Onaylı SMS başlığını yazın.").max(SMS_LIMITS.header, `Başlık en fazla ${SMS_LIMITS.header} karakterdir.`),
  legalFooter: z
    .string()
    .transform((v) => cleanText(v))
    .pipe(z.string().min(20, "Ticari SMS'te zorunlu bilgiyi yazın: unvan/MERSIS ve 0800 ret bilgisi.").max(SMS_LIMITS.footer, `En fazla ${SMS_LIMITS.footer} karakter.`)),
});

/**
 * Netgsm hesabını bağlar veya ayarlarını günceller. Şifre boş bırakılırsa kayıtlı şifre kullanılır.
 * Kimlik bilgileri ve başlık Netgsm'den doğrulanır: başlık hesapta onaylı olmalıdır.
 */
export async function connectSms(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "channels.connect");
  if (!channelSecretReady()) throw new ConflictError("Sunucuda CHANNEL_TOKEN_SECRET tanımlı değil.", "CHANNEL_SECRET_MISSING");
  const parsed = connectSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;

  const existing = await db.smsAccount.findUnique({ where: { tenantId: ctx.tenantId } });
  const password = v.password || (existing?.username === v.username ? open(existing.passwordEnc) : null);
  if (!password) throw new ValidationError({ password: ["Netgsm API alt kullanıcısının şifresini yazın."] });

  let headers: string[];
  try {
    headers = await listHeaders({ username: v.username, password });
  } catch (error) {
    if (error instanceof NetgsmError) throw new ConflictError(`Netgsm: ${error.message}`, "NETGSM_ERROR");
    throw error;
  }
  // Türkçe büyük/küçük harf kuralından bağımsız karşılaştırma ("orbita" ↔ "ORBITA", İ/I farkı yok sayılır)
  const header = headers.find((h) => foldText(h) === foldText(v.msgheader));
  if (!header) {
    throw new ValidationError({
      msgheader: [headers.length ? `Bu başlık hesapta onaylı değil. Onaylı başlıklar: ${headers.join(", ")}` : "Netgsm hesabında onaylı başlık yok."],
    });
  }

  const now = new Date();
  const data = {
    provider: "NETGSM",
    username: v.username,
    passwordEnc: seal(password),
    msgheader: header,
    legalFooter: v.legalFooter,
    status: "ACTIVE",
    connectedByUserId: ctx.userId,
    connectedAt: existing?.status === "ACTIVE" ? existing.connectedAt : now,
    disconnectedAt: null,
  };
  return db.$transaction(async (tx) => {
    const account = await tx.smsAccount.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
    await logActivity(tx, ctx, { action: "sms.connected", entityType: "sms", entityId: account.id, metadata: { msgheader: header } });
    return account;
  });
}

export async function disconnectSms(ctx: ServiceContext) {
  assertCan(ctx, "channels.connect");
  const account = await db.smsAccount.findUnique({ where: { tenantId: ctx.tenantId } });
  if (!account || account.status !== "ACTIVE") throw new NotFoundError("Bağlı SMS hesabı yok.");
  await db.$transaction(async (tx) => {
    await tx.smsAccount.update({ where: { id: account.id }, data: { status: "DISCONNECTED", passwordEnc: null, disconnectedAt: new Date() } });
    await logActivity(tx, ctx, { action: "sms.disconnected", entityType: "sms", entityId: account.id, metadata: { msgheader: account.msgheader } });
  });
}

/** Canlı SMS gönderimini engelleyen durum (yoksa null). */
export async function smsSendBlock(tenantId: string): Promise<{ code: "NO_SMS_ACCOUNT"; message: string } | null> {
  const loaded = await loadSmsAccount(tenantId);
  if (!loaded) return { code: "NO_SMS_ACCOUNT", message: "Netgsm SMS hesabı bağlı değil." };
  return null;
}

export function validateSmsBody(raw: unknown): string {
  const body = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const errors: FieldErrors = {};
  if (body.length < 5) errors.body = ["SMS metnini yazın."];
  else if (body.length > SMS_LIMITS.body) errors.body = [`SMS metni en fazla ${SMS_LIMITS.body} karakter olabilir.`];
  else if (templateVariables(body).some((v) => v !== NAME_VARIABLE) || /[{}]/.test(body.replace(/\{\{\s*ad\s*\}\}/g, ""))) {
    errors.body = [`Yalnızca {{${NAME_VARIABLE}}} değişkeni kullanılabilir.`];
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return body;
}

function campaignName(raw: unknown, fallback: string) {
  const name = cleanText(typeof raw === "string" ? raw : "").slice(0, 80);
  return name.length >= 2 ? name : fallback;
}

/** Ekibin test numaralarına (yalnızca Türkiye) SMS gönderir; metnin başına "TEST:" eklenir. */
export async function startSmsTest(ctx: ServiceContext, raw: { body: unknown; name?: unknown }) {
  assertCan(ctx, "campaigns.manage");
  const body = validateSmsBody(raw.body);
  if (!(await loadSmsAccount(ctx.tenantId))) throw new ConflictError("Test gönderimi için önce Netgsm SMS hesabını bağlayın.", "NO_SMS_ACCOUNT");
  const recipients = (await db.messagingTestRecipient.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } })).filter((r) =>
    r.phone.startsWith("+90"),
  );
  if (recipients.length === 0) throw new ConflictError("Önce WhatsApp ekranından Türkiye numarası olan bir test numarası ekleyin.", "NO_TEST_RECIPIENTS");

  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        tenantId: ctx.tenantId,
        channel: "SMS",
        mode: "TEST",
        name: campaignName(raw.name, "Test · SMS"),
        body,
        audienceKind: "TEST_NUMBERS",
        audienceLabel: `${recipients.length} test numarası`,
        recipientCount: recipients.length,
        createdByUserId: ctx.userId,
      },
    });
    await tx.campaignMessage.createMany({ data: recipients.map((r) => ({ tenantId: ctx.tenantId, campaignId: campaign.id, toPhone: r.phone })) });
    await logActivity(tx, ctx, { action: "campaign.test_sent", entityType: "campaign", entityId: campaign.id, metadata: { name: campaign.name, recipientCount: recipients.length, channel: "SMS" } });
    return campaign;
  });
}

export async function startSmsCampaign(ctx: ServiceContext, raw: { audience: unknown; body: unknown; name?: unknown }, now = new Date()) {
  assertCan(ctx, "campaigns.manage");
  const body = validateSmsBody(raw.body);
  const block = await smsSendBlock(ctx.tenantId);
  if (block) throw new ConflictError(block.message, block.code);
  const spec = parseAudience(raw.audience);
  const [summary, list] = await Promise.all([summarizeAudience(ctx, spec, now, "SMS"), loadSendableCustomers(ctx, spec, now, "SMS")]);
  if (list.customers.length === 0) throw new ConflictError("Bu kitlede SMS gönderimine uygun kişi yok.", "EMPTY_AUDIENCE");
  const excluded = Object.values(summary.exclusions).reduce((a, b) => a + (b ?? 0), 0);

  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        tenantId: ctx.tenantId,
        channel: "SMS",
        mode: "LIVE",
        name: campaignName(raw.name, list.label),
        body,
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
      data: list.customers.map((c) => ({ tenantId: ctx.tenantId, campaignId: campaign.id, customerId: c.id, toPhone: c.phone })),
    });
    await logActivity(tx, ctx, {
      action: "campaign.sent",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { name: campaign.name, recipientCount: list.customers.length, audienceLabel: list.label, channel: "SMS" },
    });
    return campaign;
  });
}

/** SMS kuyruğunu işler: 100'lük gruplar halinde, her kişiye kendi (kişiselleştirilmiş) metni. */
export async function processSmsCampaign(campaign: { id: string; tenantId: string; mode: string; body: string | null }) {
  const loaded = await loadSmsAccount(campaign.tenantId);
  const isTest = campaign.mode === "TEST";
  const testLabels = isTest
    ? new Map((await db.messagingTestRecipient.findMany({ where: { tenantId: campaign.tenantId } })).map((r) => [r.phone, r.label]))
    : null;

  for (;;) {
    const batch = await claimBatch(campaign.id, SMS_BATCH);
    if (batch === null) break;
    if (batch.length === 0) continue;
    if (!loaded || !campaign.body) {
      await failMessages(batch.map((m) => m.id), "ACCOUNT_DISCONNECTED", "Netgsm SMS hesabı bağlı değil.");
      continue;
    }

    const reasons = isTest ? new Map<string, ExclusionReason>() : await recheckRecipients(campaign.tenantId, batch, "SMS");
    const names = isTest ? new Map<string, string>() : await firstNamesFor(batch);
    const ready = [];
    for (const m of batch) {
      const reason = reasons.get(m.id) ?? (!m.toPhone?.startsWith("+90") ? "FOREIGN_NUMBER" : undefined);
      if (reason) await skipMessage(m.id, reason);
      else ready.push(m as typeof m & { toPhone: string });
    }
    if (ready.length === 0) continue;

    const messages = ready.map((m) => {
      const firstName = isTest ? (testLabels?.get(m.toPhone) ?? "").split(" ")[0] || "Merhaba" : names.get(m.customerId ?? "") || "Değerli misafirimiz";
      return { msg: composeSms(campaign.body!, loaded.account.legalFooter, firstName, { test: isTest }), no: toNetgsmNumber(m.toPhone) };
    });
    try {
      const { jobid } = await sendSms(loaded.creds, { msgheader: loaded.account.msgheader, messages, iysfilter: isTest ? "0" : "11" });
      await db.campaignMessage.updateMany({
        where: { id: { in: ready.map((m) => m.id) } },
        data: { status: "ACCEPTED", providerMessageId: jobid, acceptedAt: new Date() },
      });
    } catch (error) {
      const e = error instanceof NetgsmError ? error : new NetgsmError("Beklenmeyen gönderim hatası.", "UNKNOWN");
      if (!(error instanceof NetgsmError)) console.error("[sms] gönderim hatası", error);
      await failMessages(ready.map((m) => m.id), `NETGSM_${e.code}`, e.message);
      // Hesap ayarı hatasında kalan mesajlar da aynı hatayla düşer; tekrar tekrar denenmez.
      if (NETGSM_CONFIG_ERRORS.has(e.code)) {
        const rest = await db.campaignMessage.findMany({ where: { campaignId: campaign.id, status: "QUEUED" }, select: { id: true } });
        await failMessages(rest.map((m) => m.id), `NETGSM_${e.code}`, e.message);
      }
    }
  }
  await completeIfDone(campaign.id);
}

/** Netgsm rapor durumları → Circular durumları. */
const REPORT_FAILURES: Record<number, string> = {
  2: "Zaman aşımı: telefona ulaştırılamadı.",
  3: "Geçersiz veya kısıtlı numara.",
  4: "Operatöre gönderilemedi.",
  11: "Operatör mesajı kabul etmedi.",
  12: "İletim hatası.",
  13: "Mükerrer gönderim.",
  14: "Netgsm hesabında yetersiz bakiye.",
  15: "Numara kara listede.",
  17: "İYS sorgusu yapılamadı.",
};

/** Teslim durumlarını Netgsm raporundan günceller (Netgsm dakikada en fazla 10 sorguya izin verir). */
export async function refreshSmsStatuses(ctx: ServiceContext, campaignId: string) {
  assertCan(ctx, "campaigns.manage");
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId: ctx.tenantId, channel: "SMS" }, select: { id: true } });
  if (!campaign) throw new NotFoundError("Kampanya bulunamadı.");
  const loaded = await loadSmsAccount(ctx.tenantId);
  if (!loaded) throw new ConflictError("Netgsm SMS hesabı bağlı değil.", "NO_SMS_ACCOUNT");

  const pending = await db.campaignMessage.findMany({
    where: { campaignId, status: { in: ["ACCEPTED", "SENT"] }, providerMessageId: { not: null } },
    select: { id: true, toPhone: true, providerMessageId: true },
  });
  const jobids = [...new Set(pending.map((m) => m.providerMessageId!))];
  if (jobids.length === 0) return { updated: 0 };

  let jobs;
  try {
    jobs = await smsReport(loaded.creds, jobids);
  } catch (error) {
    if (error instanceof NetgsmError) throw new ConflictError(`Netgsm: ${error.message}`, "NETGSM_ERROR");
    throw error;
  }
  const last10 = (n: string | null) => (n ?? "").replace(/\D/g, "").slice(-10);
  const byKey = new Map(jobs.map((j) => [`${j.jobid}:${last10(j.number)}`, j]));
  let updated = 0;
  const now = new Date();
  for (const m of pending) {
    const job = byKey.get(`${m.providerMessageId}:${last10(m.toPhone)}`);
    if (!job || job.status === 0) continue;
    if (job.status === 1) {
      await db.campaignMessage.update({ where: { id: m.id }, data: { status: "DELIVERED", sentAt: now, deliveredAt: now } });
    } else if (job.status === 16) {
      await db.campaignMessage.update({ where: { id: m.id }, data: { status: "SKIPPED", skipReason: "IYS_NOT_APPROVED" } });
    } else {
      await db.campaignMessage.update({
        where: { id: m.id },
        data: { status: "FAILED", errorCode: `SMS_${job.status}`, errorMessage: REPORT_FAILURES[job.status] ?? `Netgsm durum kodu ${job.status}.`, failedAt: now },
      });
    }
    updated++;
  }
  return { updated };
}

/** Önizleme için yaklaşık SMS adedi (yasal alt bilgi dahil, örnek adla). */
export function estimateSmsCredits(body: string, footer: string, recipients: number) {
  const { segments, unicode } = smsSegments(composeSms(body, footer, "Ayşe"));
  return { segments, unicode, credits: segments * recipients };
}
