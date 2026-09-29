import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createVenue, listVenues, setVenueActive, slugify, updateVenue } from "@/modules/venues/service";
import { makeTenant, resetDb } from "./helpers";

/**
 * Mekan yönetimi. Mekan silinmez (geçmiş kayıtlar ona bağlıdır), kapatılır;
 * işletmede her zaman en az bir açık mekan kalır. Kısa ad platform genelinde benzersizdir.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

before(async () => {
  await resetDb();
  A = await makeTenant("ma");
  B = await makeTenant("mb");
});

after(async () => {
  await db.$disconnect();
});

describe("Kısa ad", () => {
  test("Türkçe adlardan okunabilir kısa ad üretilir", () => {
    assert.equal(slugify("Orbita Kulüp"), "orbita-kulup");
    assert.equal(slugify("ŞİŞLİ  Şube"), "sisli-sube");
    assert.equal(slugify("  --Café--  "), "cafe");
  });
});

describe("Mekan ekleme", () => {
  test("yalnızca işletme sahibi ekler", async () => {
    await assert.rejects(createVenue(A.crm, { name: "Yeni Şube", type: "CAFE" }), ForbiddenError);
    await assert.rejects(createVenue(A.pr, { name: "Yeni Şube", type: "CAFE" }), ForbiddenError);
  });

  test("alanlar doğrulanır", async () => {
    await assert.rejects(createVenue(A.owner, { name: "X", type: "CAFE" }), ValidationError);
    await assert.rejects(createVenue(A.owner, { name: "Geçerli Ad", type: "UZAY_USSU" }), ValidationError);
    await assert.rejects(createVenue(A.owner, { name: "Geçerli Ad", type: "CAFE", slug: "Büyük Harf" }), ValidationError);
  });

  test("kısa ad addan türetilir ve çakışma sayıyla çözülür", async () => {
    const first = await createVenue(A.owner, { name: "Orbita Kulüp", type: "NIGHTCLUB", city: "İstanbul" });
    assert.equal(first.slug, "orbita-kulup");
    // Aynı ad başka işletmede de olabilir; kısa ad platform genelinde benzersizdir.
    const second = await createVenue(B.owner, { name: "Orbita Kulüp", type: "NIGHTCLUB" });
    assert.equal(second.slug, "orbita-kulup-2");

    const log = await db.activityLog.findFirst({ where: { action: "venue.created", tenantId: A.tenant.id } });
    assert.ok(log, "mekan ekleme denetim kaydına düşer");
  });

  test("elle verilen kısa ad korunur", async () => {
    const venue = await createVenue(A.owner, { name: "Sahil Kafe", type: "CAFE", slug: "sahil" });
    assert.equal(venue.slug, "sahil");
  });
});

describe("Mekan düzenleme", () => {
  test("başka işletmenin mekanı düzenlenemez", async () => {
    await assert.rejects(updateVenue(A.owner, B.venue.id, { name: "Ele Geçir", type: "CAFE" }), NotFoundError);
    const untouched = await db.venue.findUniqueOrThrow({ where: { id: B.venue.id } });
    assert.equal(untouched.name, "Mekan mb");
  });

  test("ad ve tür güncellenir, kısa ad korunur", async () => {
    const venue = await createVenue(A.owner, { name: "Eski Ad", type: "PUB" });
    const updated = await updateVenue(A.owner, venue.id, { name: "Yeni Ad", type: "RESTAURANT", city: "Ankara" });
    assert.equal(updated.name, "Yeni Ad");
    assert.equal(updated.type, "RESTAURANT");
    assert.equal(updated.city, "Ankara");
    assert.equal(updated.slug, venue.slug, "kısa ad kendiliğinden değişmez");
  });

  test("kullanılan kısa ad alınamaz", async () => {
    const venue = await createVenue(A.owner, { name: "Çakışma Testi", type: "CAFE" });
    // "sahil" başka bir mekanda kullanılıyor; sayıyla benzersizleştirilir.
    const updated = await updateVenue(A.owner, venue.id, { name: "Çakışma Testi", type: "CAFE", slug: "sahil" });
    assert.equal(updated.slug, "sahil-2");
  });
});

describe("Mekan kapatma", () => {
  test("son açık mekan kapatılamaz", async () => {
    const venues = await db.venue.findMany({ where: { tenantId: B.tenant.id, isActive: true } });
    // B'de iki mekan var (seed + eklenen); biri hariç hepsini kapat.
    for (const v of venues.slice(1)) await setVenueActive(B.owner, v.id, false);
    await assert.rejects(setVenueActive(B.owner, venues[0].id, false), ConflictError);
  });

  test("kapatılan mekan yeniden açılır ve kayıt düşer", async () => {
    const extra = await createVenue(A.owner, { name: "Geçici Nokta", type: "EVENT_SPACE" });
    await setVenueActive(A.owner, extra.id, false);
    assert.equal((await db.venue.findUniqueOrThrow({ where: { id: extra.id } })).isActive, false);

    const list = await listVenues(A.owner);
    const row = list.find((v) => v.id === extra.id);
    assert.equal(row?.isActive, false);
    assert.equal(list[0].isActive, true, "açık mekanlar üstte listelenir");

    await setVenueActive(A.owner, extra.id, true);
    assert.equal((await db.venue.findUniqueOrThrow({ where: { id: extra.id } })).isActive, true);
    assert.ok(await db.activityLog.findFirst({ where: { action: "venue.activated" } }));
  });

  test("yetkisiz rol kapatamaz", async () => {
    await assert.rejects(setVenueActive(A.crm, A.venue.id, false), ForbiddenError);
  });
});
