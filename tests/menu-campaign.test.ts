import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import { createPerk, setPerkStatus } from "@/modules/perks/service";
import { findPassByToken } from "@/modules/passes/internal";
import { cleanupOrphanAssets, uploadMenuAsset } from "@/modules/menu/assets";
import { SIGNUP_CONSENT_TEXT_VERSION } from "@/modules/menu/campaign";
import { getCampaignOptions, getMenuCampaign, saveMenuCampaign } from "@/modules/menu/campaign-service";
import { getPublicMenu, publicSignup, readPublicMenuAssetBySlug, resetSignupRateLimit } from "@/modules/menu/public";
import { createCategory, createMenuItem, saveMenuConfig } from "@/modules/menu/service";
import { makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
let perk: { id: string };

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(97);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const upload = (ctx: T["owner"], kind: string) => uploadMenuAsset(ctx, { kind, file: new Blob([pngBytes(800, 600) as BlobPart], { type: "image/png" }) });
const signup = (fields: Record<string, unknown>, ip = "10.0.0.1") => publicSignup(A.tenant.slug, fields, { ip });

before(async () => {
  await resetDb();
  A = await makeTenant("orbita-test");
  B = await makeTenant("lumen-test");
  perk = await createPerk(A.owner, { name: "Hoş geldin kokteyli", venueId: A.venue.id, perCustomerLimit: "1" });
});

beforeEach(() => resetSignupRateLimit());

after(async () => {
  await db.$disconnect();
});

describe("kampanya popup ayarları", () => {
  test("doğrulama, tenant sınırları ve roller", async () => {
    const bPerk = await createPerk(B.owner, { name: "B ikramı", perCustomerLimit: "1" });
    const logo = await upload(A.owner, "LOGO");
    const valid = { title: "Üye ol, ilk kokteyl bizden", isActive: "1" };

    await assert.rejects(saveMenuCampaign(A.owner, { ...valid, title: "X" }), ValidationError);
    await assert.rejects(saveMenuCampaign(A.owner, { ...valid, delaySeconds: "45" }), ValidationError);
    await assert.rejects(saveMenuCampaign(A.owner, { ...valid, privacyUrl: "javascript:alert(1)" }), ValidationError);
    await assert.rejects(saveMenuCampaign(A.owner, { ...valid, perkId: bPerk.id }), ValidationError, "başka işletmenin avantajı");
    await assert.rejects(saveMenuCampaign(A.owner, { ...valid, venueId: B.venue.id }), ValidationError, "başka işletmenin mekanı");
    await assert.rejects(saveMenuCampaign(A.owner, { ...valid, imageAssetId: logo.assetId }), ValidationError, "logo popup görseli olamaz");
    await assert.rejects(saveMenuCampaign(A.door, valid), ForbiddenError);
    await assert.rejects(getMenuCampaign(A.waiter), ForbiddenError);

    const image = await upload(A.owner, "CAMPAIGN");
    const saved = await saveMenuCampaign(A.crm, {
      ...valid,
      ctaLabel: "",
      perkId: perk.id,
      delaySeconds: "2",
      privacyUrl: "https://ornek.test/kvkk",
      imageAssetId: image.assetId,
    });
    assert.equal(saved.isActive, true);
    assert.equal(saved.ctaLabel, "Hemen katıl");
    assert.equal(saved.perkName, "Hoş geldin kokteyli");
    assert.equal(saved.venueId, A.venue.id, "avantajın mekanı üyelik mekanı olur");
    assert.equal(await db.menuCampaign.count({ where: { tenantId: A.tenant.id } }), 1);

    // Kampanya görseli "kullanılmayan görsel" temizliğinde silinmez
    await db.menuAsset.update({ where: { id: image.assetId }, data: { createdAt: new Date(Date.now() - 48 * 3600 * 1000) } });
    await cleanupOrphanAssets(A.tenant.id);
    assert.equal(await db.menuAsset.count({ where: { id: image.assetId } }), 1);

    const options = await getCampaignOptions(A.owner);
    assert.ok(options.perks.some((p) => p.id === perk.id));
    assert.ok(!options.perks.some((p) => p.id === bPerk.id));
  });

  test("çok mekanlı işletmede üyelik mekanı seçilmeden yayına alınamaz", async () => {
    const C = await makeTenant("cok-mekan");
    await db.venue.create({ data: { tenantId: C.tenant.id, name: "İkinci", slug: "cok-mekan-2", type: "CAFE" } });
    await assert.rejects(saveMenuCampaign(C.owner, { title: "Üye ol", isActive: "1" }), ValidationError);
    const draft = await saveMenuCampaign(C.owner, { title: "Üye ol", isActive: "0" });
    assert.equal(draft.isActive, false, "kapalı taslak kaydedilebilir");
  });
});

describe("herkese açık menü", () => {
  test("yalnızca görünür içerik, yayındaki kampanya ve kaydedilmiş görseller", async () => {
    const logo = await upload(A.owner, "LOGO");
    await saveMenuConfig(A.owner, { logoAssetId: logo.assetId });
    const category = await createCategory(A.owner, { name: "Kokteyller" });
    const shownPhoto = await upload(A.owner, "ITEM_PHOTO");
    const hiddenPhoto = await upload(A.owner, "ITEM_PHOTO");
    const orphan = await upload(A.owner, "ITEM_PHOTO");
    await createMenuItem(A.owner, { categoryId: category.id, name: "Negroni", price: "420", imageAssetId: shownPhoto.assetId });
    await createMenuItem(A.owner, { categoryId: category.id, name: "Gizli tarif", price: "999", imageAssetId: hiddenPhoto.assetId, isAvailable: "0" });
    await createCategory(A.owner, { name: "Boş kategori" });

    assert.equal(await getPublicMenu("olmayan-isletme"), null);
    assert.equal(await getPublicMenu("../etc"), null);

    const menu = await getPublicMenu(A.tenant.slug);
    assert.ok(menu);
    assert.equal(menu.hasContent, true);
    const json = JSON.stringify(menu);
    assert.ok(!json.includes("Gizli tarif"), "gizli ürün açık menüde yok");
    assert.ok(!json.includes("Boş kategori"), "boş kategori gösterilmez");
    assert.equal(menu.menu.config.logoSrc, `/m/${A.tenant.slug}/media/${logo.assetId}`);
    assert.ok(menu.menu.categories[0].items[0].imageSrc?.startsWith(`/m/${A.tenant.slug}/media/`));
    assert.equal(menu.campaign?.title, "Üye ol, ilk kokteyl bizden");

    assert.ok(await readPublicMenuAssetBySlug(A.tenant.slug, logo.assetId));
    assert.ok(await readPublicMenuAssetBySlug(A.tenant.slug, shownPhoto.assetId));
    assert.equal(await readPublicMenuAssetBySlug(A.tenant.slug, hiddenPhoto.assetId), null, "gizli ürünün görseli açılmaz");
    assert.equal(await readPublicMenuAssetBySlug(A.tenant.slug, orphan.assetId), null, "kaydedilmemiş görsel açılmaz");
    assert.equal(await readPublicMenuAssetBySlug(B.tenant.slug, logo.assetId), null, "başka işletmenin adresinden erişilemez");

    await db.tenant.update({ where: { id: A.tenant.id }, data: { status: "SUSPENDED" } });
    assert.equal(await getPublicMenu(A.tenant.slug), null, "askıya alınmış işletmenin menüsü kapanır");
    await db.tenant.update({ where: { id: A.tenant.id }, data: { status: "ACTIVE" } });

    const bMenu = await getPublicMenu(B.tenant.slug);
    assert.equal(bMenu?.hasContent, false);
    assert.equal(bMenu?.campaign, null);
  });

  test("süresi dolan veya arşivlenen ikram popup'ta vaat edilmez", async () => {
    await setPerkStatus(A.owner, perk.id, "ARCHIVED");
    const menu = await getPublicMenu(A.tenant.slug);
    assert.ok(menu?.campaign);
    assert.equal(menu.campaign.perkName, null);
    await setPerkStatus(A.owner, perk.id, "ACTIVE");
    assert.equal((await getPublicMenu(A.tenant.slug))?.campaign?.perkName, "Hoş geldin kokteyli");
  });
});

describe("menüden kayıt", () => {
  test("yeni kişi: CRM kaydı, yalnızca işaretlenen izinler, üyelik ve ikram QR'ı", async () => {
    const result = await signup({ firstName: "Deniz", lastName: "Kaya", phone: "0532 555 12 34", email: "", consents: ["WHATSAPP"] });
    assert.equal(result.status, "created");
    assert.ok(result.status === "created" && result.perk === "ISSUED" && result.passToken);

    const customer = await db.customer.findFirstOrThrow({ where: { tenantId: A.tenant.id, phone: "+905325551234" } });
    assert.equal(customer.source, "QR_MENU");
    assert.equal(customer.sourceVenueId, A.venue.id);
    assert.equal(customer.createdByUserId, null);

    const consents = await db.contactConsent.findMany({ where: { customerId: customer.id } });
    assert.equal(consents.length, 1, "yalnızca işaretlenen kanal");
    assert.equal(consents[0].channel, "WHATSAPP");
    assert.equal(consents[0].source, "PUBLIC_SIGNUP");
    assert.equal(consents[0].consentTextVersion, SIGNUP_CONSENT_TEXT_VERSION);

    const memberships = await db.venueMembership.findMany({ where: { customerId: customer.id } });
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0].source, "QR_MENU");

    const pass = await findPassByToken(result.passToken!);
    assert.equal(pass?.purpose, "PERK_REDEMPTION");
    assert.equal(pass?.customerId, customer.id);
    assert.equal(pass?.perkId, perk.id);
    assert.equal(pass?.issuedByUserId, null);

    const log = await db.activityLog.findFirst({ where: { tenantId: A.tenant.id, action: "customer.self_registered", customerId: customer.id } });
    assert.ok(log);
    assert.equal(log.actorUserId, null);
    assert.equal(await db.customer.count({ where: { tenantId: B.tenant.id, phone: "+905325551234" } }), 0);
  });

  test("kayıtlı iletişim bilgisi: hiçbir şey değişmez, ikram verilmez", async () => {
    const existing = await createCustomer(A.owner, { firstName: "Mevcut", lastName: "Müşteri", phone: "0532 555 00 01" });
    const result = await signup({ firstName: "Başkası", lastName: "Deniyor", phone: "+90 532 555 00 01", consents: ["SMS", "WHATSAPP"] });
    assert.equal(result.status, "existing");

    const after = await db.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(after.firstName, "Mevcut");
    assert.equal(await db.contactConsent.count({ where: { customerId: existing.id } }), 0);
    assert.equal(await db.pass.count({ where: { customerId: existing.id } }), 0);
    assert.equal(await db.venueMembership.count({ where: { customerId: existing.id } }), 0);
  });

  test("doğrulama, bal küpü ve hız sınırı", async () => {
    await assert.rejects(signup({ firstName: "Ad", lastName: "Soyad", phone: "", email: "a@ornek.test" }), ValidationError, "telefon zorunlu");
    await assert.rejects(signup({ firstName: "Ad", lastName: "Soyad", phone: "123" }), ValidationError);
    await assert.rejects(signup({ firstName: "Ad", lastName: "Soyad", phone: "0532 555 44 44", consents: ["EMAIL"] }), ValidationError, "e-posta izni için adres");
    await assert.rejects(signup({ firstName: "Ad", lastName: "Soyad", phone: "0532 555 44 44", consents: ["TELEGRAM"] }), ValidationError);
    await assert.rejects(publicSignup("olmayan-isletme", { firstName: "Ad", lastName: "Soyad", phone: "0532 555 44 44" }, { ip: "1" }), NotFoundError);

    resetSignupRateLimit();
    const bot = await signup({ firstName: "Bot", lastName: "Bot", phone: "0532 555 66 66", website: "http://spam.test" });
    assert.equal(bot.status, "ignored");
    assert.equal(await db.customer.count({ where: { phone: "+905325556666" } }), 0, "bal küpü doluysa kayıt yapılmaz");

    resetSignupRateLimit();
    for (let i = 0; i < 5; i++) {
      await assert.rejects(signup({ firstName: "", lastName: "", phone: "" }, "9.9.9.9"), ValidationError);
    }
    await assert.rejects(signup({ firstName: "Ad", lastName: "Soyad", phone: "0532 555 77 77" }, "9.9.9.9"), (e) => e instanceof ConflictError && e.code === "RATE_LIMITED");
    assert.equal((await signup({ firstName: "Başka", lastName: "Cihaz", phone: "0532 555 77 77" }, "9.9.9.10")).status, "created", "başka IP etkilenmez");
  });

  test("ikram geçersizse kayıt olur ama QR verilmez", async () => {
    await setPerkStatus(A.owner, perk.id, "ARCHIVED");
    const result = await signup({ firstName: "Geç", lastName: "Kalan", phone: "0532 555 88 88" });
    assert.ok(result.status === "created" && result.perk === "UNAVAILABLE" && result.passToken === null);
    await setPerkStatus(A.owner, perk.id, "ACTIVE");
  });

  test("aynı numarayla eşzamanlı iki gönderim tek kayıt oluşturur", async () => {
    const fields = { firstName: "Aynı", lastName: "Anda", phone: "0532 555 99 99" };
    const results = await Promise.all([signup(fields, "20.0.0.1"), signup(fields, "20.0.0.2")]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["created", "existing"]);
    assert.equal(await db.customer.count({ where: { tenantId: A.tenant.id, phone: "+905325559999" } }), 1);
  });
});
