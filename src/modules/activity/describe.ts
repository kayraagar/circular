import { CHANNEL_LABELS, labelOf } from "@/lib/domain";
import type { ActivityItem } from "./service";

export type ActivityDescription = {
  /** Aktörden sonra gelen cümle, ör. "müşteri ekledi" */
  verb: string;
  /** Bağlantılı nesne */
  subject?: { label: string; href: string };
  /** Ek bağlam, ör. etkinlik adı */
  context?: { label: string; href?: string };
  detail?: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function describeActivity(item: ActivityItem): ActivityDescription {
  const m = item.metadata;
  const customer = item.customerId
    ? { label: str(m.customerName) || "müşteri", href: `/customers/${item.customerId}` }
    : undefined;
  const event = item.eventId ? { label: str(m.eventName) || "etkinlik", href: `/events/${item.eventId}` } : undefined;
  const party = typeof m.partySize === "number" && m.partySize > 1 ? `${m.partySize} kişi` : undefined;

  switch (item.action) {
    case "customer.created":
      return { verb: "müşteri ekledi", subject: customer, detail: str(m.sourceLabel) || undefined };
    case "customer.updated": {
      const fields = Array.isArray(m.fields) ? (m.fields as string[]).join(", ") : "";
      return { verb: "müşteri bilgilerini güncelledi", subject: customer, detail: fields || undefined };
    }
    case "customer.archived":
      return { verb: "müşteriyi arşivledi", subject: customer };
    case "customer.restored":
      return { verb: "müşteriyi arşivden çıkardı", subject: customer };
    case "consent.granted":
      return {
        verb: `${labelOf(CHANNEL_LABELS, str(m.channel))} iletişim iznini kaydetti`,
        subject: customer,
        detail: str(m.note) || undefined,
      };
    case "consent.revoked":
      return {
        verb: `${labelOf(CHANNEL_LABELS, str(m.channel))} iletişim iznini kaldırdı`,
        subject: customer,
        detail: str(m.via) === "WHATSAPP_REPLY" ? "Müşteri WhatsApp mesajıyla ret bildirdi" : undefined,
      };
    case "event.created":
      return { verb: "etkinlik oluşturdu", subject: event };
    case "event.updated":
      return { verb: "etkinliği güncelledi", subject: event };
    case "event.published":
      return { verb: "etkinliği yayına aldı", subject: event };
    case "event.unpublished":
      return { verb: "etkinliği taslağa aldı", subject: event };
    case "event.cancelled":
      return { verb: "etkinliği iptal etti", subject: event };
    case "event.entry_extended":
      return { verb: "giriş penceresini uzattı", subject: event, detail: str(m.closesAtLabel) || undefined };
    case "registration.added":
      return { verb: "guest ekledi", subject: customer, context: event, detail: party };
    case "registration.reactivated":
      return { verb: "guest kaydını yeniden etkinleştirdi", subject: customer, context: event, detail: party };
    case "registration.cancelled":
      return { verb: "guest kaydını iptal etti", subject: customer, context: event };
    case "pass.issued":
    case "pass.reissued": {
      const entry = str(m.purpose) !== "PERK_REDEMPTION";
      const verb = entry
        ? item.action === "pass.issued" ? "giriş QR'ı oluşturdu" : "giriş QR'ını yeniledi"
        : item.action === "pass.issued" ? "avantaj QR'ı oluşturdu" : "avantaj QR'ını yeniledi";
      return { verb, subject: customer, context: entry ? event : undefined, detail: entry ? undefined : str(m.perkName) || undefined };
    }
    case "checkin.recorded": {
      const count = typeof m.admittedCount === "number" ? `${m.admittedCount} kişi` : undefined;
      return {
        verb: str(m.method) === "MANUAL" ? "manuel giriş kaydetti" : "QR ile girişi onayladı",
        subject: customer,
        context: event,
        detail: count,
      };
    }
    case "checkin.undone": {
      const count = typeof m.admittedCount === "number" ? `${m.admittedCount} kişi` : undefined;
      return { verb: "kaydedilen girişi geri aldı", subject: customer, context: event, detail: count };
    }
    case "perk.created":
      return { verb: "avantaj tanımladı", subject: { label: str(m.perkName) || "avantaj", href: "/menu/perks" } };
    case "perk.archived":
      return { verb: "avantajı arşivledi", subject: { label: str(m.perkName) || "avantaj", href: "/menu/perks" } };
    case "perk.activated":
      return { verb: "avantajı yeniden etkinleştirdi", subject: { label: str(m.perkName) || "avantaj", href: "/menu/perks" } };
    case "perk.redeemed":
      return { verb: "avantaj kullanımını onayladı", subject: customer, detail: str(m.perkName) || undefined };
    case "registration.self_registered":
      return {
        verb: "PR davet linkinden guest kaydı aldı",
        subject: customer,
        context: event,
        detail: [party, str(m.promoterName) ? `PR: ${str(m.promoterName)}` : ""].filter(Boolean).join(" · ") || undefined,
      };
    case "whatsapp.connected":
      return { verb: "WhatsApp numarasını bağladı", subject: { label: str(m.displayPhoneNumber) || "WhatsApp", href: "/campaigns/whatsapp" } };
    case "whatsapp.disconnected":
      return { verb: "WhatsApp numarasının bağlantısını kesti", subject: { label: str(m.displayPhoneNumber) || "WhatsApp", href: "/campaigns/whatsapp" } };
    case "whatsapp.template_submitted":
      return { verb: "WhatsApp şablonunu Meta onayına gönderdi", subject: { label: str(m.name) || "şablon", href: "/campaigns/templates" } };
    case "sms.connected":
      return { verb: "Netgsm SMS hesabını bağladı", subject: { label: str(m.msgheader) || "SMS", href: "/campaigns/sms" } };
    case "sms.disconnected":
      return { verb: "Netgsm SMS hesabının bağlantısını kesti", subject: { label: str(m.msgheader) || "SMS", href: "/campaigns/sms" } };
    case "email.settings_updated":
      return { verb: "e-posta gönderici ayarlarını güncelledi", subject: { label: str(m.senderName) || "E-posta", href: "/campaigns/email" } };
    case "instagram.connected":
      return { verb: "Instagram hesabını bağladı", subject: { label: str(m.username) ? `@${str(m.username)}` : "Instagram", href: "/campaigns/instagram" } };
    case "instagram.disconnected":
      return { verb: "Instagram hesabının bağlantısını kesti", subject: { label: str(m.username) ? `@${str(m.username)}` : "Instagram", href: "/campaigns/instagram" } };
    case "instagram.rule_changed":
      return { verb: `Instagram otomatik yanıtını ${str(m.op) || "güncelledi"}`, subject: { label: str(m.keywords) || "kural", href: "/campaigns/instagram" } };
    case "campaign.sent":
      return {
        verb: str(m.channel) === "SMS" ? "SMS kampanyası gönderdi" : str(m.channel) === "EMAIL" ? "e-posta kampanyası gönderdi" : "WhatsApp kampanyası gönderdi",
        subject: { label: str(m.name) || "kampanya", href: `/campaigns/${item.entityId}` },
        detail: typeof m.recipientCount === "number" ? `${m.recipientCount} kişi · ${str(m.audienceLabel)}` : undefined,
      };
    case "campaign.test_sent":
      return {
        verb: str(m.channel) === "SMS" ? "test numaralarına SMS gönderdi" : str(m.channel) === "EMAIL" ? "test adreslerine e-posta gönderdi" : "test numaralarına WhatsApp mesajı gönderdi",
        subject: { label: str(m.name) || "test gönderimi", href: `/campaigns/${item.entityId}` },
        detail: typeof m.recipientCount === "number" ? `${m.recipientCount} numara` : undefined,
      };
    case "pr_task.created":
      return {
        verb: "PR'lara talimat verdi",
        subject: { label: str(m.title) || "talimat", href: "/pr" },
        detail: [str(m.kindLabel), typeof m.recipientCount === "number" ? `${m.recipientCount} PR` : ""].filter(Boolean).join(" · ") || undefined,
      };
    case "pr_task.closed":
      return { verb: "talimatı kapattı", subject: { label: str(m.title) || "talimat", href: "/pr" } };
    case "pr_task.completed":
      return { verb: "talimatı tamamladı", subject: { label: str(m.title) || "talimat", href: "/workspace" } };
    case "customer.self_registered":
      return { verb: "menüdeki kayıt formundan üye kaydetti", subject: customer, detail: str(m.campaignTitle) || undefined };
    case "menu.campaign_updated":
      return {
        verb: m.isActive ? "kampanya popup'ını yayına aldı" : "kampanya popup'ını güncelledi",
        subject: { label: str(m.title) || "Kampanya", href: "/menu" },
        detail: str(m.perkName) || undefined,
      };
    case "menu.config_updated":
      return { verb: "menü tasarımını güncelledi", subject: { label: "QR Menü", href: "/menu" } };
    case "menu.category_changed": {
      const op = str(m.operation);
      const verb = op === "created" ? "menü kategorisi ekledi" : op === "deleted" ? "menü kategorisini sildi" : "menü kategorisini güncelledi";
      return { verb, subject: { label: str(m.categoryName) || "kategori", href: "/menu" } };
    }
    case "menu.item_changed": {
      const op = str(m.operation);
      const verb = op === "created" ? "menüye ürün ekledi" : op === "deleted" ? "menüden ürün sildi" : "menü ürününü güncelledi";
      return { verb, subject: { label: str(m.itemName) || "ürün", href: "/menu" }, detail: str(m.categoryName) || undefined };
    }
    default:
      return { verb: item.action };
  }
}
