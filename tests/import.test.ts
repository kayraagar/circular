import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import { detectSeparator, guessMapping, looksLikeHeader, parseCsv } from "@/modules/import/csv";
import { previewImport, runImport } from "@/modules/import/service";
import { makeTenant, resetDb } from "./helpers";

/**
 * CSV içe aktarma. İki kural değişmez: izin içe aktarılmaz (İYS/KVKK kanıt ister) ve
 * mevcut kayıt asla ezilmez.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

const CSV = [
  "Ad;Soyad;Telefon;E-posta;Doğum tarihi;Etiketler;Not",
  "Zeynep;Arslan;0532 300 00 01;zeynep@ornek.test;1992-03-14;VIP|Doğum günü;Pencere kenarı",
  "Emre;Koç;+90 532 300 00 02;;05.07.1988;;",
  "Nil;Yıldız;;nil@ornek.test;;Sadık;",
].join("\n");

before(async () => {
  await resetDb();
  A = await makeTenant("ia");
  B = await makeTenant("ib");
});

after(async () => {
  await db.$disconnect();
});

describe("CSV ayrıştırma", () => {
  test("ayraç tahmin edilir", () => {
    assert.equal(detectSeparator("a;b;c"), ";");
    assert.equal(detectSeparator("a,b,c"), ",");
    assert.equal(detectSeparator("a\tb\tc"), "\t");
  });

  test("tırnaklı alanlar ve içindeki ayraç doğru okunur", () => {
    const rows = parseCsv('Ad;Not\n"Ali";"Merhaba; nasılsın"\n"Ayşe";"Satır\nsonu"');
    assert.deepEqual(rows[1], ["Ali", "Merhaba; nasılsın"]);
    assert.deepEqual(rows[2], ["Ayşe", "Satır\nsonu"]);
  });

  test("BOM ve boş satırlar temizlenir", () => {
    const rows = parseCsv("﻿Ad;Soyad\n\nAli;Veli\n");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], ["Ad", "Soyad"]);
  });

  test("Türkçe başlıklar tanınır", () => {
    const header = ["Ad", "Soyad", "Telefon", "E-posta", "Doğum Tarihi", "Etiketler", "Notlar"];
    assert.equal(looksLikeHeader(header), true);
    const mapping = guessMapping(header);
    assert.equal(mapping.firstName, 0);
    assert.equal(mapping.lastName, 1);
    assert.equal(mapping.phone, 2);
    assert.equal(mapping.email, 3);
    assert.equal(mapping.birthDate, 4);
    assert.equal(mapping.tags, 5);
    assert.equal(mapping.notes, 6);
  });

  test("İngilizce başlıklar da tanınır", () => {
    const mapping = guessMapping(["First Name", "Last Name", "Phone", "Email"]);
    assert.equal(mapping.firstName, 0);
    assert.equal(mapping.phone, 2);
    assert.equal(mapping.tags, -1, "olmayan sütun -1");
  });
});

describe("Önizleme", () => {
  test("yetkisiz rol içe aktaramaz", async () => {
    await assert.rejects(previewImport(A.door, CSV), ForbiddenError);
    await assert.rejects(previewImport(A.pr, CSV), ForbiddenError);
  });

  test("geçerli satırlar ayrıştırılır, tarihler normalize edilir", async () => {
    const preview = await previewImport(A.owner, CSV);
    assert.equal(preview.total, 3);
    assert.equal(preview.invalid, 0);
    assert.equal(preview.ready, 3);

    const zeynep = preview.rows[0];
    assert.equal(zeynep.phone, "+905323000001");
    assert.equal(zeynep.birthDate, "1992-03-14");
    assert.deepEqual(zeynep.tags, ["VIP", "Doğum günü"]);

    assert.equal(preview.rows[1].birthDate, "1988-07-05", "gg.aa.yyyy biçimi çevrilir");
    assert.equal(preview.rows[2].phone, null, "telefonsuz ama e-postalı satır geçerli");
  });

  test("hatalı satırlar nedenleriyle işaretlenir", async () => {
    // Tamamen boş satır okunmaz; kalanların her biri ayrı bir hatayı temsil eder.
    const bad = ["Ad;Soyad;Telefon;E-posta", ";;;", ";;0532 300 00 04;", "Ali;Veli;12;", "Ayşe;Kaya;0532 300 00 05;bozuk@", "Can;Su;;"].join("\n");
    const preview = await previewImport(A.owner, bad);
    assert.equal(preview.ready, 0);
    assert.equal(preview.rows.length, 4, "boş satır atlanır");
    assert.ok(preview.rows[0].issues.includes("NO_NAME"));
    assert.ok(preview.rows[1].issues.includes("BAD_PHONE"));
    assert.ok(preview.rows[2].issues.includes("BAD_EMAIL"));
    assert.ok(preview.rows[3].issues.includes("NO_CONTACT"));
  });

  test("dosya içindeki tekrar işaretlenir", async () => {
    const dup = ["Ad;Telefon", "Ali;0532 300 00 09", "Ali;0532 300 00 09"].join("\n");
    const preview = await previewImport(A.owner, dup);
    assert.equal(preview.rows[0].issues.length, 0);
    assert.ok(preview.rows[1].issues.includes("DUPLICATE_IN_FILE"));
  });

  test("ad sütunu yoksa reddedilir", async () => {
    await assert.rejects(previewImport(A.owner, "Telefon;E-posta\n0532 300 00 10;a@b.test"), ValidationError);
  });
});

describe("Yazma", () => {
  test("kayıtlar izinsiz açılır", async () => {
    const result = await runImport(A.owner, CSV, { fillExisting: false, consentChannels: [], consentNote: "" });
    assert.equal(result.created, 3);

    const zeynep = await db.customer.findFirstOrThrow({ where: { tenantId: A.tenant.id, phone: "+905323000001" } });
    assert.equal(zeynep.source, "IMPORT");
    assert.equal(zeynep.notes, "Pencere kenarı");
    assert.equal(await db.contactConsent.count({ where: { customerId: zeynep.id } }), 0, "izin içe aktarılmaz");

    const tags = await db.customerTag.findMany({ where: { customerId: zeynep.id }, include: { tag: true } });
    assert.deepEqual(tags.map((t) => t.tag.name).sort(), ["Doğum günü", "VIP"]);
  });

  test("izin işaretlenirse açıklama zorunludur", async () => {
    await assert.rejects(
      runImport(A.owner, "Ad;Telefon\nTest;0532 300 00 30", { fillExisting: false, consentChannels: ["SMS"], consentNote: "" }),
      ValidationError,
    );
  });

  test("açıklamayla birlikte izin kaydedilir", async () => {
    await runImport(A.owner, "Ad;Soyad;Telefon\nDeniz;Ay;0532 300 00 31", {
      fillExisting: false,
      consentChannels: ["SMS"],
      consentNote: "2026 üyelik formları, ıslak imzalı",
    });
    const customer = await db.customer.findFirstOrThrow({ where: { phone: "+905323000031" } });
    const consent = await db.contactConsent.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(consent.status, "GRANTED");
    assert.equal(consent.note, "2026 üyelik formları, ıslak imzalı");
    assert.equal(consent.source, "STAFF_RECORDED");
  });

  test("mevcut kayıt ezilmez; istenirse yalnızca boş alan doldurulur", async () => {
    const existing = await createCustomer(A.owner, { firstName: "Mevcut", lastName: "Kişi", phone: "0532 300 00 40" });
    const csv = "Ad;Soyad;Telefon;E-posta;Not\nBaşka;İsim;0532 300 00 40;yeni@ornek.test;yeni not";

    const skipped = await runImport(A.owner, csv, { fillExisting: false, consentChannels: [], consentNote: "" });
    assert.equal(skipped.skipped, 1);
    assert.equal(skipped.created, 0);
    let row = await db.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(row.firstName, "Mevcut", "ad ezilmez");
    assert.equal(row.email, null);

    const filled = await runImport(A.owner, csv, { fillExisting: true, consentChannels: [], consentNote: "" });
    assert.equal(filled.updated, 1);
    row = await db.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(row.firstName, "Mevcut", "dolu alan yine ezilmez");
    assert.equal(row.email, "yeni@ornek.test", "boş alan doldurulur");
    assert.equal(row.notes, "yeni not");
  });

  test("içe aktarım işletmeye özeldir", async () => {
    assert.equal(await db.customer.count({ where: { tenantId: B.tenant.id } }), 0, "başka işletmeye kayıt geçmez");
  });
});
