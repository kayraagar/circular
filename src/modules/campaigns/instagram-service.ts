import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, isUniqueViolation } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { foldText } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";
import { publicMenuPath, signupPath } from "@/modules/menu/campaign";
import { absoluteUrl } from "@/modules/passes/token";
import { channelSecretReady } from "./config";
import {
  InstagramError,
  authorizeUrl,
  exchangeCode,
  exchangeLongLived,
  getMe,
  instagramConfig,
  refreshLongLived,
  sendDirectMessage,
  subscribeMessages,
} from "./instagram-api";
import { open, seal } from "./secret-box";

/**
 * Instagram DM otomasyonu: kişi DM'de anahtar kelime yazınca otomatik yanıt.
 * - Hesabı bağlamak/ayırmak işletme sahibinin işidir (channels.connect); kuralları kampanya yetkisi olanlar yönetir.
 * - Yalnızca kişinin yazdığı mesaja yanıt verilir (Instagram kuralı); toplu gönderim yoktur.
 * - Aynı mesaja iki kez yanıt verilmez; aynı kişiye aynı kural 10 dakika içinde tekrar tetiklenmez.
 * - Instagram kişi kimliği düz saklanmaz (SHA-256 özeti).
 */

export const RULE_LIMITS = { keywords: 10, keyword: 40, reply: 900 };
export const REPLY_COOLDOWN_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** Anahtar kelime karşılaştırması için: Türkçe katlanmış, noktalama temizlenmiş. */
export function normalizeKeyword(text: string): string {
  return foldText(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

// ─────────────────────────────────────────────── Hesap

type AccountRow = { id: string; tenantId: string; igUserId: string; accessTokenEnc: string | null; tokenExpiresAt: Date | null; status: string };

/** Token'ı çözer; süresi 7 günden az kaldıysa yeniler. Kullanılamıyorsa null. */
async function usableToken(account: AccountRow, now = new Date()): Promise<string | null> {
  if (account.status !== "ACTIVE") return null;
  const token = open(account.accessTokenEnc);
  if (!token) return null;
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() - now.getTime() < TOKEN_REFRESH_WINDOW_MS) {
    try {
      const fresh = await refreshLongLived(token);
      await db.instagramAccount.update({
        where: { id: account.id },
        data: { accessTokenEnc: seal(fresh.accessToken), tokenExpiresAt: fresh.expiresIn ? new Date(now.getTime() + fresh.expiresIn * 1000) : null },
      });
      return fresh.accessToken;
    } catch (error) {
      console.error("[instagram] token yenilenemedi", error instanceof Error ? error.message : error);
      return account.tokenExpiresAt > now ? token : null;
    }
  }
  return token;
}

export async function getInstagramOverview(ctx: ServiceContext, now = new Date()) {
  assertCan(ctx, "campaigns.manage");
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const [account, rules, tenant, sent30, failed30] = await Promise.all([
    db.instagramAccount.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.instagramAutoReply.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } }),
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { slug: true } }),
    db.instagramReplyLog.count({ where: { tenantId: ctx.tenantId, status: "SENT", createdAt: { gte: since } } }),
    db.instagramReplyLog.count({ where: { tenantId: ctx.tenantId, status: "FAILED", createdAt: { gte: since } } }),
  ]);
  const c = instagramConfig();
  return {
    account: account
      ? {
          status: account.status === "ACTIVE" ? ("ACTIVE" as const) : ("DISCONNECTED" as const),
          username: account.username,
          connectionMethod: account.connectionMethod,
          connectedAt: account.connectedAt,
          tokenExpiresAt: account.tokenExpiresAt,
          tokenUsable: account.status === "ACTIVE" && open(account.accessTokenEnc) !== null,
        }
      : null,
    setup: {
      oauthReady: Boolean(c.appId && c.appSecret) && channelSecretReady(),
      manualConnectAllowed: c.manualConnect && channelSecretReady(),
      webhookUrl: c.webhookUrl,
      webhookReady: Boolean(c.appSecret && c.webhookVerifyToken),
      redirectUri: c.redirectUri,
    },
    links: { menu: absoluteUrl(publicMenuPath(tenant.slug)), signup: absoluteUrl(signupPath(tenant.slug)) },
    rules: rules.map((r) => ({
      id: r.id,
      keywords: r.keywords.split(",").filter(Boolean),
      matchType: r.matchType === "CONTAINS" ? ("CONTAINS" as const) : ("EXACT" as const),
      replyText: r.replyText,
      isActive: r.isActive,
      replyCount: r.replyCount,
      lastRepliedAt: r.lastRepliedAt,
    })),
    stats: { sent30, failed30 },
  };
}

function stateKey(): Buffer {
  return createHash("sha256").update(`circular-instagram-state:v1:${process.env.CHANNEL_TOKEN_SECRET ?? ""}`).digest();
}

/** Yetkilendirme adresi (CSRF'e karşı işletme + kullanıcıya bağlı, 15 dk geçerli imzalı state). */
export async function instagramAuthorizeUrl(ctx: ServiceContext, now = new Date()) {
  assertCan(ctx, "channels.connect");
  const c = instagramConfig();
  if (!c.appId || !c.appSecret || !channelSecretReady()) throw new ConflictError("Circular'ın Instagram uygulaması henüz yapılandırılmadı.", "INSTAGRAM_NOT_CONFIGURED");
  const payload = `${ctx.tenantId}.${ctx.userId}.${now.getTime()}.${randomBytes(8).toString("base64url")}`;
  const sig = createHmac("sha256", stateKey()).update(payload).digest("base64url");
  return authorizeUrl(`${payload}.${sig}`);
}

function verifyState(ctx: ServiceContext, state: string, now: Date): boolean {
  const parts = state.split(".");
  if (parts.length !== 5) return false;
  const [tenantId, userId, ts, , sig] = parts;
  const expected = Buffer.from(createHmac("sha256", stateKey()).update(parts.slice(0, 4).join(".")).digest("base64url"));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  return tenantId === ctx.tenantId && userId === ctx.userId && now.getTime() - Number(ts) < 15 * 60 * 1000;
}

async function saveAccount(ctx: ServiceContext, token: string, expiresIn: number, method: "OAUTH" | "MANUAL", now = new Date()) {
  const me = await getMe(token).catch(igToConflict);
  const owner = await db.instagramAccount.findUnique({ where: { igUserId: me.igUserId }, select: { tenantId: true } });
  if (owner && owner.tenantId !== ctx.tenantId) throw new ConflictError("Bu Instagram hesabı başka bir işletmeye bağlı.", "INSTAGRAM_IN_USE");
  if (method === "OAUTH") await subscribeMessages(token).catch(igToConflict);
  const data = {
    igUserId: me.igUserId,
    username: me.username,
    accessTokenEnc: seal(token),
    tokenExpiresAt: expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null,
    connectionMethod: method,
    status: "ACTIVE",
    connectedByUserId: ctx.userId,
    connectedAt: now,
    disconnectedAt: null,
  };
  return db.$transaction(async (tx) => {
    const account = await tx.instagramAccount.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
    await logActivity(tx, ctx, { action: "instagram.connected", entityType: "instagram", entityId: account.id, metadata: { username: me.username, method } });
    return account;
  });
}

function igToConflict(error: unknown): never {
  if (error instanceof InstagramError) throw new ConflictError(`Instagram: ${error.message}`, "INSTAGRAM_ERROR");
  throw error;
}

/** Instagram'dan dönüş: kodu 60 günlük token'a çevirir, DM bildirimlerine abone olur ve hesabı kaydeder. */
export async function completeInstagramOAuth(ctx: ServiceContext, input: { code: string; state: string }, now = new Date()) {
  assertCan(ctx, "channels.connect");
  if (!verifyState(ctx, input.state, now)) throw new ConflictError("Bağlantı isteği geçersiz veya süresi dolmuş. Lütfen tekrar deneyin.", "INVALID_STATE");
  const short = await exchangeCode(input.code).catch(igToConflict);
  const long = await exchangeLongLived(short.accessToken).catch(igToConflict);
  return saveAccount(ctx, long.accessToken, long.expiresIn, "OAUTH", now);
}

/** Geliştirme: uygulama panelinden alınan token ile bağlama (INSTAGRAM_MANUAL_CONNECT=true). */
export async function connectInstagramManually(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "channels.connect");
  if (!instagramConfig().manualConnect || !channelSecretReady()) throw new ConflictError("Elle bağlantı bu ortamda kapalı.", "MANUAL_CONNECT_DISABLED");
  const token = String(raw.accessToken ?? "").trim();
  if (token.length < 20 || token.length > 1000) throw new ValidationError({ accessToken: ["Instagram erişim token'ını yapıştırın."] });
  return saveAccount(ctx, token, 0, "MANUAL");
}

export async function disconnectInstagram(ctx: ServiceContext) {
  assertCan(ctx, "channels.connect");
  const account = await db.instagramAccount.findUnique({ where: { tenantId: ctx.tenantId } });
  if (!account || account.status !== "ACTIVE") throw new NotFoundError("Bağlı Instagram hesabı yok.");
  await db.$transaction(async (tx) => {
    await tx.instagramAccount.update({ where: { id: account.id }, data: { status: "DISCONNECTED", accessTokenEnc: null, disconnectedAt: new Date() } });
    await logActivity(tx, ctx, { action: "instagram.disconnected", entityType: "instagram", entityId: account.id, metadata: { username: account.username } });
  });
}

// ─────────────────────────────────────────────── Kurallar

const ruleSchema = z.object({
  keywords: z.string(),
  matchType: z.enum(["EXACT", "CONTAINS"]),
  replyText: z.string(),
});

/** {menu} ve {kayit} yer tutucularını gerçek bağlantılarla değiştirir. */
export function expandReply(text: string, links: { menu: string; signup: string }): string {
  return text.replace(/\{menu\}/gi, links.menu).replace(/\{kayit\}/gi, links.signup);
}

async function tenantLinks(tenantId: string) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
  return { menu: absoluteUrl(publicMenuPath(tenant.slug)), signup: absoluteUrl(signupPath(tenant.slug)) };
}

async function validateRule(ctx: ServiceContext, raw: Record<string, unknown>, exceptId?: string) {
  const parsed = ruleSchema.safeParse({ keywords: String(raw.keywords ?? ""), matchType: raw.matchType ?? "EXACT", replyText: String(raw.replyText ?? "") });
  if (!parsed.success) throw new ValidationError({ matchType: ["Eşleşme türünü seçin."] });
  const errors: FieldErrors = {};
  const keywords = [...new Set(parsed.data.keywords.split(",").map(normalizeKeyword).filter(Boolean))];
  const replyText = parsed.data.replyText.replace(/\r\n/g, "\n").trim();
  if (keywords.length === 0) errors.keywords = ["En az bir anahtar kelime yazın (virgülle ayırın)."];
  else if (keywords.length > RULE_LIMITS.keywords) errors.keywords = [`En fazla ${RULE_LIMITS.keywords} anahtar kelime.`];
  else if (keywords.some((k) => k.length > RULE_LIMITS.keyword)) errors.keywords = [`Anahtar kelime en fazla ${RULE_LIMITS.keyword} karakter.`];
  if (replyText.length < 2) errors.replyText = ["Yanıt metnini yazın."];
  else if (replyText.length > RULE_LIMITS.reply) errors.replyText = [`Yanıt en fazla ${RULE_LIMITS.reply} karakter.`];
  else if (Buffer.byteLength(expandReply(replyText, await tenantLinks(ctx.tenantId)), "utf8") > 1000) {
    errors.replyText = ["Bağlantılar eklendiğinde yanıt Instagram'ın 1000 bayt sınırını aşıyor; metni kısaltın."];
  }
  if (!errors.keywords) {
    const others = await db.instagramAutoReply.findMany({ where: { tenantId: ctx.tenantId, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { keywords: true } });
    const taken = new Set(others.flatMap((o) => o.keywords.split(",")));
    const clash = keywords.filter((k) => taken.has(k));
    if (clash.length) errors.keywords = [`Başka bir kuralda da var: ${clash.join(", ")}`];
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { keywords: keywords.join(","), matchType: parsed.data.matchType, replyText };
}

export async function createAutoReply(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "campaigns.manage");
  const v = await validateRule(ctx, raw);
  return db.$transaction(async (tx) => {
    const rule = await tx.instagramAutoReply.create({ data: { tenantId: ctx.tenantId, ...v, createdByUserId: ctx.userId } });
    await logActivity(tx, ctx, { action: "instagram.rule_changed", entityType: "instagram", entityId: rule.id, metadata: { op: "ekledi", keywords: v.keywords.replace(/,/g, ", ") } });
    return rule;
  });
}

export async function updateAutoReply(ctx: ServiceContext, id: string, raw: Record<string, unknown>) {
  assertCan(ctx, "campaigns.manage");
  const rule = await db.instagramAutoReply.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!rule) throw new NotFoundError("Kural bulunamadı.");
  const v = await validateRule(ctx, raw, id);
  return db.$transaction(async (tx) => {
    const updated = await tx.instagramAutoReply.update({ where: { id }, data: v });
    await logActivity(tx, ctx, { action: "instagram.rule_changed", entityType: "instagram", entityId: id, metadata: { op: "güncelledi", keywords: v.keywords.replace(/,/g, ", ") } });
    return updated;
  });
}

export async function setAutoReplyActive(ctx: ServiceContext, id: string, active: boolean) {
  assertCan(ctx, "campaigns.manage");
  const rule = await db.instagramAutoReply.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!rule) throw new NotFoundError("Kural bulunamadı.");
  if (active) {
    const others = await db.instagramAutoReply.findMany({ where: { tenantId: ctx.tenantId, isActive: true, id: { not: id } }, select: { keywords: true } });
    const taken = new Set(others.flatMap((o) => o.keywords.split(",")));
    const clash = rule.keywords.split(",").filter((k) => taken.has(k));
    if (clash.length) throw new ConflictError(`Bu anahtar kelimeler başka bir aktif kuralda: ${clash.join(", ")}`, "KEYWORD_CLASH");
  }
  await db.$transaction(async (tx) => {
    await tx.instagramAutoReply.update({ where: { id }, data: { isActive: active } });
    await logActivity(tx, ctx, { action: "instagram.rule_changed", entityType: "instagram", entityId: id, metadata: { op: active ? "açtı" : "kapattı", keywords: rule.keywords.replace(/,/g, ", ") } });
  });
}

export async function deleteAutoReply(ctx: ServiceContext, id: string) {
  assertCan(ctx, "campaigns.manage");
  const rule = await db.instagramAutoReply.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!rule) throw new NotFoundError("Kural bulunamadı.");
  await db.$transaction(async (tx) => {
    await tx.instagramAutoReply.delete({ where: { id } });
    await logActivity(tx, ctx, { action: "instagram.rule_changed", entityType: "instagram", entityId: id, metadata: { op: "sildi", keywords: rule.keywords.replace(/,/g, ", ") } });
  });
}

type Rule = { id: string; keywords: string; matchType: string; replyText: string; createdAt: Date };

/** Mesaja uyan kural: önce "tam eşleşme", sonra "içinde geçen"; aynı türde en eski kural. */
export function matchRule(text: string, rules: Rule[]): Rule | null {
  const msg = normalizeKeyword(text);
  if (!msg) return null;
  const sorted = [...rules].sort((a, b) => Number(a.matchType === "CONTAINS") - Number(b.matchType === "CONTAINS") || a.createdAt.getTime() - b.createdAt.getTime());
  for (const r of sorted) {
    const keys = r.keywords.split(",").filter(Boolean);
    if (r.matchType === "EXACT" ? keys.includes(msg) : keys.some((k) => ` ${msg} `.includes(` ${k} `))) return r;
  }
  return null;
}

// ─────────────────────────────────────────────── Bildirimler (webhook)

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Instagram DM bildirimi: uyan kurala göre otomatik yanıt verir. */
export async function handleInstagramWebhook(payload: unknown, now = new Date()) {
  const result = { replied: 0, skipped: 0, failed: 0 };
  if (!isObj(payload) || payload.object !== "instagram") return result;

  for (const entry of arr(payload.entry)) {
    const igUserId = str(entry.id);
    const account = igUserId ? await db.instagramAccount.findUnique({ where: { igUserId } }) : null;
    if (!account || account.status !== "ACTIVE") continue;

    for (const event of arr(entry.messaging)) {
      const message = isObj(event.message) ? event.message : null;
      const senderId = str(isObj(event.sender) ? event.sender.id : "");
      const mid = str(message?.mid);
      const text = str(message?.text);
      if (!message || message.is_echo === true || !senderId || senderId === igUserId || !mid || !text) continue;

      const rules = await db.instagramAutoReply.findMany({ where: { tenantId: account.tenantId, isActive: true } });
      const rule = matchRule(text, rules);
      if (!rule) continue;

      const senderHash = createHash("sha256").update(`${account.tenantId}:${senderId}`).digest("hex");
      const recent = await db.instagramReplyLog.findFirst({
        where: { tenantId: account.tenantId, ruleId: rule.id, senderHash, status: "SENT", createdAt: { gte: new Date(now.getTime() - REPLY_COOLDOWN_MS) } },
        select: { id: true },
      });

      let logId: string;
      try {
        const log = await db.instagramReplyLog.create({
          data: { tenantId: account.tenantId, ruleId: rule.id, mid, senderHash, status: recent ? "COOLDOWN" : "PENDING" },
        });
        logId = log.id;
      } catch (error) {
        if (isUniqueViolation(error)) continue; // aynı mesaj ikinci kez geldi
        throw error;
      }
      if (recent) {
        result.skipped++;
        continue;
      }

      const token = await usableToken(account, now);
      if (!token) {
        await db.instagramReplyLog.update({ where: { id: logId }, data: { status: "FAILED", errorMessage: "Instagram erişimi kullanılamıyor; hesabı yeniden bağlayın." } });
        result.failed++;
        continue;
      }
      try {
        await sendDirectMessage(token, igUserId, senderId, expandReply(rule.replyText, await tenantLinks(account.tenantId)));
        await db.$transaction([
          db.instagramReplyLog.update({ where: { id: logId }, data: { status: "SENT" } }),
          db.instagramAutoReply.update({ where: { id: rule.id }, data: { replyCount: { increment: 1 }, lastRepliedAt: now } }),
        ]);
        result.replied++;
      } catch (error) {
        const messageText = error instanceof InstagramError ? error.message : "Beklenmeyen hata.";
        if (!(error instanceof InstagramError)) console.error("[instagram] yanıt gönderilemedi", error);
        await db.instagramReplyLog.update({ where: { id: logId }, data: { status: "FAILED", errorMessage: messageText } });
        result.failed++;
      }
    }
  }
  return result;
}
