import { createHash, createHmac } from "node:crypto";

/**
 * Pass token'ı: HMAC-SHA256(PASS_TOKEN_SECRET, pass.id) → 24 bayt (192 bit), base64url (32 karakter).
 * - Tahmin edilemez ve kişisel veri içermez.
 * - DB'de yalnızca token'ın SHA-256 özeti tutulur; DB tek başına sızsa token üretilemez.
 * - Aynı pass için token her seferinde yeniden türetilebilir (personel QR'ı tekrar gösterebilir).
 * - Gizli anahtar değişirse tüm mevcut QR'lar geçersiz olur.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

function secret(): string {
  const value = process.env.PASS_TOKEN_SECRET;
  if (!value || value.length < 32) {
    throw new Error("PASS_TOKEN_SECRET tanımlı değil veya 32 karakterden kısa (.env dosyasını kontrol edin).");
  }
  return value;
}

export function derivePassToken(passId: string): string {
  return createHmac("sha256", secret()).update(`circular-pass:v1:${passId}`).digest().subarray(0, 24).toString("base64url");
}

export function hashPassToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedPassToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

function baseUrl(): string {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** QR içeriği: personel telefon kamerasıyla okuttuğunda doğrulama sayfası açılır. */
export function passScanUrl(token: string): string {
  return `${baseUrl()}/q/${token}`;
}

/** Müşteriye gönderilen bağlantı: QR'ın gösterildiği kişisel pass sayfası. */
export function passViewUrl(token: string): string {
  return `${baseUrl()}/pass/${token}`;
}

/** Uygulamanın dışarıdan erişilen adresiyle mutlak bağlantı (paylaşım linkleri ve QR içerikleri için). */
export function absoluteUrl(path: string): string {
  return `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
