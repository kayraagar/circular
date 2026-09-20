import { foldText } from "@/lib/normalize";

/**
 * Kampanya modülünün paylaşılan kuralları (sunucu ve istemci bileşenleri kullanır).
 * Sunucuya özel işler (Meta API, veritabanı) ayrı dosyalardadır.
 */

// ─────────────────────────────────────────────── Kanallar

export const CAMPAIGN_CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "E-posta" };

// ─────────────────────────────────────────────── Kitleler

/** Önerilen kitleler: gerçek kayıtlardan (kapı girişi, avantaj kullanımı, etkinlik kaydı, gönderim geçmişi) hesaplanır. */
export const SUGGESTED_SEGMENTS = ["LAPSED_30", "LAPSED_60", "LAPSED_90", "NO_SHOW_RECENT", "NEW_NOT_VISITED", "BIRTHDAY_THIS_MONTH", "NOT_MESSAGED_60"] as const;
export const BULK_SEGMENTS = ["WHATSAPP_CONSENTED", "SMS_CONSENTED", "EMAIL_CONSENTED"] as const;
/** Toplu seçimde kanalın "izni olan herkes" kitlesi */
export const CONSENTED_SEGMENT: Record<CampaignChannel, (typeof BULK_SEGMENTS)[number]> = {
  WHATSAPP: "WHATSAPP_CONSENTED",
  SMS: "SMS_CONSENTED",
  EMAIL: "EMAIL_CONSENTED",
};
export const SEGMENT_KEYS = [...BULK_SEGMENTS, ...SUGGESTED_SEGMENTS] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export const SEGMENT_COPY: Record<SegmentKey, { label: string; description: string }> = {
  WHATSAPP_CONSENTED: { label: "WhatsApp izni olan herkes", description: "WhatsApp ile iletişim izni kayıtlı tüm aktif müşteriler." },
  SMS_CONSENTED: { label: "SMS izni olan herkes", description: "SMS ile iletişim izni kayıtlı tüm aktif müşteriler." },
  EMAIL_CONSENTED: { label: "E-posta izni olan herkes", description: "E-posta ile iletişim izni kayıtlı tüm aktif müşteriler." },
  LAPSED_30: { label: "30 gündür gelmeyenler", description: "En az bir kez gelmiş, son 30 günde kapı girişi veya avantaj kullanımı olmayan." },
  LAPSED_60: { label: "60 gündür gelmeyenler", description: "En az bir kez gelmiş, son 60 günde kapı girişi veya avantaj kullanımı olmayan." },
  LAPSED_90: { label: "90 gündür gelmeyenler", description: "En az bir kez gelmiş, son 90 günde kapı girişi veya avantaj kullanımı olmayan." },
  NO_SHOW_RECENT: { label: "Kaydolup gelmeyenler", description: "Son 30 günde biten bir etkinliğe kaydı olup kapıdan girişi olmayan." },
  NEW_NOT_VISITED: { label: "Yeni, henüz gelmemiş", description: "Son 30 günde eklenen, henüz kapı girişi veya avantaj kullanımı olmayan." },
  BIRTHDAY_THIS_MONTH: { label: "Bu ay doğum günü olanlar", description: "Doğum tarihi kayıtlı ve doğum ayı bu ay olan." },
  NOT_MESSAGED_60: { label: "60 gündür mesaj gönderilmeyenler", description: "Son 60 günde kendisine hiçbir kanaldan kampanya mesajı iletilmemiş." },
};

/** Tek kampanyada en fazla alıcı (yanlışlıkla çok büyük gönderimi önler). */
export const MAX_CAMPAIGN_RECIPIENTS = 5000;
export const MAX_SELECTED_CUSTOMERS = 500;
export const MAX_TEST_RECIPIENTS = 5;

/** Gönderim öncesi veya gönderim anında bir kişinin elenme nedeni. */
export const EXCLUSION_REASONS = ["NO_PHONE", "NO_EMAIL", "NO_CONSENT", "IYS_NOT_APPROVED", "ARCHIVED", "PHONE_CHANGED", "FOREIGN_NUMBER", "LIMIT"] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  NO_PHONE: "Telefon numarası yok",
  NO_EMAIL: "E-posta adresi yok",
  NO_CONSENT: "Bu kanal için iletişim izni yok",
  IYS_NOT_APPROVED: "İYS'de onayı yok",
  ARCHIVED: "Arşivlendi",
  PHONE_CHANGED: "İletişim bilgisi değişti",
  FOREIGN_NUMBER: "Yurt dışı numara (SMS yalnızca Türkiye numaralarına)",
  LIMIT: `Kampanya başına ${MAX_CAMPAIGN_RECIPIENTS} kişi sınırı`,
};

// ─────────────────────────────────────────────── Mesaj durumları

export const MESSAGE_STATUSES = ["QUEUED", "SENDING", "ACCEPTED", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  QUEUED: "Sırada",
  SENDING: "Gönderiliyor",
  ACCEPTED: "Meta'ya iletildi",
  SENT: "Gönderildi",
  DELIVERED: "Teslim edildi",
  READ: "Okundu",
  FAILED: "Başarısız",
  SKIPPED: "Gönderilmedi",
};

export type StatusCounts = Record<MessageStatus, number>;

/** Rapor sayıları: iletilen = Meta'nın kabul ettiği; teslim = teslim edilen veya okunan. */
export function deliveryTotals(counts: StatusCounts) {
  const delivered = counts.DELIVERED + counts.READ;
  return {
    accepted: counts.ACCEPTED + counts.SENT + delivered,
    delivered,
    read: counts.READ,
    failed: counts.FAILED,
    skipped: counts.SKIPPED,
    problems: counts.FAILED + counts.SKIPPED,
    pending: counts.QUEUED + counts.SENDING,
  };
}

/** Meta durum bildirimleri sırasız gelebilir: yalnızca ileri giden durum yazılır (okundu → teslim edildiye dönmez). */
const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENDING: 1, ACCEPTED: 2, SENT: 3, DELIVERED: 4, READ: 5 };
export function isStatusAdvance(current: string, next: "SENT" | "DELIVERED" | "READ"): boolean {
  if (current === "FAILED" || current === "SKIPPED") return false;
  return (STATUS_RANK[current] ?? 0) < STATUS_RANK[next];
}

/** SENDING'de bu süreden uzun kalan mesajın Meta'ya ulaşıp ulaşmadığı bilinmez; tekrar gönderilmez. */
export const STUCK_SENDING_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────── Şablonlar

export const TEMPLATE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  PENDING: "Meta onayında",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  PAUSED: "Duraklatıldı",
  DISABLED: "Devre dışı",
};

export const TEMPLATE_LIMITS = { name: 60, header: 60, body: 1024, footer: 60, button: 25 };
export const NAME_VARIABLE = "ad";
export const DEFAULT_FOOTER = "Almak istemiyorsanız DUR yazın.";
export const DEFAULT_OPT_OUT_LABEL = "Abonelikten çık";
export const SAMPLE_FIRST_NAME = "Ayşe";

/** "Hafta Sonu İndirimi" → "hafta_sonu_indirimi" (Meta: küçük harf, rakam, alt çizgi). */
export function templateNameFrom(value: string): string {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, TEMPLATE_LIMITS.name);
}

/** Metindeki {{...}} değişkenleri. */
export function templateVariables(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]);
}

export function usesNameVariable(body: string): boolean {
  return templateVariables(body).includes(NAME_VARIABLE);
}

/** Önizleme ve gönderim için {{ad}} yerine değer koyar. */
export function renderTemplateText(text: string, firstName: string): string {
  return text.replace(/\{\{\s*ad\s*\}\}/g, firstName);
}

// ─────────────────────────────────────────────── Ret (abonelikten çıkma)

/** Şablondaki "Abonelikten çık" düğmesinin gönderimde taşıdığı veri. */
export const OPT_OUT_PAYLOAD = "CIRCULAR_OPT_OUT";

/** Mesajın tamamı bunlardan biriyse ret sayılır ("durum ne?" gibi cümleler sayılmaz). */
const OPT_OUT_KEYWORDS = new Set(["dur", "stop", "iptal", "ret", "abonelikten cik", "abonelikten cikmak istiyorum", "mesaj istemiyorum", "istemiyorum"]);
export function isOptOutText(text: string): boolean {
  const key = foldText(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return OPT_OUT_KEYWORDS.has(key);
}

// ─────────────────────────────────────────────── Tahmini ücret

/**
 * Meta'nın Türkiye numaralarına pazarlama mesajı ücreti (teslim edilen mesaj başına, USD).
 * Kaynak: Meta WhatsApp Business Platform ücret tablosu (Temmuz 2026). Tablo değişince güncellenmelidir;
 * gerçek tutar Meta / çözüm ortağı faturasındadır.
 */
export const MARKETING_RATE_TR_USD = 0.0109;
export const MARKETING_RATE_AS_OF = "Temmuz 2026";

export function estimateCostMicroUsd(trRecipients: number): number {
  return Math.round(trRecipients * MARKETING_RATE_TR_USD * 1_000_000);
}

export function formatUsd(microUsd: number): string {
  return `${(microUsd / 1_000_000).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

// ─────────────────────────────────────────────── SMS

export const SMS_LIMITS = { body: 600, footer: 160, header: 11 };

/** Netgsm "TR" kodlamasında kullanılabilen karakterler (GSM 03.38 + Türkçe karakterler). */
const GSM_TR = /^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüàçğĞıİşŞ€\[\]{}|^~\\]*$/;

/** Yaklaşık SMS adedi: Türkçe karakterli standart metin 155 / parça 149; emoji vb. içeren metin 70 / parça 67. */
export function smsSegments(text: string): { segments: number; unicode: boolean; length: number } {
  const length = [...text].length;
  const unicode = !GSM_TR.test(text);
  const [single, part] = unicode ? [70, 67] : [155, 149];
  return { segments: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / part), unicode, length };
}

/** Gönderilecek SMS metni: kişiselleştirilmiş gövde + yasal alt bilgi (ticari SMS'te zorunlu). */
export function composeSms(body: string, footer: string, firstName: string, opts: { test?: boolean } = {}): string {
  const main = renderTemplateText(body.trim(), firstName);
  const text = footer.trim() ? `${main}\n${footer.trim()}` : main;
  return opts.test ? `TEST: ${text}` : text;
}

// ─────────────────────────────────────────────── E-posta

export const EMAIL_LIMITS = { subject: 120, body: 5000, ctaLabel: 40, ctaUrl: 500, senderName: 60, footer: 400 };
