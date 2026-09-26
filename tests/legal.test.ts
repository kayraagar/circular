import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { LEGAL_SLUGS, legalDocument, legalDocuments, parseLegalSlug } from "@/modules/legal/documents";
import { getTenantLegal, legalGaps, readTenantLegal, saveTenantLegal } from "@/modules/legal/tenant-legal";
import { legalIdentityReady } from "@/config/legal";
import { makeTenant, resetDb } from "./helpers";

/**
 * Yasal metinler ve işletmenin veri sorumlusu bilgileri.
 * Metinlerden zorunlu bölümler silinirse test düşer; böylece KVKK m.10 unsurları korunur.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

const IDENTITY = {
  companyName: "Örnek Teknoloji A.Ş.",
  address: "Örnek Mah. Test Cad. No:1 İstanbul",
  mersis: "0123456789012345",
  email: "kvkk@ornek.test",
  kep: null,
  phone: null,
  verbis: null,
  jurisdiction: "İstanbul",
};

before(async () => {
  await resetDb();
  A = await makeTenant("ya");
  B = await makeTenant("yb");
});

after(async () => {
  await db.$disconnect();
});

describe("Yasal metinler", () => {
  test("her metin sürümlü, özetli ve bölümlüdür", () => {
    assert.equal(parseLegalSlug("gizlilik"), "gizlilik");
    assert.equal(parseLegalSlug("olmayan"), null);
    for (const doc of legalDocuments(IDENTITY)) {
      assert.ok(doc.title.length > 3, `${doc.slug} başlıksız`);
      assert.ok(doc.summary.length > 20, `${doc.slug} özetsiz`);
      assert.match(doc.version, /^\d+\.\d+$/);
      assert.match(doc.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(doc.sections.length >= 4, `${doc.slug} yeterli bölüm içermiyor`);
      for (const section of doc.sections) {
        assert.ok(section.paragraphs?.length || section.list?.length || section.table, `${doc.slug} → "${section.heading}" boş`);
      }
    }
    assert.deepEqual(legalDocuments(IDENTITY).map((d) => d.slug), [...LEGAL_SLUGS]);
  });

  test("aydınlatma metni KVKK m.10 unsurlarının hepsini içerir", () => {
    const doc = legalDocument("aydinlatma", IDENTITY);
    const text = JSON.stringify(doc);
    // m.10: sorumlunun kimliği, amaç, aktarım, toplama yöntemi ve hukuki sebep, m.11 hakları
    for (const required of ["Veri sorumlusu", "İşleme amaçları", "Hukuki sebepler", "Toplama yöntemi", "Aktarım", "Haklarınız"]) {
      assert.ok(doc.sections.some((s) => s.heading.includes(required)), `eksik bölüm: ${required}`);
    }
    assert.ok(text.includes("m.5/2-c") && text.includes("m.5/2-ç") && text.includes("m.5/2-f"), "hukuki sebepler madde numarasıyla yazılmalı");
    assert.ok(text.includes("otuz gün"), "başvuru cevap süresi yazılmalı");
    assert.ok(text.includes("beş iş günü"), "standart sözleşme bildirim süresi yazılmalı");
    const rights = doc.sections.find((s) => s.heading.includes("Haklarınız"));
    assert.equal(rights?.list?.length, 9, "KVKK m.11'deki dokuz hak sayılmalı");
  });

  test("kimlik bilgisi yoksa metinde yer tutucu görünür ve yayına hazır sayılmaz", () => {
    const empty = { ...IDENTITY, companyName: null, address: null, email: null, kep: null };
    assert.equal(legalIdentityReady(empty), false);
    assert.equal(legalIdentityReady(IDENTITY), true);
    const doc = legalDocument("aydinlatma", empty);
    assert.ok(JSON.stringify(doc).includes("[Ticaret unvanı girilmedi]"), "eksik unvan uydurulmaz, yer tutucu yazılır");
  });

  test("çerez metni yalnızca gerçekten kullanılan çerezleri sayar", () => {
    const doc = legalDocument("cerez", IDENTITY);
    const rows = doc.sections.find((s) => s.table)?.table?.rows ?? [];
    assert.deepEqual(rows.map((r) => r[0]), ["circular_session", "circular_flash"]);
    assert.ok(JSON.stringify(doc).includes("Google Analytics"), "izleyici kullanılmadığı açıkça yazılmalı");
  });

  test("veri işleme metni alt işleyenleri ülkesiyle listeler", () => {
    const doc = legalDocument("veri-isleme", IDENTITY);
    const table = doc.sections.find((s) => s.heading.includes("Alt işleyenler"))?.table;
    assert.ok(table && table.rows.length >= 5);
    assert.deepEqual(table.headers, ["Alt işleyen", "Amaç", "Ülke", "Aktarılan veri", "Durum"]);
    assert.ok(table.rows.some((r) => r[0].includes("Groq") && r[3].includes("gönderilmez")), "modele kişisel veri gitmediği yazılmalı");
  });
});

describe("İşletmenin veri sorumlusu bilgileri", () => {
  test("eksik alanlar kayıt formunda uyarıya dönüşür", async () => {
    const empty = await readTenantLegal(A.tenant.id);
    assert.equal(empty.ready, false);
    assert.deepEqual(empty.missing, ["Ticaret unvanı", "Başvuru e-postası", "Aydınlatma metni adresi"]);
    assert.deepEqual(legalGaps({ ...empty, legalName: "X", legalEmail: "a@b.test", privacyUrl: "https://x.test" }), []);
  });

  test("yalnızca işletme sahibi kaydeder; adres doğrulanır", async () => {
    await assert.rejects(saveTenantLegal(A.crm, { legalName: "X" }), ForbiddenError);
    await assert.rejects(saveTenantLegal(A.pr, { legalName: "X" }), ForbiddenError);
    await assert.rejects(
      saveTenantLegal(A.owner, { legalName: "X", legalEmail: "", privacyUrl: "ornek.com/metin", legalAddress: "", mersis: "", verbisId: "", legalPhone: "" }),
      ValidationError,
    );
    await assert.rejects(
      saveTenantLegal(A.owner, { legalName: "X", legalEmail: "gecersiz", privacyUrl: "", legalAddress: "", mersis: "", verbisId: "", legalPhone: "" }),
      ValidationError,
    );
  });

  test("kaydedilen bilgiler herkese açık sayfada okunur ve işletmeye özeldir", async () => {
    const saved = await saveTenantLegal(A.owner, {
      legalName: "Örnek Gıda A.Ş.",
      legalAddress: "Test Cad. No:5",
      mersis: "0123456789012345",
      verbisId: "",
      legalEmail: "KVKK@Ornek.Test",
      legalPhone: "0212 000 00 00",
      privacyUrl: "https://ornek.test/aydinlatma",
    });
    assert.equal(saved.ready, true);
    assert.equal(saved.legalEmail, "kvkk@ornek.test", "e-posta küçük harfe normalize edilir");
    assert.equal(saved.verbisId, null, "boş alan null olur");

    const publicView = await readTenantLegal(A.tenant.id);
    assert.equal(publicView.legalName, "Örnek Gıda A.Ş.");
    const other = await readTenantLegal(B.tenant.id);
    assert.equal(other.legalName, null, "başka işletmenin bilgisi görünmez");

    const log = await db.activityLog.findFirst({ where: { action: "tenant.legal_updated" }, orderBy: { createdAt: "desc" } });
    assert.ok(log, "değişiklik aktivite geçmişine yazılır");

    const owner = await getTenantLegal(A.owner);
    assert.equal(owner.ready, true);
  });
});
