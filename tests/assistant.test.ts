import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { createCustomer, setConsent } from "@/modules/customers/service";
import { ask } from "@/modules/assistant/service";
import { readPerson, readQuestion } from "@/modules/assistant/rules";
import { modelReady, usesOnlyGivenNumbers } from "@/modules/assistant/model-api";
import { makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

const DAY = 24 * 3600 * 1000;
/** Sabit "şimdi": 15 Ekim 2026, Istanbul saatiyle 21:00. */
const NOW = new Date("2026-10-15T18:00:00.000Z");
const daysAgo = (n: number, iso = "T18:00:00.000Z") => new Date(`${new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10)}${iso}`);

const ids: Record<string, string> = {};

/** Cevabın içindeki tüm metin — sayıların gerçekten yazıldığını doğrulamak için. */
function textOf(answer: Awaited<ReturnType<typeof ask>>): string {
  return JSON.stringify(answer);
}

before(async () => {
  await resetDb();
  A = await makeTenant("aa");
  B = await makeTenant("ab");

  for (const [index, [key, name]] of ([["ali", "Ali"], ["berk", "Berk"]] as const).entries()) {
    const created = await createCustomer(A.owner, { firstName: name, lastName: "Asistan", phone: `0532 400 00 1${index}` });
    await db.customer.update({ where: { id: created.id }, data: { createdAt: daysAgo(3) } });
    ids[key] = created.id;
  }
  await setConsent(A.owner, { customerId: ids.ali, channel: "WHATSAPP", grant: true, note: "Kayıt sırasında sözlü izin" });

  const event = await db.event.create({
    data: { tenantId: A.tenant.id, venueId: A.venue.id, name: "Cuma Gecesi", status: "PUBLISHED", capacity: 80, startsAt: daysAgo(4), endsAt: daysAgo(4, "T22:00:00.000Z") },
  });
  const reg = await db.eventRegistration.create({
    data: { tenantId: A.tenant.id, eventId: event.id, customerId: ids.ali, channel: "STAFF", partySize: 3, createdAt: daysAgo(5) },
  });
  await db.checkIn.create({
    data: { tenantId: A.tenant.id, eventId: event.id, registrationId: reg.id, customerId: ids.ali, method: "QR", admittedCount: 3, checkedInAt: daysAgo(4, "T20:00:00.000Z") },
  });
  // Gelmeyen davetli: geliş oranı %100 olmasın
  await db.eventRegistration.create({
    data: { tenantId: A.tenant.id, eventId: event.id, customerId: ids.berk, channel: "PR", partySize: 2, prMembershipId: A.pr.membershipId, createdAt: daysAgo(5) },
  });
});

after(async () => {
  await db.$disconnect();
});

describe("Asistan", () => {
  test("soru anlama: konu, dönem, kitle ve kanal", () => {
    assert.equal(readQuestion("Son 7 günde kaç kişi geldi?").topic, "VISITS");
    assert.equal(readQuestion("Son 7 günde kaç kişi geldi?").periodDays, 7);
    assert.equal(readQuestion("Bu ay en yoğun saat hangisi?").topic, "PEAK_TIME");
    assert.equal(readQuestion("Bu ay en yoğun saat hangisi?").periodDays, 30);
    assert.equal(readQuestion("Son 90 günde etkinlikler nasıl gitti?").periodDays, 90);
    assert.equal(readQuestion("Kimlere mesaj atmalıyım?").topic, "AUDIENCE");
    assert.equal(readQuestion("Kampanya nasıl gönderilir?").topic, "HOWTO");
    assert.equal(readQuestion("Kampanya nasıl gönderilir?").guide, "CAMPAIGN_SEND");
    assert.equal(readQuestion("Kampanyalar nasıl gitti?").topic, "CAMPAIGN_RESULTS");

    const draft = readQuestion("60 gündür gelmeyenlere SMS taslağı hazırla");
    assert.equal(draft.topic, "DRAFT");
    assert.equal(draft.segment, "LAPSED_60");
    assert.equal(draft.channel, "SMS");

    // Anlaşılmayan soru zorlama bir konuya bağlanmaz
    assert.equal(readQuestion("bugün hava nasıl olacak").topic, "UNKNOWN");
    assert.equal(readQuestion("").topic, "UNKNOWN");
  });

  test("yetki: kapı, PR ve garson asistanı kullanamaz", async () => {
    await assert.rejects(ask(A.door, { question: "kaç kişi geldi" }, NOW), ForbiddenError);
    await assert.rejects(ask(A.pr, { question: "kaç kişi geldi" }, NOW), ForbiddenError);
    await assert.rejects(ask(A.waiter, { question: "kaç kişi geldi" }, NOW), ForbiddenError);
    assert.ok(await ask(A.crm, { question: "kaç kişi geldi" }, NOW));
  });

  test("veri cevapları gerçek kayıtlardan gelir", async () => {
    const visits = await ask(A.owner, { question: "Son 7 günde kaç kişi geldi?" }, NOW);
    assert.equal(visits.topic, "VISITS");
    assert.match(visits.lead, /3 kişi girdi/);
    assert.equal(visits.scope, "Son 7 gün · Tüm mekanlar");
    const stats = visits.blocks.find((b) => b.kind === "stats");
    assert.ok(stats && stats.items.some((i) => i.label === "Toplam giriş" && i.value === "3"));

    const summary = await ask(A.owner, { question: "Son 7 günde işler nasıl gidiyor?" }, NOW);
    assert.equal(summary.topic, "SUMMARY");
    // 5 kişilik davetin 3'ü geldi
    assert.ok(textOf(summary).includes("%60"), "geliş oranı gerçek kayıttan hesaplanır");

    const events = await ask(A.owner, { question: "Etkinlikler nasıl gitti?" }, NOW);
    const rows = events.blocks.find((b) => b.kind === "rows");
    assert.deepEqual(
      rows?.rows.map((r) => [r.label, r.value]),
      [["Cuma Gecesi", "3 / 5 kişi"]],
    );
  });

  test("veri yoksa sayı uydurulmaz", async () => {
    const answer = await ask(A.owner, { question: "Son 7 günde hangi avantajlar kullanıldı?" }, NOW);
    assert.equal(answer.topic, "PERKS");
    assert.match(answer.lead, /kayıt yok/);
    assert.ok(!answer.blocks.some((b) => b.kind === "stats"), "boş cevapta rakam kutusu gösterilmez");
  });

  test("anlaşılmayan soruda uydurma cevap verilmez", async () => {
    const answer = await ask(A.owner, { question: "borsa ne olacak" }, NOW);
    assert.equal(answer.topic, "UNKNOWN");
    assert.match(answer.lead, /dil modeli bağlı/);
    assert.ok(answer.followUps.length >= 5, "yerine sorulabilecek örnekler önerilir");
    assert.ok(!answer.blocks.some((b) => b.kind === "stats" || b.kind === "rows"), "uydurma sayı gösterilmez");
  });

  test("panel rehberi adım adım yanıtlar", async () => {
    const answer = await ask(A.owner, { question: "QR menü nasıl hazırlanır?" }, NOW);
    assert.equal(answer.topic, "HOWTO");
    const steps = answer.blocks.find((b) => b.kind === "steps");
    assert.ok(steps && steps.steps.length >= 3);
    const links = answer.blocks.find((b) => b.kind === "links");
    assert.ok(links?.links.some((l) => l.href === "/menu"));
  });

  test("kitle önerisi ve taslak metin: gönderim yapılmaz", async () => {
    const audience = await ask(A.owner, { question: "Kimlere mesaj atmalıyım?" }, NOW);
    assert.equal(audience.topic, "AUDIENCE");
    const rows = audience.blocks.find((b) => b.kind === "rows");
    assert.ok(rows && rows.rows.length > 0, "önerilen kitleler gerçek sayılarla listelenir");

    const draft = await ask(A.owner, { question: "Doğum günü olanlara WhatsApp mesajı taslağı hazırla" }, NOW);
    const block = draft.blocks.find((b) => b.kind === "draft");
    assert.ok(block, "taslak metin üretilir");
    assert.equal(block.channel, "WHATSAPP");
    assert.ok(block.body.includes("{{ad}}"), "kişi adı değişkeni korunur");
    assert.ok(textOf(draft).includes("şablondur"), "metnin şablon olduğu açıkça yazılır");

    // Asistan hiçbir kampanya kaydı oluşturmaz
    assert.equal(await db.campaign.count(), 0);
    assert.equal(await db.campaignMessage.count(), 0);
  });

  test("dil modeli: anahtar yokken ağa çıkılmaz, sayı uydurması reddedilir", () => {
    assert.equal(modelReady(), false, "testlerde model kapalıdır; cevaplar anahtar kelime modundan gelir");
    // Modelin cümlesi yalnızca panelin verdiği sayıları içerebilir
    const facts = "Kapıdan giren kişi: 19 (önceki dönem 0)\nYeni müşteri: 39";
    assert.equal(usesOnlyGivenNumbers("Son dönemde 19 kişi girdi, 39 yeni müşteri eklendi.", facts), true);
    assert.equal(usesOnlyGivenNumbers("Geçen aya göre iki katı: 78 kişi.", facts), false, "verilmeyen sayı reddedilir");
    assert.equal(usesOnlyGivenNumbers("1.234 kişi geldi.", "Toplam: 1234"), true, "binlik ayracı fark yaratmaz");
  });

  test("kişi soruları: ad çıkarımı ve gerçek ziyaret kaydı", async () => {
    assert.equal(readPerson("Ali en son ne zaman geldi?"), "Ali");
    assert.equal(readPerson("0532 400 00 10 kayıtlı mı?"), "05324000010");
    assert.equal(readPerson("kaç kişi geldi"), null);

    const answer = await ask(A.owner, { question: "Ali en son ne zaman geldi?" }, NOW);
    assert.equal(answer.topic, "CUSTOMER");
    assert.match(answer.lead, /Ali Asistan/);
    assert.match(answer.lead, /1 ziyaret/);
    const rows = answer.blocks.find((b) => b.kind === "rows");
    assert.equal(rows?.rows.length, 1);
    assert.ok(rows?.rows[0].href?.startsWith("/customers/"), "kişi kartına bağlantı verilir");

    const missing = await ask(A.owner, { question: "Zeynep en son ne zaman geldi?" }, NOW);
    assert.match(missing.lead, /kayıt bulunamadı/, "olmayan kişi için kayıt uydurulmaz");

    // Başka işletmenin müşterisi bu aramada görünmez
    const other = await ask(B.owner, { question: "Ali en son ne zaman geldi?" }, NOW);
    assert.match(other.lead, /kayıt bulunamadı/);
  });

  test("işletme izolasyonu: başka işletmenin verisi görünmez", async () => {
    const answer = await ask(B.owner, { question: "Son 7 günde kaç kişi geldi?" }, NOW);
    assert.match(answer.lead, /kayıt yok/, "B işletmesinde giriş yok");
    const mine = await ask(A.owner, { question: "Son 7 günde kaç kişi geldi?" }, NOW);
    assert.match(mine.lead, /3 kişi girdi/);
  });
});
