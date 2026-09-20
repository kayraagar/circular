/**
 * Menü şablonları ve önizleme için örnek içerik.
 * Şablon = hazır başlangıç ayarları; işletme sahibi seçtikten sonra her ayarı ayrıca değiştirebilir.
 * Düzen tipleri, yeni nesil dijital menülerde yaygın desenlerden türetildi
 * (metin öncelikli liste, fotoğraflı kart, fotoğraf ızgarası, büyük görselli editoryal, klasik bistro, gece/bar).
 * Saf modüldür; istemci ve sunucu birlikte kullanır.
 */

import type { MenuCategoryView, MenuConfigView, ThemeStyle } from "./theme";

export type TemplateSettings = Pick<
  MenuConfigView,
  | "backgroundColor"
  | "accentColor"
  | "textColor"
  | "fontPair"
  | "cornerStyle"
  | "surfaceStyle"
  | "density"
  | "headerAlign"
  | "priceStyle"
  | "showImages"
  | "showDescriptions"
  | "showCategoryNav"
  | "showFeatured"
>;

export type MenuTemplate = {
  id: ThemeStyle;
  name: string;
  summary: string;
  suits: string;
  settings: TemplateSettings;
};

export const MENU_TEMPLATES: readonly MenuTemplate[] = [
  {
    id: "MINIMAL",
    name: "Minimal Liste",
    summary: "Metin öncelikli, ince ayraçlar, küçük fotoğraf. En hızlı okunan düzen.",
    suits: "Kahve dükkânı, kafe, uzun içecek listeleri",
    settings: {
      backgroundColor: "#080808",
      accentColor: "#f7f7f5",
      textColor: null,
      fontPair: "GROTESK",
      cornerStyle: "SOFT",
      surfaceStyle: "FLAT",
      density: "COMFORTABLE",
      headerAlign: "CENTER",
      priceStyle: "PLAIN",
      showImages: true,
      showDescriptions: true,
      showCategoryNav: true,
      showFeatured: false,
    },
  },
  {
    id: "CARDS",
    name: "Fotoğraflı Kartlar",
    summary: "Solda fotoğraf, sağda ad-açıklama-fiyat. Teslimat uygulamalarından tanıdık.",
    suits: "Restoran, burger, bowl, günlük menü",
    settings: {
      backgroundColor: "#111111",
      accentColor: "#d9c7a7",
      textColor: null,
      fontPair: "GROTESK",
      cornerStyle: "ROUND",
      surfaceStyle: "OUTLINE",
      density: "COMFORTABLE",
      headerAlign: "LEFT",
      priceStyle: "SYMBOL",
      showImages: true,
      showDescriptions: true,
      showCategoryNav: true,
      showFeatured: true,
    },
  },
  {
    id: "GRID",
    name: "Galeri",
    summary: "İki sütunlu fotoğraf ızgarası; görsel iştah açar, az metin.",
    suits: "Tatlıcı, fırın, brunch, specialty kafe",
    settings: {
      backgroundColor: "#f6f3ee",
      accentColor: "#2b2b2b",
      textColor: null,
      fontPair: "GROTESK",
      cornerStyle: "ROUND",
      surfaceStyle: "FILLED",
      density: "COMPACT",
      headerAlign: "CENTER",
      priceStyle: "SYMBOL",
      showImages: true,
      showDescriptions: false,
      showCategoryNav: true,
      showFeatured: true,
    },
  },
  {
    id: "EDITORIAL",
    name: "Editoryal",
    summary: "Öne çıkan ürünlerde geniş görsel, serif başlıklar, dergi ritmi.",
    suits: "Fine dining, şef restoranı, tadım menüsü",
    settings: {
      backgroundColor: "#0e0d0b",
      accentColor: "#c9b79c",
      textColor: null,
      fontPair: "SERIF",
      cornerStyle: "SHARP",
      surfaceStyle: "FLAT",
      density: "COMFORTABLE",
      headerAlign: "LEFT",
      priceStyle: "PLAIN",
      showImages: true,
      showDescriptions: true,
      showCategoryNav: true,
      showFeatured: true,
    },
  },
  {
    id: "CLASSIC",
    name: "Bistro",
    summary: "Kâğıt tonu, ortalı serif başlıklar, noktalı fiyat ayracı. Fotoğrafsız.",
    suits: "Meyhane, bistro, şarap barı",
    settings: {
      backgroundColor: "#f3eee4",
      accentColor: "#7a4e2d",
      textColor: null,
      fontPair: "SERIF",
      cornerStyle: "SHARP",
      surfaceStyle: "FLAT",
      density: "COMFORTABLE",
      headerAlign: "CENTER",
      priceStyle: "PLAIN",
      showImages: false,
      showDescriptions: true,
      showCategoryNav: false,
      showFeatured: false,
    },
  },
  {
    id: "BOLD",
    name: "Gece",
    summary: "Kondanse büyük başlıklar, dolu kartlar, loş ışıkta yüksek kontrast.",
    suits: "Kokteyl barı, pub, gece kulübü",
    settings: {
      backgroundColor: "#0b0b0f",
      accentColor: "#e2c27f",
      textColor: null,
      fontPair: "CONDENSED",
      cornerStyle: "SOFT",
      surfaceStyle: "FILLED",
      density: "COMPACT",
      headerAlign: "LEFT",
      priceStyle: "SYMBOL",
      showImages: true,
      showDescriptions: true,
      showCategoryNav: true,
      showFeatured: true,
    },
  },
];

export function templateById(id: ThemeStyle): MenuTemplate {
  return MENU_TEMPLATES.find((t) => t.id === id) ?? MENU_TEMPLATES[0];
}

/** Şablonu uygular: düzen, tipografi ve renkler şablondan; logo, kapak ve slogan korunur. */
export function applyTemplate(config: MenuConfigView, id: ThemeStyle): MenuConfigView {
  return { ...config, ...templateById(id).settings, themeStyle: id };
}

/**
 * Menü boşken şablon farklarının görünmesi için örnek içerik.
 * Önizlemede "Örnek içerik" etiketiyle gösterilir; hiçbir zaman kaydedilmez.
 */
export const SAMPLE_CATEGORIES: MenuCategoryView[] = [
  {
    id: "ornek-baslangic",
    name: "Başlangıçlar",
    description: "Paylaşmak için küçük tabaklar",
    order: 0,
    items: [
      sample("ornek-1", "ornek-baslangic", "Közlenmiş patlıcan ezmesi", "Tahin, nar ekşisi, köz ekmek", 185, ["VEGAN"], false),
      sample("ornek-2", "ornek-baslangic", "Tereyağlı karides", "Sarımsak, pul biber, limon", 340, ["SPICY"], true),
    ],
  },
  {
    id: "ornek-ana",
    name: "Ana Yemekler",
    description: null,
    order: 1,
    items: [
      sample("ornek-3", "ornek-ana", "Ağır ateşte kuzu incik", "Beğendi, közlenmiş sebze", 690, ["CHEF"], true),
      sample("ornek-4", "ornek-ana", "Mantarlı risotto", "Parmesan, taze kekik", 420, ["VEGETARIAN"], false),
    ],
  },
  {
    id: "ornek-kokteyl",
    name: "Kokteyller",
    description: "Ev yapımı şuruplarla",
    order: 2,
    items: [
      sample("ornek-5", "ornek-kokteyl", "Füme portakal", "Bourbon, portakal kabuğu, tütsü", 480, ["NEW"], false),
      sample("ornek-6", "ornek-kokteyl", "Bahçe tonik", "Salatalık, fesleğen, tonik", 260, ["ALCOHOL_FREE"], false),
    ],
  },
  {
    id: "ornek-tatli",
    name: "Tatlılar",
    description: null,
    order: 3,
    items: [sample("ornek-7", "ornek-tatli", "Fırın sütlaç", "Tarçın, kavrulmuş fındık", 190, ["GLUTEN_FREE"], false)],
  },
];

function sample(
  id: string,
  categoryId: string,
  name: string,
  description: string,
  price: number,
  badges: MenuCategoryView["items"][number]["badges"],
  isFeatured: boolean,
): MenuCategoryView["items"][number] {
  return {
    id,
    categoryId,
    name,
    description,
    price,
    imageAssetId: null,
    imageSrc: null,
    badges,
    isFeatured,
    isAvailable: true,
    order: 0,
  };
}
