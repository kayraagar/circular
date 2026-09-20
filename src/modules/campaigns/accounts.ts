import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanText, formatPhone, normalizePhone } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";
import { embeddedSignupReady, manualConnectAllowed, metaConfig, webhookUrl } from "./config";
import { getIysGateway } from "./iys";
import { MAX_TEST_RECIPIENTS } from "./rules";
import { open, seal } from "./secret-box";
import { GraphError, exchangeSignupCode, getPhoneNumber, registerPhoneNumber, subscribeAppToWaba } from "./whatsapp-api";

/**
 * İşletmenin WhatsApp numarası, test numaraları ve kullanım sayaçları.
 * - Numara bağlama/ayırma: yalnızca işletme sahibi (whatsapp.connect).
 * - Test numaraları ve görüntüleme: kampanya yetkisi olanlar (campaigns.manage).
 */

export type WhatsAppAccountView = {
  id: string;
  status: "ACTIVE" | "DISCONNECTED";
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  connectionMethod: string;
  wabaId: string;
  phoneNumberId: string;
  connectedAt: Date;
  disconnectedAt: Date | null;
  /** Token çözülemiyorsa (anahtar değişmiş) numara yeniden bağlanmalıdır. */
  tokenUsable: boolean;
};

function toView(a: {
  id: string;
  status: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  connectionMethod: string;
  wabaId: string;
  phoneNumberId: string;
  connectedAt: Date;
  disconnectedAt: Date | null;
  accessTokenEnc: string | null;
}): WhatsAppAccountView {
  return {
    id: a.id,
    status: a.status === "ACTIVE" ? "ACTIVE" : "DISCONNECTED",
    displayPhoneNumber: a.displayPhoneNumber,
    verifiedName: a.verifiedName,
    qualityRating: a.qualityRating,
    connectionMethod: a.connectionMethod,
    wabaId: a.wabaId,
    phoneNumberId: a.phoneNumberId,
    connectedAt: a.connectedAt,
    disconnectedAt: a.disconnectedAt,
    tokenUsable: a.status === "ACTIVE" && open(a.accessTokenEnc) !== null,
  };
}

/** Gönderim için: aktif numara ve çözülmüş token. Yoksa null. */
export async function loadSendingAccount(tenantId: string) {
  const account = await db.whatsAppAccount.findUnique({ where: { tenantId } });
  if (!account || account.status !== "ACTIVE") return null;
  const token = open(account.accessTokenEnc);
  if (!token) return null;
  return { account, token };
}

export async function getWhatsAppAccount(ctx: ServiceContext): Promise<WhatsAppAccountView | null> {
  assertCan(ctx, "campaigns.manage");
  const account = await db.whatsAppAccount.findUnique({ where: { tenantId: ctx.tenantId } });
  return account ? toView(account) : null;
}

const monthStart = (now: Date) => new Date(now.getFullYear(), now.getMonth(), 1);

/** Kanal ekranı: bağlantı, kurulum durumu, test numaraları ve bu ayki kullanım. */
export async function getChannelOverview(ctx: ServiceContext, now = new Date()) {
  assertCan(ctx, "campaigns.manage");
  const since = monthStart(now);
  const [account, testRecipients, usageRows] = await Promise.all([
    db.whatsAppAccount.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.messagingTestRecipient.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } }),
    db.campaignMessage.groupBy({
      by: ["status", "billable"],
      where: { tenantId: ctx.tenantId, acceptedAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  const count = (pred: (r: (typeof usageRows)[number]) => boolean) => usageRows.filter(pred).reduce((n, r) => n + r._count._all, 0);
  const config = metaConfig();
  const iys = getIysGateway();

  return {
    account: account ? toView(account) : null,
    setup: {
      embeddedSignupReady: embeddedSignupReady(),
      manualConnectAllowed: manualConnectAllowed(),
      appId: config.appId,
      configId: config.configId,
      graphVersion: config.graphVersion,
      webhookUrl: webhookUrl(),
      webhookReady: Boolean(config.appSecret && config.webhookVerifyToken),
    },
    iys: { configured: iys.configured, name: iys.name },
    testRecipients: testRecipients.map((r) => ({ id: r.id, phone: r.phone, phoneLabel: formatPhone(r.phone), label: r.label })),
    usage: {
      since,
      /** Meta'nın kabul ettiği (mesaj kimliği verdiği) mesajlar */
      accepted: count(() => true),
      delivered: count((r) => r.status === "DELIVERED" || r.status === "READ"),
      failed: count((r) => r.status === "FAILED"),
      /** Meta'nın durum bildiriminde ücretli olarak işaretlediği mesajlar */
      billable: count((r) => r.billable === true),
    },
  };
}

// ─────────────────────────────────────────────── Bağlama

type ConnectedPhone = { wabaId: string; phoneNumberId: string; token: string; pin: string | null; method: "EMBEDDED_SIGNUP" | "MANUAL" };

function graphToConflict(error: unknown): never {
  if (error instanceof GraphError) throw new ConflictError(`Meta: ${error.message}`, "META_ERROR", { metaCode: error.code });
  throw error;
}

async function saveConnection(ctx: ServiceContext, input: ConnectedPhone) {
  const info = await getPhoneNumber(input.phoneNumberId, input.token).catch(graphToConflict);

  const owner = await db.whatsAppAccount.findUnique({ where: { phoneNumberId: input.phoneNumberId }, select: { tenantId: true } });
  if (owner && owner.tenantId !== ctx.tenantId) {
    throw new ConflictError("Bu WhatsApp numarası başka bir işletmeye bağlı. Circular destek ekibiyle iletişime geçin.", "PHONE_IN_USE");
  }

  const now = new Date();
  const data = {
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayPhoneNumber: info.displayPhoneNumber,
    verifiedName: info.verifiedName,
    qualityRating: info.qualityRating,
    connectionMethod: input.method,
    status: "ACTIVE",
    accessTokenEnc: seal(input.token),
    registrationPinEnc: input.pin ? seal(input.pin) : null,
    connectedByUserId: ctx.userId,
    connectedAt: now,
    disconnectedAt: null,
    lastSyncedAt: now,
  };

  return db.$transaction(async (tx) => {
    const account = await tx.whatsAppAccount.upsert({
      where: { tenantId: ctx.tenantId },
      create: { tenantId: ctx.tenantId, ...data },
      update: data,
    });
    await logActivity(tx, ctx, {
      action: "whatsapp.connected",
      entityType: "whatsapp",
      entityId: account.id,
      metadata: { displayPhoneNumber: info.displayPhoneNumber, method: input.method },
    });
    return toView(account);
  });
}

const metaId = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, `${label} yalnızca rakamlardan oluşur.`);

const manualSchema = z.object({
  wabaId: metaId("WhatsApp Business hesap kimliği"),
  phoneNumberId: metaId("Telefon numarası kimliği"),
  accessToken: z.string().trim().min(20, "Erişim token'ını yapıştırın.").max(1000, "Token çok uzun."),
});

/** Geliştirme: Meta'nın test numarasını kimlikleri ve token'ı girerek bağlar (WHATSAPP_MANUAL_CONNECT=true). */
export async function connectWhatsAppManually(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "whatsapp.connect");
  if (!manualConnectAllowed()) throw new ConflictError("Elle bağlantı bu ortamda kapalı.", "MANUAL_CONNECT_DISABLED");
  const parsed = manualSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  return saveConnection(ctx, { wabaId: v.wabaId, phoneNumberId: v.phoneNumberId, token: v.accessToken, pin: null, method: "MANUAL" });
}

const signupSchema = z.object({
  code: z.string().trim().min(10).max(2000),
  wabaId: metaId("WhatsApp Business hesap kimliği"),
  phoneNumberId: metaId("Telefon numarası kimliği"),
});

/**
 * Embedded Signup tamamlandı: kodu token'a çevirir, uygulamayı hesabın bildirimlerine abone eder,
 * numarayı Cloud API'ye kaydeder ve bağlantıyı kaydeder. Herhangi bir adım başarısızsa hiçbir şey kaydedilmez.
 */
export async function completeEmbeddedSignup(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "whatsapp.connect");
  if (!embeddedSignupReady()) throw new ConflictError("Circular'ın Meta uygulaması henüz yapılandırılmadı.", "META_NOT_CONFIGURED");
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) throw new ConflictError("Meta bağlantı bilgileri eksik geldi. Lütfen tekrar deneyin.", "SIGNUP_INCOMPLETE");
  const v = parsed.data;

  const token = await exchangeSignupCode(v.code).catch(graphToConflict);
  await subscribeAppToWaba(v.wabaId, token).catch(graphToConflict);
  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await registerPhoneNumber(v.phoneNumberId, token, pin).catch(graphToConflict);
  return saveConnection(ctx, { wabaId: v.wabaId, phoneNumberId: v.phoneNumberId, token, pin, method: "EMBEDDED_SIGNUP" });
}

/** Bağlantıyı keser: token silinir, gönderimler durur; kampanya geçmişi korunur. */
export async function disconnectWhatsApp(ctx: ServiceContext) {
  assertCan(ctx, "whatsapp.connect");
  const account = await db.whatsAppAccount.findUnique({ where: { tenantId: ctx.tenantId } });
  if (!account || account.status !== "ACTIVE") throw new NotFoundError("Bağlı WhatsApp numarası yok.");
  await db.$transaction(async (tx) => {
    await tx.whatsAppAccount.update({
      where: { id: account.id },
      data: { status: "DISCONNECTED", accessTokenEnc: null, registrationPinEnc: null, disconnectedAt: new Date() },
    });
    await logActivity(tx, ctx, {
      action: "whatsapp.disconnected",
      entityType: "whatsapp",
      entityId: account.id,
      metadata: { displayPhoneNumber: account.displayPhoneNumber },
    });
  });
}

// ─────────────────────────────────────────────── Test numaraları

export async function addTestRecipient(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "campaigns.manage");
  const label = cleanText(String(raw.label ?? "")).slice(0, 60);
  const phone = normalizePhone(String(raw.phone ?? ""));
  const errors: Record<string, string[]> = {};
  if (label.length < 2) errors.label = ["Numaranın kime ait olduğunu yazın."];
  if (!phone) errors.phone = ["Telefon numarasını yazın."];
  else if (!phone.ok) errors.phone = ["Geçerli bir telefon numarası girin."];
  if (raw.confirmed !== "on" && raw.confirmed !== true) errors.confirmed = ["Numara sahibinin test mesajı almayı kabul ettiğini onaylayın."];
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const count = await db.messagingTestRecipient.count({ where: { tenantId: ctx.tenantId } });
  if (count >= MAX_TEST_RECIPIENTS) throw new ConflictError(`En fazla ${MAX_TEST_RECIPIENTS} test numarası eklenebilir.`, "TEST_LIMIT");
  const e164 = (phone as { ok: true; e164: string }).e164;
  const exists = await db.messagingTestRecipient.findUnique({ where: { tenantId_phone: { tenantId: ctx.tenantId, phone: e164 } } });
  if (exists) throw new ValidationError({ phone: ["Bu numara zaten test listesinde."] });
  return db.messagingTestRecipient.create({ data: { tenantId: ctx.tenantId, phone: e164, label, createdByUserId: ctx.userId } });
}

export async function removeTestRecipient(ctx: ServiceContext, id: string) {
  assertCan(ctx, "campaigns.manage");
  const { count } = await db.messagingTestRecipient.deleteMany({ where: { id, tenantId: ctx.tenantId } });
  if (count === 0) throw new NotFoundError("Test numarası bulunamadı.");
}
