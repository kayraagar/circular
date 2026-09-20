import "server-only";
import { z } from "zod";
import type { MenuConfig, MenuItem } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText } from "@/lib/normalize";
import { isOneOf } from "@/lib/domain";
import { logActivity } from "@/modules/activity/service";
import { deleteAssetsIfUnused, findUsableAsset } from "./assets";
import {
  BADGES,
  CORNER_STYLES,
  DEFAULT_ACCENT,
  DEFAULT_BACKGROUND,
  DENSITIES,
  FONT_PAIRS,
  HEADER_ALIGNS,
  HEX_COLOR,
  MAX_PRICE,
  MAX_TAGLINE,
  PRICE_STYLES,
  SURFACE_STYLES,
  THEME_STYLES,
  assetUrl,
  parseBadges,
  type MenuCategoryView,
  type MenuConfigView,
  type MenuItemView,
  type MenuView,
} from "./theme";

/**
 * QR Menü oluşturucu — servis katmanı.
 * Her sorgu tenant'ı açıkça filtreler; ürün–kategori ve ayar/ürün–görsel bağları
 * veritabanında composite FK ([…Id, tenantId]) ile de korunur.
 */

export type { MenuCategoryView, MenuConfigView, MenuItemView, MenuView } from "./theme";

const MAX_BADGES_PER_ITEM = 3;

// ─────────────────────────────────────────────── Doğrulama yardımcıları

function collector() {
  const errors: FieldErrors = {};
  const add = (key: string, message: string) => (errors[key] = [...(errors[key] ?? []), message]);
  const throwIfAny = () => {
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  };
  return { add, throwIfAny };
}

type Add = (key: string, message: string) => void;

function pick<T extends readonly string[]>(list: T, value: string, key: string, add: Add): T[number] {
  if (isOneOf(list, value)) return value;
  add(key, "Geçerli bir seçenek seçin.");
  return list[0];
}

function hexColor(value: string, key: string, add: Add): string {
  if (HEX_COLOR.test(value)) return value.toLowerCase();
  add(key, "Renk #RRGGBB biçiminde olmalı (ör. #080808).");
  return DEFAULT_BACKGROUND;
}

function isTruthy(value: string): boolean {
  return value === "1" || value === "true" || value === "on";
}

/** Tasarım bayrağı: "1"/"true"/"on" = açık, "0"/"false" = kapalı, boş = varsayılan. */
function flag(value: string, fallback: boolean): boolean {
  return value === "" ? fallback : isTruthy(value);
}

/** "120,50" ve "120.50" aynı kabul edilir; iki ondalığa yuvarlanır. */
function parsePrice(raw: string, add: Add): number {
  if (!raw) {
    add("price", "Fiyat girin.");
    return 0;
  }
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) {
    add("price", `Fiyat 0 ile ${MAX_PRICE.toLocaleString("tr-TR")} arasında bir sayı olmalı.`);
    return 0;
  }
  return Math.round(n * 100) / 100;
}

function parseOrder(raw: string, fallback: number, add: Add): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 9999) {
    add("order", "Sıra 0 ile 9999 arasında tam sayı olmalı.");
    return fallback;
  }
  return n;
}

// ─────────────────────────────────────────────── Görünüm dönüşümleri

/** src: görsel adresi üretici — panelde oturumlu route, herkese açık menüde /m/[slug]/media. */
export function toConfigView(config: MenuConfig | null, src: (assetId: string) => string = assetUrl): MenuConfigView {
  const pickOr = <T extends readonly string[]>(list: T, value: string | undefined): T[number] =>
    value !== undefined && isOneOf(list, value) ? value : list[0];
  return {
    logoAssetId: config?.logoAssetId ?? null,
    logoSrc: config?.logoAssetId ? src(config.logoAssetId) : (config?.logoUrl ?? null),
    coverAssetId: config?.coverAssetId ?? null,
    coverSrc: config?.coverAssetId ? src(config.coverAssetId) : null,
    backgroundColor: config?.backgroundColor ?? DEFAULT_BACKGROUND,
    accentColor: config?.accentColor ?? DEFAULT_ACCENT,
    textColor: config?.textColor ?? null,
    themeStyle: pickOr(THEME_STYLES, config?.themeStyle),
    fontPair: pickOr(FONT_PAIRS, config?.fontPair),
    cornerStyle: config ? pickOr(CORNER_STYLES, config.cornerStyle) : "SOFT",
    surfaceStyle: config ? pickOr(SURFACE_STYLES, config.surfaceStyle) : "OUTLINE",
    density: config ? pickOr(DENSITIES, config.density) : "COMFORTABLE",
    headerAlign: pickOr(HEADER_ALIGNS, config?.headerAlign),
    priceStyle: pickOr(PRICE_STYLES, config?.priceStyle),
    tagline: config?.tagline ?? null,
    showImages: config?.showImages ?? true,
    showDescriptions: config?.showDescriptions ?? true,
    showCategoryNav: config?.showCategoryNav ?? true,
    showFeatured: config?.showFeatured ?? true,
  };
}

export function toItemView(item: MenuItem, src: (assetId: string) => string = assetUrl): MenuItemView {
  return {
    id: item.id,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    price: item.price,
    imageAssetId: item.imageAssetId,
    imageSrc: item.imageAssetId ? src(item.imageAssetId) : item.image,
    badges: parseBadges(item.badges),
    isFeatured: item.isFeatured,
    isAvailable: item.isAvailable,
    order: item.order,
  };
}

// ─────────────────────────────────────────────── Okuma

/** Builder sayfası ve canlı önizleme için tüm menü. */
export async function getMenu(ctx: ServiceContext): Promise<MenuView> {
  assertCan(ctx, "menu.manage");
  const [config, categories] = await Promise.all([
    db.menuConfig.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.menuCategory.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: { items: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
    }),
  ]);
  return {
    config: toConfigView(config),
    categories: categories.map(
      (c): MenuCategoryView => ({
        id: c.id,
        name: c.name,
        description: c.description,
        order: c.order,
        items: c.items.map((item) => toItemView(item)),
      }),
    ),
  };
}

// ─────────────────────────────────────────────── Tasarım ayarları

const configSchema = z.object({
  logoAssetId: z.string().trim().max(64).default(""),
  coverAssetId: z.string().trim().max(64).default(""),
  legacyLogoUrl: z.string().trim().max(500).default(""),
  backgroundColor: z.string().trim().default(DEFAULT_BACKGROUND),
  accentColor: z.string().trim().default(DEFAULT_ACCENT),
  textColor: z.string().trim().default(""),
  themeStyle: z.string().trim().default("MINIMAL"),
  fontPair: z.string().trim().default("GROTESK"),
  cornerStyle: z.string().trim().default("SOFT"),
  surfaceStyle: z.string().trim().default("OUTLINE"),
  density: z.string().trim().default("COMFORTABLE"),
  headerAlign: z.string().trim().default("CENTER"),
  priceStyle: z.string().trim().default("SYMBOL"),
  tagline: z.string().trim().max(MAX_TAGLINE, `Slogan en fazla ${MAX_TAGLINE} karakter olabilir.`).default(""),
  showImages: z.string().trim().default(""),
  showDescriptions: z.string().trim().default(""),
  showCategoryNav: z.string().trim().default(""),
  showFeatured: z.string().trim().default(""),
});

export async function saveMenuConfig(ctx: ServiceContext, raw: unknown): Promise<MenuConfigView> {
  assertCan(ctx, "menu.manage");
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  const { add, throwIfAny } = collector();

  const data = {
    backgroundColor: hexColor(v.backgroundColor, "backgroundColor", add),
    accentColor: hexColor(v.accentColor, "accentColor", add),
    textColor: v.textColor ? hexColor(v.textColor, "textColor", add) : null,
    themeStyle: pick(THEME_STYLES, v.themeStyle, "themeStyle", add),
    fontPair: pick(FONT_PAIRS, v.fontPair, "fontPair", add),
    cornerStyle: pick(CORNER_STYLES, v.cornerStyle, "cornerStyle", add),
    surfaceStyle: pick(SURFACE_STYLES, v.surfaceStyle, "surfaceStyle", add),
    density: pick(DENSITIES, v.density, "density", add),
    headerAlign: pick(HEADER_ALIGNS, v.headerAlign, "headerAlign", add),
    priceStyle: pick(PRICE_STYLES, v.priceStyle, "priceStyle", add),
    tagline: v.tagline ? cleanText(v.tagline) : null,
    showImages: flag(v.showImages, true),
    showDescriptions: flag(v.showDescriptions, true),
    showCategoryNav: flag(v.showCategoryNav, true),
    showFeatured: flag(v.showFeatured, true),
  };

  const [logo, cover] = await Promise.all([
    findUsableAsset(ctx, v.logoAssetId, ["LOGO"]),
    findUsableAsset(ctx, v.coverAssetId, ["COVER"]),
  ]);
  if (!logo.valid) add("logoAssetId", "Logo bulunamadı; yeniden yükleyin.");
  if (!cover.valid) add("coverAssetId", "Kapak görseli bulunamadı; yeniden yükleyin.");
  throwIfAny();

  const existing = await db.menuConfig.findUnique({ where: { tenantId: ctx.tenantId } });
  // Eski sürümden kalan logo adresi yalnızca olduğu gibi korunabilir; yeni adres girilemez.
  const logoUrl = !logo.id && existing?.logoUrl && v.legacyLogoUrl === existing.logoUrl ? existing.logoUrl : null;
  const row = { ...data, logoUrl, logoAssetId: logo.id, coverAssetId: cover.id };

  const saved = await db.$transaction(async (tx) => {
    const config = await tx.menuConfig.upsert({
      where: { tenantId: ctx.tenantId },
      create: { tenantId: ctx.tenantId, ...row },
      update: row,
    });
    // Değiştirilen veya kaldırılan eski logo/kapak başka yerde kullanılmıyorsa silinir.
    await deleteAssetsIfUnused(tx, ctx.tenantId, [existing?.logoAssetId, existing?.coverAssetId]);
    await logActivity(tx, ctx, {
      action: "menu.config_updated",
      entityType: "menu",
      entityId: config.id,
      metadata: { themeStyle: config.themeStyle, backgroundColor: config.backgroundColor, hasLogo: !!(logo.id || logoUrl) },
    });
    return config;
  });
  return toConfigView(saved);
}

// ─────────────────────────────────────────────── Kategoriler

const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Kategori adı en az 2 karakter olmalı.")
    .max(60, "Kategori adı en fazla 60 karakter olabilir."),
  description: z.string().trim().max(140, "Kategori açıklaması en fazla 140 karakter olabilir.").default(""),
  order: z.string().trim().default(""),
});

async function findCategory(ctx: ServiceContext, id: string) {
  if (!id) throw new ValidationError({ categoryId: ["Kategori seçin."] });
  const category = await db.menuCategory.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!category) throw new NotFoundError("Kategori bulunamadı.");
  return category;
}

export async function createCategory(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx, "menu.manage");
  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const { add, throwIfAny } = collector();

  const last = await db.menuCategory.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { order: "desc" } });
  const order = parseOrder(parsed.data.order, (last?.order ?? -1) + 1, add);
  throwIfAny();

  return db.$transaction(async (tx) => {
    const category = await tx.menuCategory.create({
      data: {
        tenantId: ctx.tenantId,
        name: cleanText(parsed.data.name),
        description: parsed.data.description ? cleanText(parsed.data.description) : null,
        order,
      },
    });
    await logActivity(tx, ctx, {
      action: "menu.category_changed",
      entityType: "menu_category",
      entityId: category.id,
      metadata: { operation: "created", categoryName: category.name },
    });
    return category;
  });
}

export async function updateCategory(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx, "menu.manage");
  const existing = await findCategory(ctx, id);
  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const { add, throwIfAny } = collector();
  const order = parseOrder(parsed.data.order, existing.order, add);
  throwIfAny();

  return db.$transaction(async (tx) => {
    const category = await tx.menuCategory.update({
      where: { id: existing.id },
      data: {
        name: cleanText(parsed.data.name),
        description: parsed.data.description ? cleanText(parsed.data.description) : null,
        order,
      },
    });
    await logActivity(tx, ctx, {
      action: "menu.category_changed",
      entityType: "menu_category",
      entityId: category.id,
      metadata: { operation: "updated", categoryName: category.name },
    });
    return category;
  });
}

/** Kategori silinince ürünleri de silinir (veritabanı cascade); ürün fotoğrafları da temizlenir. */
export async function deleteCategory(ctx: ServiceContext, id: string) {
  assertCan(ctx, "menu.manage");
  const existing = await findCategory(ctx, id);
  const items = await db.menuItem.findMany({
    where: { tenantId: ctx.tenantId, categoryId: existing.id },
    select: { imageAssetId: true },
  });

  return db.$transaction(async (tx) => {
    await tx.menuCategory.delete({ where: { id: existing.id } });
    await deleteAssetsIfUnused(
      tx,
      ctx.tenantId,
      items.map((i) => i.imageAssetId),
    );
    await logActivity(tx, ctx, {
      action: "menu.category_changed",
      entityType: "menu_category",
      entityId: existing.id,
      metadata: { operation: "deleted", categoryName: existing.name, itemCount: items.length },
    });
    return { id: existing.id, itemCount: items.length };
  });
}

// ─────────────────────────────────────────────── Ürünler

const itemSchema = z.object({
  categoryId: z.string().trim().min(1, "Kategori seçin."),
  name: z.string().trim().min(2, "Ürün adı en az 2 karakter olmalı.").max(80, "Ürün adı en fazla 80 karakter olabilir."),
  description: z.string().trim().max(300, "Açıklama en fazla 300 karakter olabilir.").default(""),
  price: z.string().trim().default(""),
  imageAssetId: z.string().trim().max(64).default(""),
  legacyImage: z.string().trim().max(500).default(""),
  badges: z.string().trim().max(200).default(""),
  isFeatured: z.string().trim().default(""),
  isAvailable: z.string().trim().default("1"),
  order: z.string().trim().default(""),
});

async function findItem(ctx: ServiceContext, id: string) {
  if (!id) throw new ValidationError({ itemId: ["Ürün seçin."] });
  const item = await db.menuItem.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!item) throw new NotFoundError("Ürün bulunamadı.");
  return item;
}

async function parseItem(ctx: ServiceContext, raw: unknown, existing: MenuItem | null) {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  const { add, throwIfAny } = collector();

  // Kategori aynı tenant'ta mı? (composite FK ile birlikte ikinci koruma)
  const category = await db.menuCategory.findFirst({ where: { id: v.categoryId, tenantId: ctx.tenantId } });
  if (!category) add("categoryId", "Geçerli bir kategori seçin.");

  const price = parsePrice(v.price, add);

  const requested = v.badges ? v.badges.split(",").map((b) => b.trim()).filter(Boolean) : [];
  if (requested.some((b) => !isOneOf(BADGES, b))) add("badges", "Geçersiz rozet seçildi.");
  const badges = parseBadges(v.badges);
  if (badges.length > MAX_BADGES_PER_ITEM) add("badges", `Bir üründe en fazla ${MAX_BADGES_PER_ITEM} rozet olabilir.`);

  const photo = await findUsableAsset(ctx, v.imageAssetId, ["ITEM_PHOTO"]);
  if (!photo.valid) add("imageAssetId", "Fotoğraf bulunamadı; yeniden yükleyin.");

  let order = existing?.order ?? 0;
  if (category && !existing) {
    const last = await db.menuItem.findFirst({
      where: { tenantId: ctx.tenantId, categoryId: category.id },
      orderBy: { order: "desc" },
    });
    order = (last?.order ?? -1) + 1;
  }
  order = parseOrder(v.order, order, add);
  throwIfAny();

  // Eski sürümden kalan görsel adresi yalnızca olduğu gibi korunabilir; yeni adres girilemez.
  const image = !photo.id && existing?.image && v.legacyImage === existing.image ? existing.image : null;

  return {
    categoryName: category!.name,
    data: {
      categoryId: category!.id,
      name: cleanText(v.name),
      description: v.description ? cleanText(v.description) : null,
      price,
      image,
      imageAssetId: photo.id,
      badges: badges.join(","),
      // Ürün bayraklarında boş değer "kapalı"dır (işaretlenmemiş onay kutusu); alan hiç gönderilmezse şema varsayılanı uygulanır.
      isFeatured: isTruthy(v.isFeatured),
      isAvailable: isTruthy(v.isAvailable),
      order,
    },
  };
}

export async function createMenuItem(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx, "menu.manage");
  const { categoryName, data } = await parseItem(ctx, raw, null);

  return db.$transaction(async (tx) => {
    const item = await tx.menuItem.create({ data: { tenantId: ctx.tenantId, ...data } });
    await logActivity(tx, ctx, {
      action: "menu.item_changed",
      entityType: "menu_item",
      entityId: item.id,
      metadata: { operation: "created", itemName: item.name, categoryName, price: item.price },
    });
    return toItemView(item);
  });
}

export async function updateMenuItem(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx, "menu.manage");
  const existing = await findItem(ctx, id);
  const { categoryName, data } = await parseItem(ctx, raw, existing);

  return db.$transaction(async (tx) => {
    const item = await tx.menuItem.update({ where: { id: existing.id }, data });
    if (existing.imageAssetId !== item.imageAssetId) {
      await deleteAssetsIfUnused(tx, ctx.tenantId, [existing.imageAssetId]);
    }
    await logActivity(tx, ctx, {
      action: "menu.item_changed",
      entityType: "menu_item",
      entityId: item.id,
      metadata: { operation: "updated", itemName: item.name, categoryName, price: item.price },
    });
    return toItemView(item);
  });
}

export async function deleteMenuItem(ctx: ServiceContext, id: string) {
  assertCan(ctx, "menu.manage");
  const existing = await findItem(ctx, id);

  return db.$transaction(async (tx) => {
    await tx.menuItem.delete({ where: { id: existing.id } });
    await deleteAssetsIfUnused(tx, ctx.tenantId, [existing.imageAssetId]);
    await logActivity(tx, ctx, {
      action: "menu.item_changed",
      entityType: "menu_item",
      entityId: existing.id,
      metadata: { operation: "deleted", itemName: existing.name },
    });
    return { id: existing.id };
  });
}
