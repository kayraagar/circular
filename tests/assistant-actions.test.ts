import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { toLocalInputValue } from "@/lib/datetime";
import { createCustomer } from "@/modules/customers/service";
import { toolByName, toolsFor } from "@/modules/assistant/tools";
import { makeTenant, resetDb } from "./helpers";

/**
 * Asistanın çalıştırdığı işlemler. Araçlar doğrudan (dil modeli olmadan) sınanır:
 * yetki, doğrulama, işletme izolasyonu ve gerçekten yazılan kayıt.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
const NOW = new Date("2026-10-15T18:00:00.000Z");
const ids: Record<string, string> = {};

const tool = (name: string) => {
  const t = toolByName(name);
  assert.ok(t, `${name} aracı tanımlı olmalı`);
  return t;
};

before(async () => {
  await resetDb();
  A = await makeTenant("ta");
  B = await makeTenant("tb");

  const ada = await createCustomer(A.owner, { firstName: "Ada", lastName: "Kaya", phone: "0532 500 00 01" });
  ids.ada = ada.id;
  // Aynı soyadla ikinci kişi: belirsiz aramada seçim istenmeli
  await createCustomer(A.owner, { firstName: "Adem", lastName: "Kaya", phone: "0532 500 00 02" });
  const other = await createCustomer(B.owner, { firstName: "Başka", lastName: "İşletme", phone: "0532 500 00 99" });
  ids.other = other.id;

  const event = await db.event.create({
    data: {
      tenantId: A.tenant.id,
      venueId: A.venue.id,
      name: "Cuma Gecesi",
      status: "PUBLISHED",
      startsAt: new Date(NOW.getTime() + 2 * 24 * 3600 * 1000),
      endsAt: new Date(NOW.getTime() + 2.3 * 24 * 3600 * 1000),
    },
  });
  ids.event = event.id;
});

after(async () => {
  await db.$disconnect();
});

describe("Asistan işlemleri", () => {
  test("yetki: her rol yalnızca kendi yapabildiği işlemleri görür", () => {
    const ownerTools = toolsFor(A.owner).map((t) => t.name);
    assert.ok(ownerTools.includes("musteri_ekle") && ownerTools.includes("kampanya_gonder"));
    assert.deepEqual(toolsFor(A.door).map((t) => t.name), [], "kapı görevlisine işlem aracı tanıtılmaz");
    assert.deepEqual(toolsFor(A.waiter).map((t) => t.name), []);
    // PR yalnızca misafir ekleyebilir
    assert.deepEqual(toolsFor(A.pr).map((t) => t.name), []);
  });

  test("müşteri ekleme: kayıt gerçekten oluşur, eksik iletişim reddedilir", async () => {
    const ok = await tool("musteri_ekle").run(A.owner, { ad: "Zeynep", soyad: "Demir", telefon: "0532 500 01 10", etiketler: ["vip"] }, NOW);
    assert.equal(ok.ok, true);
    const created = await db.customer.findFirst({ where: { tenantId: A.tenant.id, phone: "+905325000110" }, include: { tags: { include: { tag: true } } } });
    assert.ok(created, "müşteri veritabanına yazılır");
    assert.deepEqual(created.tags.map((t) => t.tag.name), ["vip"]);
    assert.ok(ok.ok && ok.links?.[0].href === `/customers/${created.id}`);

    const missing = await tool("musteri_ekle").run(A.owner, { ad: "Telefonsuz", soyad: "Kişi" }, NOW);
    assert.equal(missing.ok, false, "telefon ve e-posta yoksa kayıt açılmaz");
  });

  test("etiket ekleme: mevcut etiketler korunur, belirsiz isimde seçim istenir", async () => {
    const ambiguous = await tool("etiket_ekle").run(A.owner, { kisi: "Kaya", etiketler: ["bar"] }, NOW);
    assert.equal(ambiguous.ok, false);
    assert.ok(!ambiguous.ok && ambiguous.options && ambiguous.options.length === 2, "eşleşen kişiler listelenir, tahmin edilmez");

    await tool("etiket_ekle").run(A.owner, { kisi: "Ada Kaya", etiketler: ["masa-7"] }, NOW);
    const after1 = await db.customer.findUniqueOrThrow({ where: { id: ids.ada }, include: { tags: { include: { tag: true } } } });
    assert.deepEqual(after1.tags.map((t) => t.tag.name), ["masa-7"]);
    await tool("etiket_ekle").run(A.owner, { kisi: "Ada Kaya", etiketler: ["vip"] }, NOW);
    const after2 = await db.customer.findUniqueOrThrow({ where: { id: ids.ada }, include: { tags: { include: { tag: true } } } });
    assert.deepEqual(after2.tags.map((t) => t.tag.name).sort(), ["masa-7", "vip"], "önceki etiket silinmez");
  });

  test("izin kaydı: nasıl alındığı yazılmadan kaydedilmez", async () => {
    const withoutNote = await tool("izin_kaydet").run(A.owner, { kisi: "Ada Kaya", kanal: "SMS", verildi: true, nasil_alindi: "" }, NOW);
    assert.equal(withoutNote.ok, false);
    assert.equal(await db.contactConsent.count({ where: { customerId: ids.ada } }), 0);

    const ok = await tool("izin_kaydet").run(A.owner, { kisi: "Ada Kaya", kanal: "SMS", verildi: true, nasil_alindi: "kayıt formunda onayladı" }, NOW);
    assert.equal(ok.ok, true);
    const consent = await db.contactConsent.findFirstOrThrow({ where: { customerId: ids.ada, channel: "SMS" } });
    assert.equal(consent.status, "GRANTED");
    assert.equal(consent.note, "kayıt formunda onayladı");
    assert.equal(consent.recordedByUserId, A.owner.userId, "izni kimin kaydettiği yazılır");
  });

  test("misafir ekleme: yaklaşan etkinliğe yazılır, olmayan etkinlikte iş yapılmaz", async () => {
    const missing = await tool("guest_ekle").run(A.owner, { etkinlik: "Olmayan Gece", ad: "Mert", soyad: "Ak", telefon: "0532 500 02 20" }, NOW);
    assert.equal(missing.ok, false);

    const ok = await tool("guest_ekle").run(A.owner, { etkinlik: "Cuma", ad: "Mert", soyad: "Ak", telefon: "0532 500 02 20", kisi_sayisi: 3 }, NOW);
    assert.equal(ok.ok, true);
    const reg = await db.eventRegistration.findFirstOrThrow({ where: { eventId: ids.event }, include: { customer: true } });
    assert.equal(reg.partySize, 3);
    assert.equal(reg.customer.firstName, "Mert");
  });

  test("etkinlik oluşturma: geçersiz tarihte kayıt açılmaz", async () => {
    const bad = await tool("etkinlik_olustur").run(A.owner, { ad: "Bozuk Tarih", baslangic: "cuma akşamı", bitis: "sabaha kadar" }, NOW);
    assert.equal(bad.ok, false);

    const startsAt = toLocalInputValue(new Date(NOW.getTime() + 5 * 24 * 3600 * 1000));
    const endsAt = toLocalInputValue(new Date(NOW.getTime() + 5.2 * 24 * 3600 * 1000));
    const ok = await tool("etkinlik_olustur").run(A.owner, { ad: "Bahçe Akşamı", baslangic: startsAt, bitis: endsAt, kapasite: 120 }, NOW);
    assert.equal(ok.ok, true);
    const event = await db.event.findFirstOrThrow({ where: { tenantId: A.tenant.id, name: "Bahçe Akşamı" } });
    assert.equal(event.status, "DRAFT", "istenmedikçe yayına alınmaz");
    assert.equal(event.capacity, 120);
  });

  test("kampanya gönderimi onay ister ve kanal bağlı değilken mesaj gitmez", async () => {
    assert.equal(tool("kampanya_gonder").confirm, true, "gerçek kişilere gönderim onaysız çalışmaz");
    const result = await tool("kampanya_gonder").run(A.owner, { kanal: "SMS", kitle: "SMS_CONSENTED", metin: "Merhaba {{ad}}, bu hafta bekleriz." }, NOW);
    assert.equal(result.ok, false, "Netgsm bağlı değilken gönderim başlamaz");
    assert.equal(await db.campaignMessage.count(), 0);
  });

  test("işletme izolasyonu: başka işletmenin kaydı üzerinde işlem yapılamaz", async () => {
    const foreign = await tool("etiket_ekle").run(A.owner, { kisi: "Başka İşletme", etiketler: ["x"] }, NOW);
    assert.equal(foreign.ok, false, "diğer işletmenin müşterisi bulunamaz");
    const untouched = await db.customer.findUniqueOrThrow({ where: { id: ids.other }, include: { tags: true } });
    assert.equal(untouched.tags.length, 0);

    const foreignGuest = await tool("guest_ekle").run(B.owner, { etkinlik: "Cuma", ad: "X", soyad: "Y", telefon: "0532 500 03 30" }, NOW);
    assert.equal(foreignGuest.ok, false, "A işletmesinin etkinliği B'den görünmez");
  });
});
