/**
 * QR Menü tasarım sabitleri, tipleri ve saf yardımcılar.
 * Bu dosya "server-only" DEĞİLDİR: hem servis katmanı hem de istemci bileşenleri kullanır.
 */

// ─────────────────────────────────────────────── Seçenek listeleri

export const THEME_STYLES = ["MINIMAL", "CLASSIC", "BOLD", "CARDS", "GRID", "EDITORIAL"] as const;
export type ThemeStyle = (typeof THEME_STYLES)[number];

export const FONT_PAIRS = ["GROTESK", "SERIF", "CONDENSED", "MONO"] as const;
export type FontPair = (typeof FONT_PAIRS)[number];
export const FONT_PAIR_LABELS: Record<FontPair, string> = {
  GROTESK: "Grotesk",
  SERIF: "Serif",
  CONDENSED: "Kondanse",
  MONO: "Mono",
};

export const CORNER_STYLES = ["SHARP", "SOFT", "ROUND"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];
export const CORNER_STYLE_LABELS: Record<CornerStyle, string> = { SHARP: "Keskin", SOFT: "Yumuşak", ROUND: "Yuvarlak" };

export const SURFACE_STYLES = ["FLAT", "OUTLINE", "FILLED"] as const;
export type SurfaceStyle = (typeof SURFACE_STYLES)[number];
export const SURFACE_STYLE_LABELS: Record<SurfaceStyle, string> = { FLAT: "Sade", OUTLINE: "Çerçeveli", FILLED: "Dolu" };

export const DENSITIES = ["COMPACT", "COMFORTABLE"] as const;
export type Density = (typeof DENSITIES)[number];
export const DENSITY_LABELS: Record<Density, string> = { COMPACT: "Sıkı", COMFORTABLE: "Ferah" };

export const HEADER_ALIGNS = ["CENTER", "LEFT"] as const;
export type HeaderAlign = (typeof HEADER_ALIGNS)[number];
export const HEADER_ALIGN_LABELS: Record<HeaderAlign, string> = { CENTER: "Ortada", LEFT: "Solda" };

export const PRICE_STYLES = ["SYMBOL", "SUFFIX", "PLAIN"] as const;
export type PriceStyle = (typeof PRICE_STYLES)[number];
export const PRICE_STYLE_LABELS: Record<PriceStyle, string> = { SYMBOL: "₺240", SUFFIX: "240 TL", PLAIN: "240" };

export const BADGES = ["NEW", "CHEF", "VEGAN", "VEGETARIAN", "GLUTEN_FREE", "SPICY", "ALCOHOL_FREE"] as const;
export type Badge = (typeof BADGES)[number];
export const BADGE_LABELS: Record<Badge, string> = {
  NEW: "Yeni",
  CHEF: "Şefin önerisi",
  VEGAN: "Vegan",
  VEGETARIAN: "Vejetaryen",
  GLUTEN_FREE: "Glutensiz",
  SPICY: "Acı",
  ALCOHOL_FREE: "Alkolsüz",
};

export const ASSET_KINDS = ["LOGO", "COVER", "ITEM_PHOTO", "CAMPAIGN"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Yükleme sınırları. Server Action gövdesi 1MB ile sınırlı olduğu için istemci görseli bunun altına sıkıştırır. */
export const ASSET_LIMITS = { maxBytes: 850_000, maxSide: 2400, minSide: 64 } as const;

export const DEFAULT_BACKGROUND = "#080808";
export const DEFAULT_ACCENT = "#f7f7f5";
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const MAX_PRICE = 1_000_000;
export const MAX_TAGLINE = 80;

/** Yüklenen görselin panel içi adresi (tenant kontrollü route handler). */
export function assetUrl(assetId: string): string {
  return `/media/menu/${assetId}`;
}

// ─────────────────────────────────────────────── Görünüm tipleri

export type MenuConfigView = {
  logoAssetId: string | null;
  logoSrc: string | null;
  coverAssetId: string | null;
  coverSrc: string | null;
  backgroundColor: string;
  accentColor: string;
  /** null = arka plana göre otomatik */
  textColor: string | null;
  themeStyle: ThemeStyle;
  fontPair: FontPair;
  cornerStyle: CornerStyle;
  surfaceStyle: SurfaceStyle;
  density: Density;
  headerAlign: HeaderAlign;
  priceStyle: PriceStyle;
  tagline: string | null;
  showImages: boolean;
  showDescriptions: boolean;
  showCategoryNav: boolean;
  showFeatured: boolean;
};

export type MenuItemView = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  imageAssetId: string | null;
  /** Yüklenmiş fotoğraf ya da eski sürümden kalan dış adres */
  imageSrc: string | null;
  badges: Badge[];
  isFeatured: boolean;
  isAvailable: boolean;
  order: number;
};

export type MenuCategoryView = {
  id: string;
  name: string;
  description: string | null;
  order: number;
  items: MenuItemView[];
};

export type MenuView = { config: MenuConfigView; categories: MenuCategoryView[] };

// ─────────────────────────────────────────────── Yardımcılar

const BADGE_SET = new Set<string>(BADGES);

/** "VEGAN,SPICY" → ["VEGAN", "SPICY"]; bilinmeyen ve tekrarlanan kodlar atılır. */
export function parseBadges(raw: string | null | undefined): Badge[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: Badge[] = [];
  for (const part of raw.split(",")) {
    const code = part.trim();
    if (BADGE_SET.has(code) && !seen.has(code)) {
      seen.add(code);
      out.push(code as Badge);
    }
  }
  return out;
}

const numberFormatters = {
  whole: new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }),
  decimal: new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

/** Tam sayılarda kuruş gösterilmez: 240 → "₺240", 240.5 → "₺240,50". */
export function formatPrice(value: number, style: PriceStyle = "SYMBOL"): string {
  const number = (Number.isInteger(value) ? numberFormatters.whole : numberFormatters.decimal).format(value);
  if (style === "SUFFIX") return `${number} TL`;
  if (style === "PLAIN") return number;
  return `₺${number}`;
}

/** Arka plan rengi işletme tarafından seçildiği için yazı rengi okunabilirliğe göre hesaplanır (WCAG bağıl parlaklık). */
export function readableForeground(hex: string): string {
  if (!HEX_COLOR.test(hex)) return "#f7f7f5";
  return relativeLuminance(hex) > 0.45 ? "#101010" : "#f7f7f5";
}

export function relativeLuminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** İki renk arasındaki WCAG kontrast oranı (1–21). */
export function contrastRatio(a: string, b: string): number {
  if (!HEX_COLOR.test(a) || !HEX_COLOR.test(b)) return 21;
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** #RRGGBB + saydamlık → #RRGGBBAA */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha));
  return `${hex}${Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")}`;
}
