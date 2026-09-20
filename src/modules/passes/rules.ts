/**
 * QR geçerlilik kuralları — saf fonksiyonlar (DB'ye dokunmaz, test edilebilir).
 * Durum her doğrulamada kayıtlardan yeniden hesaplanır; saklanmaz.
 */

export type PassPurpose = "EVENT_ENTRY" | "PERK_REDEMPTION";

export type PassState =
  | "VALID"
  | "USED"
  | "REVOKED"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "REGISTRATION_CANCELLED"
  | "EVENT_CANCELLED"
  | "PERK_INACTIVE"
  | "LIMIT_REACHED";

export const PASS_PURPOSE_LABELS: Record<PassPurpose, string> = {
  EVENT_ENTRY: "Giriş QR'ı",
  PERK_REDEMPTION: "Avantaj QR'ı",
};

export const PASS_STATE_LABELS: Record<PassState, string> = {
  VALID: "Geçerli",
  USED: "Kullanıldı",
  REVOKED: "İptal edilmiş kod",
  NOT_YET_VALID: "Henüz geçerli değil",
  EXPIRED: "Süresi doldu",
  REGISTRATION_CANCELLED: "Guest kaydı iptal edildi",
  EVENT_CANCELLED: "Etkinlik iptal edildi",
  PERK_INACTIVE: "Avantaj aktif değil",
  LIMIT_REACHED: "Kullanım hakkı doldu",
};

export const PASS_STATE_MESSAGES: Record<Exclude<PassState, "VALID">, string> = {
  USED: "Bu QR daha önce kullanıldı.",
  REVOKED: "Bu QR iptal edilmiş; kişiye yeni bir kod verilmiş olabilir.",
  NOT_YET_VALID: "Bu QR henüz geçerli değil.",
  EXPIRED: "Bu QR'ın geçerlilik süresi doldu.",
  REGISTRATION_CANCELLED: "Guest kaydı iptal edildiği için giriş hakkı yok.",
  EVENT_CANCELLED: "Etkinlik iptal edildiği için giriş yapılamaz.",
  PERK_INACTIVE: "Bu avantaj artık aktif değil.",
  LIMIT_REACHED: "Bu kişinin avantaj kullanım hakkı doldu.",
};

/** Giriş penceresi: etkinlik başlangıcından bu kadar saat önce açılır. */
export const ENTRY_EARLY_HOURS = 6;

/**
 * Giriş kapanışı en fazla etkinlik bitişinden bu kadar saat sonrasına ayarlanabilir.
 * Gece uzadığında geç gelen guest'lerin girişi kaydedilebilsin diye vardır.
 */
export const ENTRY_LATE_HOURS = 12;

export function entryWindow(event: { startsAt: Date; endsAt: Date; entryClosesAt: Date | null }) {
  return {
    opensAt: new Date(event.startsAt.getTime() - ENTRY_EARLY_HOURS * 3600 * 1000),
    closesAt: event.entryClosesAt ?? event.endsAt,
  };
}

type PassCore = { revokedAt: Date | null; useCount: number; maxUses: number };

export function evaluateEntryPass(
  pass: PassCore,
  registration: { accessStatus: string },
  event: { status: string; startsAt: Date; endsAt: Date; entryClosesAt: Date | null },
  now = new Date(),
): PassState {
  if (pass.revokedAt) return "REVOKED";
  if (pass.useCount >= pass.maxUses) return "USED";
  if (event.status === "CANCELLED") return "EVENT_CANCELLED";
  if (registration.accessStatus !== "ACTIVE") return "REGISTRATION_CANCELLED";
  const w = entryWindow(event);
  if (now < w.opensAt) return "NOT_YET_VALID";
  if (now > w.closesAt) return "EXPIRED";
  return "VALID";
}

export function evaluatePerkPass(
  pass: PassCore,
  perk: { status: string; validFrom: Date | null; validUntil: Date | null; perCustomerLimit: number },
  redemptionsForCustomer: number,
  now = new Date(),
): PassState {
  if (pass.revokedAt) return "REVOKED";
  if (pass.useCount >= pass.maxUses) return "USED";
  if (perk.status !== "ACTIVE") return "PERK_INACTIVE";
  if (redemptionsForCustomer >= perk.perCustomerLimit) return "LIMIT_REACHED";
  if (perk.validFrom && now < perk.validFrom) return "NOT_YET_VALID";
  if (perk.validUntil && now > perk.validUntil) return "EXPIRED";
  return "VALID";
}

/** Kısıtlı ekranlar için ad: "Ayşe Y." */
export function maskedName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0).toLocaleUpperCase("tr-TR");
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}
