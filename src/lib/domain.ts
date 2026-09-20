/**
 * Alan sözlüğü: veritabanında String olarak tutulan durumların geçerli değerleri
 * ve Türkçe etiketleri. Sunucu doğrulaması bu listeleri kullanır.
 */

export const ROLES = ["OWNER_ADMIN", "CRM_MANAGER", "PR", "DOOR", "WAITER"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  OWNER_ADMIN: "İşletme sahibi / admin",
  CRM_MANAGER: "CRM ve pazarlama yöneticisi",
  PR: "PR",
  DOOR: "Kapı görevlisi",
  WAITER: "Garson / operasyon",
};

export const VENUE_TYPES = ["RESTAURANT", "CAFE", "PUB", "NIGHTCLUB", "EVENT_SPACE"] as const;
export type VenueType = (typeof VENUE_TYPES)[number];
export const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  RESTAURANT: "Restoran",
  CAFE: "Kafe",
  PUB: "Pub",
  NIGHTCLUB: "Gece kulübü",
  EVENT_SPACE: "Etkinlik mekanı",
};

/** Müşterinin CRM'e ilk girdiği kanal. */
export const CUSTOMER_SOURCES = [
  "MANUAL",
  "WALK_IN",
  "IMPORT",
  "STAFF_GUEST",
  "PR_GUEST",
  "PR_REFERRAL",
  "QR_MENU",
  "EVENT_PAGE",
] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];
export const CUSTOMER_SOURCE_LABELS: Record<CustomerSource, string> = {
  MANUAL: "Panelden eklendi",
  WALK_IN: "Mekanda tanışıldı",
  IMPORT: "İçe aktarım",
  STAFF_GUEST: "Guest listesi (personel)",
  PR_GUEST: "Guest listesi (PR)",
  PR_REFERRAL: "PR referral linki",
  QR_MENU: "QR menü",
  EVENT_PAGE: "Etkinlik sayfası",
};
/** Faz 1'de personelin panelden seçebileceği kaynaklar. Diğerleri sistem akışlarıyla oluşur. */
export const STAFF_SELECTABLE_SOURCES: CustomerSource[] = ["MANUAL", "WALK_IN", "IMPORT"];

export const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "E-posta",
};

export const CONSENT_STATUSES = ["GRANTED", "REVOKED"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_SOURCE_LABELS: Record<string, string> = {
  STAFF_RECORDED: "Personel kaydetti",
  PUBLIC_SIGNUP: "Kayıt formu",
  PREFERENCE_CENTER: "Tercih merkezi",
  OPT_OUT_REPLY: "Çıkış talebi",
};

export const EVENT_STATUSES = ["DRAFT", "PUBLISHED", "CANCELLED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: "Taslak",
  PUBLISHED: "Yayında",
  CANCELLED: "İptal edildi",
};

export const REGISTRATION_CHANNELS = ["STAFF", "PR", "PUBLIC_PAGE", "PR_REFERRAL", "WALK_IN"] as const;
export type RegistrationChannel = (typeof REGISTRATION_CHANNELS)[number];
export const REGISTRATION_CHANNEL_LABELS: Record<RegistrationChannel, string> = {
  STAFF: "Personel ekledi",
  PR: "PR ekledi",
  PUBLIC_PAGE: "Etkinlik sayfası",
  PR_REFERRAL: "PR linki",
  WALK_IN: "Kapıda eklendi",
};

export const COMPLETION_LABELS: Record<string, string> = {
  STAFF_ENTERED: "Personel girdi",
  SELF_COMPLETED: "Kişi tamamladı",
};

export const ACCESS_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Giriş hakkı var",
  CANCELLED: "İptal",
};

export const MAX_PARTY_SIZE = 20;

export function labelOf<T extends string>(labels: Record<T, string>, value: string): string {
  return (labels as Record<string, string>)[value] ?? value;
}

export function isOneOf<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
