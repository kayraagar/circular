/**
 * Faz bayrakları. Bir yetenek gerçekten çalışana kadar false kalır;
 * arayüz bu bayraklara bakarak ölçülmeyen metrikleri göstermez.
 */
export const features = {
  /** QR / manuel check-in. Kapalıyken geçmiş etkinliklerde "gelmedi" (no-show) hesaplanmaz. */
  checkIn: true,
  perks: true,
  prPortal: false,
  /** Müşteriye açık menü (/m/[slug]) */
  publicMenu: true,
  /** Menüden kayıt formu (/m/[slug]/katil) */
  publicSignup: true,
  campaigns: false,
  aiAssistant: false,
} as const;
