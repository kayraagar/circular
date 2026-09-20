/**
 * Menü kampanya popup'ı ve herkese açık kayıt — saf tipler, sabitler ve adres yardımcıları.
 * "server-only" değildir; istemci bileşenleri de kullanır.
 */

import type { Channel } from "@/lib/domain";

export const CAMPAIGN_LIMITS = { title: 60, description: 220, cta: 24, maxDelaySeconds: 30 } as const;

export type MenuCampaignView = {
  isActive: boolean;
  title: string;
  description: string | null;
  ctaLabel: string;
  imageAssetId: string | null;
  imageSrc: string | null;
  perkId: string | null;
  perkName: string | null;
  perkTerms: string | null;
  venueId: string | null;
  delaySeconds: number;
  privacyUrl: string | null;
};

export const EMPTY_CAMPAIGN: MenuCampaignView = {
  isActive: false,
  title: "",
  description: null,
  ctaLabel: "Hemen katıl",
  imageAssetId: null,
  imageSrc: null,
  perkId: null,
  perkName: null,
  perkTerms: null,
  venueId: null,
  delaySeconds: 3,
  privacyUrl: null,
};

/**
 * Kayıt formundaki iletişim izni metinleri. Metin değişirse sürüm artırılır;
 * kaydedilen her izinde o anki sürüm saklanır (ContactConsent.consentTextVersion).
 */
export const SIGNUP_CONSENT_TEXT_VERSION = "menu-signup-v1";

export const SIGNUP_CONSENT_TEXTS: Record<Channel, string> = {
  WHATSAPP: "Kampanya, ikram ve etkinlik duyurularını WhatsApp ile almak istiyorum.",
  SMS: "Kampanya, ikram ve etkinlik duyurularını SMS ile almak istiyorum.",
  EMAIL: "Kampanya, ikram ve etkinlik duyurularını e-posta ile almak istiyorum.",
};

export function publicMenuPath(slug: string): string {
  return `/m/${slug}`;
}

export function signupPath(slug: string): string {
  return `/m/${slug}/katil`;
}

/** Herkese açık menü görseli: yalnızca kaydedilmiş menüde kullanılan görseller servis edilir. */
export function publicAssetUrl(slug: string, assetId: string): string {
  return `/m/${slug}/media/${assetId}`;
}
