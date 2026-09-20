/**
 * Marka yapılandırması — ürün adı yalnızca buradan okunur.
 * Ad değişirse (ör. önceki varyant "Circlular") yalnızca bu dosya güncellenir.
 */
export const brand = {
  name: "Circular",
  /** Arama/yönlendirme vb. için eski yazımlar. Arayüzde gösterilmez. */
  legacyNames: ["Circlular"],
  tagline: "Mekanlar için müşteri, guest ve kampanya platformu",
  /**
   * Nihai logo sağlandığında public/brand/ altına koyup yolunu buraya yazın.
   * null iken geçici çember sembolü gösterilir (nihai logo değildir).
   */
  logoSrc: null as string | null,
  supportEmail: null as string | null,
} as const;

/** Son müşteriye açık mekan sayfalarında başlık biçimi: "[Mekan Adı] — Circular" */
export function venueExperienceTitle(venueName: string) {
  return `${venueName} — ${brand.name}`;
}
