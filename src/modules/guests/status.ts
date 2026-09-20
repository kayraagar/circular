/**
 * Misafir (guest) durumu ve kaynağı — saf tanımlar.
 *
 * Durum veritabanında ayrı bir kolon olarak TUTULMAZ; mevcut kayıtlardan türetilir:
 * - Giriş hakkı: EventRegistration.accessStatus (ACTIVE | CANCELLED)
 * - Gerçek giriş: CheckIn kaydı (kapı ekranı, QR veya manuel)
 * Böylece kapıda yapılan her giriş, geri alma ve iptal PR ekranına kendiliğinden ve tutarlı yansır.
 */

export const GUEST_STATUSES = ["PENDING", "CHECKED_IN", "CANCELLED"] as const;
export type GuestStatus = (typeof GUEST_STATUSES)[number];
export const GUEST_STATUS_LABELS: Record<GuestStatus, string> = {
  PENDING: "Bekleniyor",
  CHECKED_IN: "İçeride",
  CANCELLED: "İptal",
};

export const GUEST_SOURCES = ["ORGANIC", "PROMOTER", "WALK_IN"] as const;
export type GuestSource = (typeof GUEST_SOURCES)[number];
export const GUEST_SOURCE_LABELS: Record<GuestSource, string> = {
  ORGANIC: "Organik",
  PROMOTER: "PR",
  WALK_IN: "Kapıda",
};

/** Gerçek giriş varsa kişi içeridedir (sonradan iptal edilse bile giriş gerçekleşmiştir). */
export function guestStatus(input: { accessStatus: string; checkedIn: boolean }): GuestStatus {
  if (input.checkedIn) return "CHECKED_IN";
  return input.accessStatus === "CANCELLED" ? "CANCELLED" : "PENDING";
}

/** Kayıt kanalı → misafir kaynağı. */
export function guestSource(channel: string): GuestSource {
  if (channel === "PR" || channel === "PR_REFERRAL") return "PROMOTER";
  if (channel === "WALK_IN") return "WALK_IN";
  return "ORGANIC";
}

/** Misafir kaynağı → kayıt kanalı ve CRM müşteri kaynağı (yeni kişi oluşturulursa). */
export const SOURCE_MAPPING: Record<GuestSource, { channel: string; customerSource: string }> = {
  ORGANIC: { channel: "STAFF", customerSource: "STAFF_GUEST" },
  PROMOTER: { channel: "PR", customerSource: "PR_GUEST" },
  WALK_IN: { channel: "WALK_IN", customerSource: "WALK_IN" },
};

export type GuestTotals = {
  /** İptal edilmemiş ya da giriş yapmış kayıt */
  registrations: number;
  people: number;
  checkedIn: number;
  admitted: number;
  pending: number;
  pendingPeople: number;
  cancelled: number;
};

/** Kayıtlardan sayaçları hesaplar; oran kişi bazındadır (giriş yapan kişi / davetli kişi). */
export function summarizeGuests(
  rows: { accessStatus: string; partySize: number; admittedCount: number | null }[],
): GuestTotals & { checkInRate: number } {
  const totals: GuestTotals = { registrations: 0, people: 0, checkedIn: 0, admitted: 0, pending: 0, pendingPeople: 0, cancelled: 0 };
  for (const row of rows) {
    const status = guestStatus({ accessStatus: row.accessStatus, checkedIn: row.admittedCount !== null });
    if (status === "CANCELLED") {
      totals.cancelled += 1;
      continue;
    }
    totals.registrations += 1;
    totals.people += row.partySize;
    if (status === "CHECKED_IN") {
      totals.checkedIn += 1;
      totals.admitted += row.admittedCount ?? 0;
    } else {
      totals.pending += 1;
      totals.pendingPeople += row.partySize;
    }
  }
  return { ...totals, checkInRate: totals.people > 0 ? Math.min(1, totals.admitted / totals.people) : 0 };
}
