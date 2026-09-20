import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanupOrphanAssets, inspectImage, readMenuAsset, uploadMenuAsset } from "@/modules/menu/assets";
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  getMenu,
  saveMenuConfig,
  updateCategory,
  updateMenuItem,
} from "@/modules/menu/service";
import { applyTemplate, MENU_TEMPLATES } from "@/modules/menu/templates";
import { contrastRatio, formatPrice, parseBadges, readableForeground } from "@/modules/menu/theme";
import { makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

/** Yalnızca başlığı geçerli PNG (sunucu biçimi ve boyutu başlıktan doğrular). */
function pngBytes(width: number, height: number, padding = 64): Uint8Array {
  const bytes = new Uint8Array(33 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** SOI + APP0 + SOF0 başlıklı küçük JPEG. */
function jpegBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 (uzunluk 4)
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
}

const blob = (bytes: Uint8Array, type = "image/png") => new Blob([bytes as BlobPart], { type });

before(async () => {
  await resetDb();
  A = await makeTenant("ma");
  B = await makeTenant("mb");
});

after(async () => {
  await db.$disconnect();
});

describe("saf yardımcılar", () => {
  test("görsel başlığı, fiyat biçimi, rozet ve kontrast", () => {
    assert.deepEqual(inspectImage(pngBytes(640, 480)), { mimeType: "image/png", width: 640, height: 480 });
    assert.deepEqual(inspectImage(jpegBytes(1200, 900)), { mimeType: "image/jpeg", width: 1200, height: 900 });
    assert.equal(inspectImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);

    assert.equal(formatPrice(240), "₺240");
    assert.equal(formatPrice(240.5), "₺240,50");
    assert.equal(formatPrice(1250, "SUFFIX"), "1.250 TL");
    assert.equal(formatPrice(95, "PLAIN"), "95");

    assert.deepEqual(parseBadges("VEGAN,SPICY,VEGAN,UYDURMA"), ["VEGAN", "SPICY"]);
    assert.equal(readableForeground("#f6f3ee"), "#101010");
    assert.ok(contrastRatio("#f7f7f5", "#080808") > 15);
  });

  test("şablon uygulanınca logo, kapak ve slogan korunur", () => {
    const base = { ...applyTemplate(MENU_TEMPLATES[0].settings as never, "MINIMAL"), logoAssetId: "x", logoSrc: "/media/menu/x", coverAssetId: null, coverSrc: null, tagline: "Karaköy" };
    const applied = applyTemplate(base, "CLASSIC");
    assert.equal(applied.themeStyle, "CLASSIC");
    assert.equal(applied.fontPair, "SERIF");
    assert.equal(applied.logoSrc, "/media/menu/x");
    assert.equal(applied.tagline, "Karaköy");
    assert.equal(new Set(MENU_TEMPLATES.map((t) => t.id)).size, 6);
  });
});

describe("görsel yükleme", () => {
  test("yalnızca geçerli PNG/JPEG, sınırlar içinde ve yetkili rolle", async () => {
    const logo = await uploadMenuAsset(A.owner, { kind: "LOGO", file: blob(pngBytes(512, 512)) });
    assert.match(logo.src, /^\/media\/menu\/[a-z0-9]+$/);
    assert.equal(logo.width, 512);

    const photo = await uploadMenuAsset(A.crm, { kind: "ITEM_PHOTO", file: blob(jpegBytes(1200, 900), "image/jpeg") });
    assert.equal(photo.kind, "ITEM_PHOTO");

    // Tarayıcının bildirdiği tür değil, baytlar doğrulanır
    await assert.rejects(uploadMenuAsset(A.owner, { kind: "LOGO", file: blob(new TextEncoder().encode("<svg/>"), "image/png") }), ValidationError);
    await assert.rejects(uploadMenuAsset(A.owner, { kind: "LOGO", file: blob(pngBytes(32, 32)) }), ValidationError);
    await assert.rejects(uploadMenuAsset(A.owner, { kind: "LOGO", file: blob(pngBytes(5000, 800)) }), ValidationError);
    await assert.rejects(uploadMenuAsset(A.owner, { kind: "LOGO", file: blob(pngBytes(512, 512, 900_000)) }), ValidationError);
    await assert.rejects(uploadMenuAsset(A.owner, { kind: "VIDEO", file: blob(pngBytes(512, 512)) }), ValidationError);
    await assert.rejects(uploadMenuAsset(A.owner, { kind: "LOGO", file: "metin" }), ValidationError);
    await assert.rejects(uploadMenuAsset(A.door, { kind: "LOGO", file: blob(pngBytes(512, 512)) }), ForbiddenError);
  });

  test("görsel yalnızca kendi tenant'ında okunur", async () => {
    const asset = await uploadMenuAsset(A.owner, { kind: "COVER", file: blob(jpegBytes(1600, 900), "image/jpeg") });
    const read = await readMenuAsset(A.owner, asset.assetId);
    assert.equal(read.mimeType, "image/jpeg");
    await assert.rejects(readMenuAsset(B.owner, asset.assetId), NotFoundError);
    await assert.rejects(readMenuAsset(A.owner, "../../etc/passwd"), NotFoundError);
    await assert.rejects(readMenuAsset(A.waiter, asset.assetId), ForbiddenError);
  });

  test("kullanılmayan eski yüklemeler temizlenir, kullanılanlar kalır", async () => {
    const orphan = await uploadMenuAsset(A.owner, { kind: "ITEM_PHOTO", file: blob(pngBytes(400, 400)) });
    const used = await uploadMenuAsset(A.owner, { kind: "LOGO", file: blob(pngBytes(400, 400)) });
    await saveMenuConfig(A.owner, { logoAssetId: used.assetId, backgroundColor: "#080808", themeStyle: "MINIMAL" });
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await db.menuAsset.updateMany({ where: { id: { in: [orphan.assetId, used.assetId] } }, data: { createdAt: old } });

    await cleanupOrphanAssets(A.tenant.id);
    assert.equal(await db.menuAsset.count({ where: { id: orphan.assetId } }), 0);
    assert.equal(await db.menuAsset.count({ where: { id: used.assetId } }), 1);
  });
});

describe("menü tasarım ayarları", () => {
  test("tüm kişiselleştirme alanları kaydedilir ve doğrulanır", async () => {
    const saved = await saveMenuConfig(A.owner, {
      backgroundColor: "#12141A",
      accentColor: "#E2C27F",
      textColor: "",
      themeStyle: "EDITORIAL",
      fontPair: "SERIF",
      cornerStyle: "SHARP",
      surfaceStyle: "FLAT",
      density: "COMPACT",
      headerAlign: "LEFT",
      priceStyle: "SUFFIX",
      tagline: "  Karaköy ·  18:00–02:00 ",
      showImages: "1",
      showDescriptions: "0",
      showCategoryNav: "1",
      showFeatured: "0",
    });
    assert.equal(saved.backgroundColor, "#12141a");
    assert.equal(saved.accentColor, "#e2c27f");
    assert.equal(saved.textColor, null);
    assert.equal(saved.themeStyle, "EDITORIAL");
    assert.equal(saved.tagline, "Karaköy · 18:00–02:00");
    assert.equal(saved.showDescriptions, false);
    assert.equal(saved.showFeatured, false);
    assert.equal(await db.menuConfig.count({ where: { tenantId: A.tenant.id } }), 1);

    const invalid = [
      { backgroundColor: "mavi" },
      { accentColor: "#12" },
      { textColor: "beyaz" },
      { themeStyle: "NEON" },
      { fontPair: "COMIC" },
      { cornerStyle: "OVAL" },
      { priceStyle: "EURO" },
      { tagline: "x".repeat(81) },
    ];
    for (const patch of invalid) {
      await assert.rejects(saveMenuConfig(A.owner, { backgroundColor: "#080808", ...patch }), ValidationError, JSON.stringify(patch));
    }
    await assert.rejects(saveMenuConfig(A.door, { backgroundColor: "#080808" }), ForbiddenError);
    await assert.rejects(getMenu(A.pr), ForbiddenError);
  });

  test("logo ve kapak: tür ve tenant kontrolü, değiştirilen görsel silinir", async () => {
    const logo1 = await uploadMenuAsset(A.owner, { kind: "LOGO", file: blob(pngBytes(512, 512)) });
    const logo2 = await uploadMenuAsset(A.owner, { kind: "LOGO", file: blob(pngBytes(512, 512)) });
    const cover = await uploadMenuAsset(A.owner, { kind: "COVER", file: blob(jpegBytes(1600, 900), "image/jpeg") });
    const bLogo = await uploadMenuAsset(B.owner, { kind: "LOGO", file: blob(pngBytes(512, 512)) });

    const first = await saveMenuConfig(A.owner, { logoAssetId: logo1.assetId, coverAssetId: cover.assetId });
    assert.equal(first.logoSrc, logo1.src);
    assert.equal(first.coverSrc, cover.src);

    await assert.rejects(saveMenuConfig(A.owner, { logoAssetId: bLogo.assetId }), ValidationError, "başka tenant'ın görseli");
    await assert.rejects(saveMenuConfig(A.owner, { logoAssetId: cover.assetId }), ValidationError, "kapak logo olarak kullanılamaz");

    await saveMenuConfig(A.owner, { logoAssetId: logo2.assetId, coverAssetId: "" });
    assert.equal(await db.menuAsset.count({ where: { id: logo1.assetId } }), 0, "eski logo silinir");
    assert.equal(await db.menuAsset.count({ where: { id: cover.assetId } }), 0, "kaldırılan kapak silinir");
    assert.equal(await db.menuAsset.count({ where: { id: bLogo.assetId } }), 1, "B'nin görseli etkilenmez");
  });

  test("eski sürümden kalan logo adresi yalnızca aynen korunabilir", async () => {
    await db.menuConfig.update({ where: { tenantId: A.tenant.id }, data: { logoUrl: "https://eski.test/logo.png", logoAssetId: null } });
    const kept = await saveMenuConfig(A.owner, { legacyLogoUrl: "https://eski.test/logo.png" });
    assert.equal(kept.logoSrc, "https://eski.test/logo.png");
    const replaced = await saveMenuConfig(A.owner, { legacyLogoUrl: "https://kotu.test/izleme.png" });
    assert.equal(replaced.logoSrc, null, "yeni dış adres enjekte edilemez");
  });
});

describe("kategori ve ürün yönetimi", () => {
  test("sıra otomatik artar, ad ve açıklama doğrulanır", async () => {
    const first = await createCategory(A.owner, { name: "Kokteyller", description: "Ev yapımı şuruplarla" });
    const second = await createCategory(A.owner, { name: "Başlangıçlar" });
    assert.equal(second.order, first.order + 1);
    assert.equal(first.description, "Ev yapımı şuruplarla");
    await assert.rejects(createCategory(A.owner, { name: "X" }), ValidationError);
    await assert.rejects(createCategory(A.owner, { name: "Tatlılar", description: "x".repeat(141) }), ValidationError);
    await assert.rejects(createCategory(A.door, { name: "Tatlılar" }), ForbiddenError);

    const renamed = await updateCategory(A.owner, first.id, { name: "İmza Kokteyller", order: "5" });
    assert.equal(renamed.name, "İmza Kokteyller");
    assert.equal(renamed.order, 5);
    assert.equal(renamed.description, null);
  });

  test("ürün: fiyat, rozet, öne çıkan, görünürlük ve fotoğraf", async () => {
    const category = await createCategory(A.owner, { name: "Ana Yemekler" });
    const photo = await uploadMenuAsset(A.owner, { kind: "ITEM_PHOTO", file: blob(jpegBytes(1200, 900), "image/jpeg") });
    const item = await createMenuItem(A.owner, {
      categoryId: category.id,
      name: "Ahtapot ızgara",
      price: "1250,75",
      description: "Közlenmiş patates ile",
      imageAssetId: photo.assetId,
      badges: "CHEF,GLUTEN_FREE",
      isFeatured: "1",
      isAvailable: "1",
    });
    assert.equal(item.price, 1250.75);
    assert.equal(item.imageSrc, photo.src);
    assert.deepEqual(item.badges, ["CHEF", "GLUTEN_FREE"]);
    assert.equal(item.isFeatured, true);

    await assert.rejects(createMenuItem(A.owner, { categoryId: category.id, name: "Hatalı", price: "-5" }), ValidationError);
    await assert.rejects(createMenuItem(A.owner, { categoryId: category.id, name: "Hatalı", price: "abc" }), ValidationError);
    await assert.rejects(createMenuItem(A.owner, { categoryId: category.id, name: "Hatalı", price: "10", badges: "UYDURMA" }), ValidationError);
    await assert.rejects(
      createMenuItem(A.owner, { categoryId: category.id, name: "Hatalı", price: "10", badges: "NEW,CHEF,VEGAN,SPICY" }),
      ValidationError,
      "en fazla 3 rozet",
    );
    await assert.rejects(createMenuItem(A.owner, { categoryId: "", name: "Hatalı", price: "10" }), ValidationError);

    // Görünürlük kapatılır, fotoğraf değiştirilir → eski fotoğraf silinir
    const newPhoto = await uploadMenuAsset(A.owner, { kind: "ITEM_PHOTO", file: blob(pngBytes(800, 800)) });
    const updated = await updateMenuItem(A.owner, item.id, {
      categoryId: category.id,
      name: "Ahtapot",
      price: "1300",
      imageAssetId: newPhoto.assetId,
      isAvailable: "0",
      isFeatured: "",
    });
    assert.equal(updated.price, 1300);
    assert.equal(updated.isAvailable, false);
    assert.equal(updated.isFeatured, false);
    assert.equal(updated.order, item.order, "sıra korunur");
    assert.equal(await db.menuAsset.count({ where: { id: photo.assetId } }), 0, "eski fotoğraf silinir");

    // Boş gönderilen "menüde göster" kapalı sayılır (işaretlenmemiş kutu)
    const hidden = await updateMenuItem(A.owner, item.id, {
      categoryId: category.id,
      name: "Ahtapot",
      price: "1300",
      imageAssetId: newPhoto.assetId,
      isAvailable: "",
    });
    assert.equal(hidden.isAvailable, false);
    assert.equal(await db.menuAsset.count({ where: { id: newPhoto.assetId } }), 1, "fotoğraf değişmediyse korunur");

    await deleteMenuItem(A.owner, item.id);
    assert.equal(await db.menuAsset.count({ where: { id: newPhoto.assetId } }), 0, "ürün silinince fotoğrafı da silinir");
  });

  test("kategori silinince ürünleri ve fotoğrafları da silinir", async () => {
    const category = await createCategory(A.owner, { name: "Silinecek" });
    const photo = await uploadMenuAsset(A.owner, { kind: "ITEM_PHOTO", file: blob(pngBytes(600, 600)) });
    await createMenuItem(A.owner, { categoryId: category.id, name: "Ürün 1", price: "10", imageAssetId: photo.assetId });
    await createMenuItem(A.owner, { categoryId: category.id, name: "Ürün 2", price: "20" });

    const result = await deleteCategory(A.owner, category.id);
    assert.equal(result.itemCount, 2);
    assert.equal(await db.menuItem.count({ where: { categoryId: category.id } }), 0);
    assert.equal(await db.menuAsset.count({ where: { id: photo.assetId } }), 0);
    await assert.rejects(deleteCategory(A.owner, category.id), NotFoundError);
  });
});

describe("tenant izolasyonu", () => {
  test("başka işletmenin menüsü okunamaz, değiştirilemez, görseli bağlanamaz", async () => {
    const aCategory = await createCategory(A.owner, { name: "A Kategorisi" });
    const aItem = await createMenuItem(A.owner, { categoryId: aCategory.id, name: "A Ürünü", price: "100" });
    const aPhoto = await uploadMenuAsset(A.owner, { kind: "ITEM_PHOTO", file: blob(pngBytes(500, 500)) });

    const bMenu = await getMenu(B.owner);
    assert.equal(bMenu.categories.length, 0);
    assert.ok(!JSON.stringify(bMenu).includes("A Ürünü"));

    await assert.rejects(updateCategory(B.owner, aCategory.id, { name: "Ele geçirildi" }), NotFoundError);
    await assert.rejects(deleteCategory(B.owner, aCategory.id), NotFoundError);
    await assert.rejects(updateMenuItem(B.owner, aItem.id, { categoryId: aCategory.id, name: "X", price: "1" }), NotFoundError);
    await assert.rejects(deleteMenuItem(B.owner, aItem.id), NotFoundError);

    const bCategory = await createCategory(B.owner, { name: "B Kategorisi" });
    await assert.rejects(createMenuItem(A.owner, { categoryId: bCategory.id, name: "Sızıntı", price: "10" }), ValidationError);
    await assert.rejects(
      createMenuItem(B.owner, { categoryId: bCategory.id, name: "Başkasının fotoğrafı", price: "10", imageAssetId: aPhoto.assetId }),
      ValidationError,
    );
  });

  test("veritabanı başka tenant'ın kategorisine veya görseline bağlanmayı reddeder", async () => {
    const bCategory = await db.menuCategory.findFirstOrThrow({ where: { tenantId: B.tenant.id } });
    const aCategory = await db.menuCategory.findFirstOrThrow({ where: { tenantId: A.tenant.id } });
    const aAsset = await db.menuAsset.findFirstOrThrow({ where: { tenantId: A.tenant.id } });
    await assert.rejects(
      db.menuItem.create({ data: { tenantId: A.tenant.id, categoryId: bCategory.id, name: "Ham kayıt", price: 10 } }),
      "composite FK: kategori",
    );
    await assert.rejects(
      db.menuItem.create({ data: { tenantId: B.tenant.id, categoryId: bCategory.id, name: "Ham kayıt", price: 10, imageAssetId: aAsset.id } }),
      "composite FK: görsel",
    );
    assert.ok(aCategory);
  });
});
