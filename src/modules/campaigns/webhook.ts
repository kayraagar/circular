import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { fullName } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";
import { applyTemplateStatusUpdate } from "./templates";
import { OPT_OUT_PAYLOAD, isOptOutText, isStatusAdvance } from "./rules";

/**
 * Meta WhatsApp bildirimleri (webhook):
 * - Mesaj durumları (sent / delivered / read / failed) ve Meta'nın ücretlendirme bilgisi
 * - Müşterinin ret yanıtı ("Abonelikten çık" düğmesi veya DUR vb.) → WhatsApp izni kaldırılır
 * - Şablon onay durumu
 * İmza (X-Hub-Signature-256) route'ta doğrulanır; burada yalnızca imzası geçerli içerik işlenir.
 * Bildirim, numaranın bağlı olduğu işletmenin verisi dışında hiçbir kaydı değiştiremez.
 */

export function verifyWhatsAppSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function tsDate(value: unknown): Date {
  const seconds = Number(str(value));
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

export type WebhookResult = { statuses: number; optOuts: number; templates: number; ignored: number };

export async function handleWhatsAppWebhook(payload: unknown): Promise<WebhookResult> {
  const result: WebhookResult = { statuses: 0, optOuts: 0, templates: 0, ignored: 0 };
  if (!isObj(payload) || payload.object !== "whatsapp_business_account") return result;

  for (const entry of arr(payload.entry)) {
    for (const change of arr(entry.changes)) {
      const value = isObj(change.value) ? change.value : {};
      if (change.field === "message_template_status_update") {
        const r = await applyTemplateStatusUpdate({
          wabaId: str(entry.id),
          metaTemplateId: str(value.message_template_id),
          event: str(value.event),
          reason: str(value.reason) || null,
        });
        result.templates += r.count;
        continue;
      }
      if (change.field !== "messages") continue;

      const phoneNumberId = str(isObj(value.metadata) ? value.metadata.phone_number_id : "");
      const account = phoneNumberId ? await db.whatsAppAccount.findUnique({ where: { phoneNumberId }, select: { tenantId: true } }) : null;
      if (!account) {
        result.ignored += arr(value.statuses).length + arr(value.messages).length;
        continue;
      }
      for (const status of arr(value.statuses)) {
        if (await applyStatus(account.tenantId, status)) result.statuses++;
        else result.ignored++;
      }
      for (const message of arr(value.messages)) {
        if (await applyInbound(account.tenantId, message)) result.optOuts++;
      }
    }
  }
  return result;
}

async function applyStatus(tenantId: string, s: Obj): Promise<boolean> {
  const wamid = str(s.id);
  if (!wamid) return false;
  const message = await db.campaignMessage.findUnique({ where: { wamid } });
  if (!message || message.tenantId !== tenantId) return false;

  const at = tsDate(s.timestamp);
  const pricing = isObj(s.pricing) ? s.pricing : null;
  const data: Record<string, unknown> = {};
  if (pricing) {
    if (typeof pricing.billable === "boolean") data.billable = pricing.billable;
    if (str(pricing.category)) data.pricingCategory = str(pricing.category).toLowerCase();
  }

  switch (str(s.status)) {
    case "sent":
      if (isStatusAdvance(message.status, "SENT")) Object.assign(data, { status: "SENT", sentAt: at });
      break;
    case "delivered":
      if (isStatusAdvance(message.status, "DELIVERED")) Object.assign(data, { status: "DELIVERED", deliveredAt: at, sentAt: message.sentAt ?? at });
      break;
    case "read":
      if (isStatusAdvance(message.status, "READ")) Object.assign(data, { status: "READ", readAt: at, deliveredAt: message.deliveredAt ?? at, sentAt: message.sentAt ?? at });
      break;
    case "failed": {
      if (message.status === "DELIVERED" || message.status === "READ") break;
      const error = arr(s.errors)[0] ?? {};
      const details = isObj(error.error_data) ? str(error.error_data.details) : "";
      Object.assign(data, {
        status: "FAILED",
        failedAt: at,
        errorCode: str(error.code) || "UNKNOWN",
        errorMessage: (details || str(error.message) || str(error.title) || "Meta mesajı teslim edemedi.").slice(0, 300),
      });
      break;
    }
  }
  if (Object.keys(data).length === 0) return true;
  await db.campaignMessage.update({ where: { id: message.id }, data });
  return true;
}

/** Ret yanıtıysa müşterinin WhatsApp iznini kaldırır. İşlendiyse true. */
async function applyInbound(tenantId: string, m: Obj): Promise<boolean> {
  const type = str(m.type);
  const optOut =
    (type === "button" && isObj(m.button) && str(m.button.payload) === OPT_OUT_PAYLOAD) ||
    (type === "text" && isObj(m.text) && isOptOutText(str(m.text.body)));
  const from = str(m.from).replace(/\D/g, "");
  if (!optOut || from.length < 8) return false;

  const customer = await db.customer.findUnique({ where: { tenantId_phone: { tenantId, phone: `+${from}` } } });
  if (!customer) return false;
  const at = tsDate(m.timestamp);

  return db.$transaction(async (tx) => {
    const existing = await tx.contactConsent.findUnique({ where: { customerId_channel: { customerId: customer.id, channel: "WHATSAPP" } } });
    if (existing?.status === "REVOKED") return false;
    const consent = existing
      ? await tx.contactConsent.update({
          where: { id: existing.id },
          data: { status: "REVOKED", revokedAt: at, recordedByUserId: null, note: "WhatsApp üzerinden ret bildirimi" },
        })
      : await tx.contactConsent.create({
          data: {
            tenantId,
            customerId: customer.id,
            channel: "WHATSAPP",
            status: "REVOKED",
            source: "OPT_OUT_REPLY",
            note: "WhatsApp üzerinden ret bildirimi",
            revokedAt: at,
          },
        });
    await logActivity(tx, { tenantId, userId: null }, {
      action: "consent.revoked",
      entityType: "consent",
      entityId: consent.id,
      customerId: customer.id,
      metadata: { customerName: fullName(customer), channel: "WHATSAPP", via: "WHATSAPP_REPLY" },
    });
    return true;
  });
}
