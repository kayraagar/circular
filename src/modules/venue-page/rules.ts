import type { Channel } from "@/lib/domain";

/**
 * Mekan sayfasındaki kayıt formunun izin metinleri — istemci bileşeni de import eder.
 * Metin değişirse sürüm artırılır; kaydedilen her izinde o anki sürüm saklanır
 * (`ContactConsent.consentTextVersion`), böylece hangi metne onay verildiği kanıtlanabilir.
 */

export const VENUE_SIGNUP_CONSENT_VERSION = "venue-signup-v1";

export const VENUE_SIGNUP_CONSENT_TEXTS: Record<Channel, string> = {
  WHATSAPP: "Kampanya, etkinlik ve duyuruları WhatsApp ile almak istiyorum.",
  SMS: "Kampanya, etkinlik ve duyuruları SMS ile almak istiyorum.",
  EMAIL: "Kampanya, etkinlik ve duyuruları e-posta ile almak istiyorum.",
};

export const VENUE_SIGNUP_NOTE = "Mekan sayfasındaki kayıt formu";
