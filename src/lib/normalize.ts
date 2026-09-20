import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** Boşlukları sadeleştir. */
export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

const TR_FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };

/**
 * Türkçe duyarlı arama anahtarı: "Şule YILDIZ" → "sule yildiz".
 * Önce tr-TR küçük harf (I→ı, İ→i), sonra aksanlar katlanır.
 */
export function foldText(value: string): string {
  return cleanText(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (ch) => TR_FOLD[ch] ?? ch)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return v === "" ? null : v;
}

export type PhoneResult = { ok: true; e164: string } | { ok: false } | null;

/**
 * Telefonu E.164'e çevirir. Varsayılan ülke TR: "0532 123 45 67", "532 123 4567",
 * "+90 532..." aynı sonucu verir. Boş girdide null.
 */
export function normalizePhone(value: string | null | undefined): PhoneResult {
  const raw = (value ?? "").trim();
  if (raw === "") return null;
  const intl = raw.startsWith("00") ? `+${raw.slice(2)}` : raw;
  const parsed = parsePhoneNumberFromString(intl, "TR");
  if (!parsed || !parsed.isValid()) return { ok: false };
  return { ok: true, e164: parsed.number };
}

/** Gösterim: TR numaraları ulusal biçimde (0532 123 45 67), diğerleri uluslararası. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === "TR" ? parsed.formatNational() : parsed.formatInternational();
}

/** Arama sorgusundaki rakamları telefon araması için hazırlar ("0532 12" → "53212"). */
export function phoneSearchDigits(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return digits.replace(/^0+/, "");
}

/** Kısıtlı roller için maskeli telefon (Faz 2 kapı/garson ekranları). */
export function maskPhone(e164: string | null | undefined): string {
  const formatted = formatPhone(e164);
  if (!formatted) return "";
  const digits = formatted.replace(/\D/g, "");
  return `•••• ${digits.slice(-2)}`;
}

export function fullName(c: { firstName: string; lastName: string }) {
  return cleanText(`${c.firstName} ${c.lastName}`);
}

export function initials(name: string) {
  const parts = cleanText(name).split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toLocaleUpperCase("tr-TR");
}
