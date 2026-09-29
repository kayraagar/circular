import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import { anonymizeCustomer, deleteCustomerPermanently, exportCustomerData } from "@/modules/privacy/service";
import { createDataRequest, listDataRequests, resolveDataRequest, RESPONSE_DAYS } from "@/modules/privacy/requests";
import { makeTenant, resetDb } from "./helpers";

/**
 * KVKK ilgili kişi hakları: veriye erişim, anonimleştirme, kalıcı silme ve başvuru defteri.
 * Testler, "silindi" denen verinin gerçekten hiçbir yerde kalmadığını doğrular.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

async function makeCustomerWithHistory(ctx: T, suffix: string) {
  const customer = await createCustomer(ctx.owner, {
    firstName: "Deniz",
    lastName: `Kaya${suffix}`,
    phone: `0532 700 00 ${suffix.padStart(2, "0")}`,
    email: `deniz${suffix}@ornek.test`,
    birthDate: "1990-05-05",
    notes: "Pencere kenarı sever",
    consentChannels: ["EMAIL"],
    consentNote: "Formdan alındı",
  });
  // Kampanya mesajı: silmeyi engelleyen NoAction bağı bu satırdır.
  const campaign = await db.campaign.create({
    data: {
      tenantId: ctx.tenant.id,
      channel: "EMAIL",
      mode: "LIVE",
      name: "Hoş geldin",
      audienceKind: "SEGMENT",
      audienceLabel: "Tüm izinliler",
      recipientCount: 1,
      status: "COMPLETED",
    },
  });
  await db.campaignMessage.create({
    data: { tenantId: ctx.tenant.id, campaignId: campaign.id, customerId: customer.id, toEmail: `deniz${suffix}@ornek.test`, status: "DELIVERED" },
  });
  return customer;
}

before(async () => {
  await resetDb();
  A = await makeTenant("ka");
  B = await makeTenant("kb");
});

after(async () => {
  await db.$disconnect();
});

describe("Veriye erişim (dışa aktarma)", () => {
  test("yalnızca işletme sahibi dışa aktarır; başka işletmenin kaydı görünmez", async () => {
    const customer = await makeCustomerWithHistory(A, "1");
    await assert.rejects(exportCustomerData(A.crm, customer.id), ForbiddenError);
    await assert.rejects(exportCustomerData(B.owner, customer.id), NotFoundError);
  });

  test("dışa aktarım kişinin tüm verisini içerir", async () => {
    const customer = await makeCustomerWithHistory(A, "2");
    const data = await exportCustomerData(A.owner, customer.id);
    assert.equal(data.customer.ad, "Deniz");
    assert.equal(data.customer.dogumTarihi, "1990-05-05");
    assert.equal(data.customer.notlar, "Pencere kenarı sever");
    assert.equal(data.consents.length, 1, "izin kayıtları da verilir");
    assert.equal(data.messages.length, 1, "gönderilen mesajlar da verilir");
    assert.ok(data.activity.length > 0, "işlem geçmişi de verilir");
    assert.ok(data.exportedAt);
  });
});

describe("Anonimleştirme", () => {
  test("kimlik ve iletişim bilgileri hiçbir yerde kalmaz", async () => {
    const customer = await makeCustomerWithHistory(A, "3");
    await assert.rejects(anonymizeCustomer(A.crm, customer.id), ForbiddenError);

    await anonymizeCustomer(A.owner, customer.id);
    const row = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(row.firstName, "Silinmiş");
    assert.equal(row.phone, null);
    assert.equal(row.email, null);
    assert.equal(row.birthDate, null);
    assert.equal(row.notes, null);
    assert.equal(row.searchName, "");
    assert.ok(row.anonymizedAt, "anonimleştirme tarihi kaydedilir");

    assert.equal(await db.contactConsent.count({ where: { customerId: customer.id } }), 0, "izin kayıtları silinir");
    assert.equal(await db.customerTag.count({ where: { customerId: customer.id } }), 0, "etiketler silinir");
    assert.equal(await db.pass.count({ where: { customerId: customer.id } }), 0, "kişiye özel QR'lar silinir");

    const message = await db.campaignMessage.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(message.toEmail, null, "gönderilen mesajın adresi silinir");
    assert.equal(message.status, "DELIVERED", "gönderim sayısı istatistik olarak kalır");

    // En kritik kısım: aktivite geçmişindeki anlık görüntüler.
    const logs = await db.activityLog.findMany({ where: { customerId: customer.id } });
    assert.ok(logs.length > 0, "denetim izi korunur");
    const dump = JSON.stringify(logs);
    assert.ok(!dump.includes("Kaya3"), "aktivite metadata'sında soyadı kalmaz");
    assert.ok(!dump.includes("deniz3@ornek.test"), "aktivite metadata'sında e-posta kalmaz");
  });

  test("iki kez anonimleştirilemez", async () => {
    const customer = await makeCustomerWithHistory(A, "4");
    await anonymizeCustomer(A.owner, customer.id);
    await assert.rejects(anonymizeCustomer(A.owner, customer.id), ConflictError);
  });

  test("başka işletmenin kaydı anonimleştirilemez", async () => {
    const customer = await makeCustomerWithHistory(B, "5");
    await assert.rejects(anonymizeCustomer(A.owner, customer.id), NotFoundError);
    const row = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(row.firstName, "Deniz", "dokunulmamış");
  });
});

describe("Kalıcı silme", () => {
  test("kişiye ait tüm satırlar gider, kampanya sayısı kalır", async () => {
    const customer = await makeCustomerWithHistory(A, "6");
    await assert.rejects(deleteCustomerPermanently(A.crm, customer.id), ForbiddenError);

    await deleteCustomerPermanently(A.owner, customer.id);
    assert.equal(await db.customer.count({ where: { id: customer.id } }), 0);
    assert.equal(await db.contactConsent.count({ where: { customerId: customer.id } }), 0);

    // Mesaj satırı kalır ama kişiden koparılmıştır.
    const messages = await db.campaignMessage.findMany({ where: { toEmail: "deniz6@ornek.test" } });
    assert.equal(messages.length, 0, "alıcı adresi silinir");
    const orphan = await db.campaignMessage.findFirst({ where: { customerId: null, tenantId: A.tenant.id } });
    assert.ok(orphan, "gönderim sayısı kampanya raporunda kalır");

    const logs = await db.activityLog.findMany({ where: { tenantId: A.tenant.id } });
    assert.ok(!JSON.stringify(logs).includes("Kaya6"), "aktivite geçmişinde ad kalmaz");
  });
});

describe("İlgili kişi başvuru defteri", () => {
  test("yalnızca işletme sahibi kaydeder ve alanlar doğrulanır", async () => {
    await assert.rejects(createDataRequest(A.crm, { applicantName: "X", kind: "ACCESS", channel: "EMAIL" }), ForbiddenError);
    await assert.rejects(createDataRequest(A.owner, { applicantName: "A", kind: "ACCESS", channel: "EMAIL" }), ValidationError);
    await assert.rejects(createDataRequest(A.owner, { applicantName: "Ali Veli", kind: "OLMAYAN", channel: "EMAIL" }), ValidationError);
    await assert.rejects(
      createDataRequest(A.owner, { applicantName: "Ali Veli", kind: "ACCESS", channel: "EMAIL", receivedOn: "2030-01-01" }),
      ValidationError,
    );
  });

  test("cevap süresi 30 gün olarak hesaplanır ve kalan gün gösterilir", async () => {
    const now = new Date("2026-09-01T09:00:00Z");
    await createDataRequest(A.owner, { applicantName: "Ali Veli", kind: "ERASURE", channel: "KEP", note: "Kaydımı silin" }, now);

    const list = await listDataRequests(A.owner, new Date("2026-09-11T09:00:00Z"));
    const item = list.items.find((i) => i.applicantName === "Ali Veli");
    assert.ok(item);
    assert.equal(item.daysLeft, RESPONSE_DAYS - 10);
    assert.equal(item.overdue, false);
    assert.equal(item.kindLabel, "Silme / yok etme (m.7, m.11/e)");

    const late = await listDataRequests(A.owner, new Date("2026-10-15T09:00:00Z"));
    assert.equal(late.items.find((i) => i.applicantName === "Ali Veli")?.overdue, true);
    assert.ok(late.overdueCount >= 1);
  });

  test("başka işletmenin müşterisine bağlanamaz", async () => {
    const other = await makeCustomerWithHistory(B, "7");
    await assert.rejects(
      createDataRequest(A.owner, { applicantName: "Ali Veli", kind: "ACCESS", channel: "EMAIL", customerId: other.id }),
      ValidationError,
    );
  });

  test("başvuru sonuçlandırılır; sonuç metni zorunludur ve bir kez kapanır", async () => {
    const id = await createDataRequest(A.owner, { applicantName: "Zeynep Ak", kind: "ACCESS", channel: "EMAIL" });
    await assert.rejects(resolveDataRequest(A.owner, id, { status: "DONE", resolution: "" }), ValidationError);
    await assert.rejects(resolveDataRequest(A.crm, id, { status: "DONE", resolution: "Cevap verildi." }), ForbiddenError);

    await resolveDataRequest(A.owner, id, { status: "DONE", resolution: "Verisi JSON olarak gönderildi." });
    await assert.rejects(resolveDataRequest(A.owner, id, { status: "DONE", resolution: "Tekrar." }), ConflictError);

    const list = await listDataRequests(A.owner);
    const item = list.items.find((i) => i.id === id);
    assert.equal(item?.status, "DONE");
    assert.equal(item?.daysLeft, null, "kapanmış başvuruda süre sayacı durur");
    assert.ok(await db.activityLog.findFirst({ where: { action: "privacy.request_resolved" } }));
  });

  test("başka işletmenin başvurusu görünmez ve sonuçlandırılamaz", async () => {
    const id = await createDataRequest(B.owner, { applicantName: "Başka Kişi", kind: "ACCESS", channel: "EMAIL" });
    const list = await listDataRequests(A.owner);
    assert.ok(!list.items.some((i) => i.id === id));
    await assert.rejects(resolveDataRequest(A.owner, id, { status: "DONE", resolution: "Olmaz." }), NotFoundError);
  });
});
