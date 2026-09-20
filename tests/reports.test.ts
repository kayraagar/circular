import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import { getReports, parseReportPeriod } from "@/modules/reports/service";
import { makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

const DAY = 24 * 3600 * 1000;
/** Sabit "şimdi": 15 Ekim 2026 Perşembe, Istanbul saatiyle 21:00 (18:00 UTC). */
const NOW = new Date("2026-10-15T18:00:00.000Z");
const daysAgo = (n: number, iso = "T18:00:00.000Z") => new Date(new Date(`${new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10)}${iso}`));

const ids: Record<string, string> = {};
let otherVenueId = "";

async function visit(key: string, eventId: string, at: Date, admittedCount = 1, venueTenant = A.tenant.id) {
  const reg = await db.eventRegistration.create({
    data: { tenantId: venueTenant, eventId, customerId: ids[key], channel: "STAFF", partySize: admittedCount, createdAt: at },
  });
  await db.checkIn.create({ data: { tenantId: venueTenant, eventId, registrationId: reg.id, customerId: ids[key], method: "QR", admittedCount, checkedInAt: at } });
  return reg;
}

before(async () => {
  await resetDb();
  A = await makeTenant("ra");
  B = await makeTenant("rb");
  otherVenueId = (await db.venue.create({ data: { tenantId: A.tenant.id, name: "İkinci Mekan", slug: "ikinci-mekan-ra", type: "CLUB" } })).id;

  const people = [
    ["ali", "Ali", daysAgo(3)],
    ["berk", "Berk", daysAgo(10)],
    ["cem", "Cem", daysAgo(40)],
  ] as const;
  for (const [index, [key, name, at]] of people.entries()) {
    const created = await createCustomer(A.owner, { firstName: name, lastName: "Rapor", phone: `0532 300 00 1${index}` });
    await db.customer.update({ where: { id: created.id }, data: { createdAt: at, source: key === "cem" ? "QR_MENU" : "MANUAL" } });
    ids[key] = created.id;
  }

  // Biten iki etkinlik: biri ana mekanda, biri ikinci mekanda
  const main = await db.event.create({
    data: { tenantId: A.tenant.id, venueId: A.venue.id, name: "Cuma Gecesi", status: "PUBLISHED", capacity: 100, startsAt: daysAgo(5), endsAt: daysAgo(5, "T22:00:00.000Z") },
  });
  const other = await db.event.create({
    data: { tenantId: A.tenant.id, venueId: otherVenueId, name: "Bahçe Akşamı", status: "PUBLISHED", startsAt: daysAgo(6), endsAt: daysAgo(6, "T22:00:00.000Z") },
  });
  ids.mainEvent = main.id;
  ids.otherEvent = other.id;

  // Girişler: Ali 2 kişiyle (Istanbul 00:30 → bir sonraki gün), Berk 1 kişi, Cem ikinci mekanda
  await visit("ali", main.id, daysAgo(5, "T21:30:00.000Z"), 2);
  await visit("berk", main.id, daysAgo(5, "T20:00:00.000Z"), 1);
  await visit("cem", other.id, daysAgo(6, "T20:00:00.000Z"), 3);
  // Gelmeyen davetli (kayıt var, giriş yok)
  await db.eventRegistration.create({ data: { tenantId: A.tenant.id, eventId: main.id, customerId: ids.cem, channel: "PR", partySize: 4, prMembershipId: A.pr.membershipId, createdAt: daysAgo(6) } });
  // Önceki döneme düşen etkinlik ve giriş (7 günlük raporda "önceki dönem")
  const older = await db.event.create({
    data: { tenantId: A.tenant.id, venueId: A.venue.id, name: "Eski Gece", status: "PUBLISHED", startsAt: daysAgo(9), endsAt: daysAgo(9, "T22:00:00.000Z") },
  });
  await visit("berk", older.id, daysAgo(9, "T20:00:00.000Z"), 5);

  const perk = await db.perk.create({ data: { tenantId: A.tenant.id, name: "Hoş geldin içeceği" } });
  const pass = await db.pass.create({ data: { tenantId: A.tenant.id, purpose: "PERK_REDEMPTION", tokenHash: "rapor-test", customerId: ids.ali, perkId: perk.id } });
  await db.perkRedemption.create({ data: { tenantId: A.tenant.id, perkId: perk.id, passId: pass.id, customerId: ids.ali, redeemedAt: daysAgo(2) } });

  // Başka işletmenin verisi rapora karışmamalı
  const bCustomer = await createCustomer(B.owner, { firstName: "Başka", lastName: "İşletme", phone: "0532 300 99 99" });
  const bEvent = await db.event.create({
    data: { tenantId: B.tenant.id, venueId: B.venue.id, name: "B Gecesi", status: "PUBLISHED", startsAt: daysAgo(4), endsAt: daysAgo(4, "T22:00:00.000Z") },
  });
  const bReg = await db.eventRegistration.create({ data: { tenantId: B.tenant.id, eventId: bEvent.id, customerId: bCustomer.id, channel: "STAFF", partySize: 9, createdAt: daysAgo(4) } });
  await db.checkIn.create({ data: { tenantId: B.tenant.id, eventId: bEvent.id, registrationId: bReg.id, customerId: bCustomer.id, method: "QR", admittedCount: 9, checkedInAt: daysAgo(4) } });
});

after(async () => {
  await db.$disconnect();
});

describe("Raporlar", () => {
  test("yetki: yalnızca sahip ve CRM yöneticisi görür", async () => {
    await assert.rejects(getReports(A.door, { periodDays: 7 }, NOW), ForbiddenError);
    await assert.rejects(getReports(A.pr, { periodDays: 7 }, NOW), ForbiddenError);
    await assert.rejects(getReports(A.waiter, { periodDays: 7 }, NOW), ForbiddenError);
    assert.ok(await getReports(A.crm, { periodDays: 7 }, NOW));
    assert.deepEqual([parseReportPeriod("90"), parseReportPeriod("5"), parseReportPeriod(undefined)], [90, 30, 30]);
  });

  test("toplamlar gerçek girişlerden gelir; önceki dönemle karşılaştırılır", async () => {
    const r = await getReports(A.owner, { periodDays: 7 }, NOW);
    assert.deepEqual(r.totals.admitted, { current: 6, previous: 5 }, "6 kişi girdi; önceki 7 günde 5");
    assert.deepEqual(r.totals.newCustomers, { current: 1, previous: 1 }, "Ali bu dönemde, Berk önceki dönemde eklendi");
    assert.equal(r.totals.uniqueVisitors, 3);
    assert.equal(r.totals.redemptions.current, 1);
    assert.equal(r.totals.invitedPeople, 10, "2 + 1 + 3 + 4 kişilik davet");
    assert.equal(r.totals.registrationsAdmitted, 6);
    assert.equal(Math.round(r.totals.showRate * 100), 60);
  });

  test("günlük seri, saat ve gün dağılımı Istanbul saatine göre", async () => {
    const r = await getReports(A.owner, { periodDays: 7 }, NOW);
    assert.equal(r.series.visits.length, 7);
    assert.equal(r.series.visits.reduce((n, p) => n + p.value, 0), 6);
    // 21:30 UTC → Istanbul 00:30 (ertesi gün), 20:00 UTC → 23:00
    assert.equal(r.hourly[0].value, 2, "gece yarısından sonraki giriş 00 saatinde");
    assert.equal(r.hourly[23].value, 4, "23:00'te iki etkinlikten toplam 4 kişi");
    assert.equal(
      r.weekly.reduce((n, b) => n + b.value, 0),
      6,
    );
    const day = r.series.visits.find((p) => p.value === 2);
    assert.ok(day && day.day > "2026-10-09", "giriş doğru güne düştü");
  });

  test("etkinlikler, kaynaklar, guest kanalı ve PR katkısı", async () => {
    const r = await getReports(A.owner, { periodDays: 7 }, NOW);
    assert.deepEqual(
      r.events.map((e) => [e.name, e.people, e.admitted]),
      [
        ["Cuma Gecesi", 7, 3],
        ["Bahçe Akşamı", 3, 3],
      ],
      "Cuma Gecesi: 2+1+4 davetli kişi, 3 giriş; önceki dönemin etkinliği listede yok",
    );
    assert.equal(r.events[0].capacity, 100);
    assert.deepEqual(r.sources, [{ label: "Panelden eklendi", value: 1 }]);
    assert.deepEqual(
      r.guestMix.map((g) => [g.label, g.value]),
      [
        ["PR", 4],
        ["Diğer", 6],
      ],
    );
    assert.deepEqual(r.promoters, [{ name: "PR ra", people: 4, admitted: 0 }]);
    assert.deepEqual(r.perks, [{ label: "Hoş geldin içeceği", value: 1 }]);
  });

  test("mekan filtresi ve işletme izolasyonu", async () => {
    const onlyOther = await getReports(A.owner, { periodDays: 7, venueId: otherVenueId }, NOW);
    assert.equal(onlyOther.totals.admitted.current, 3, "yalnızca ikinci mekanın girişleri");
    assert.deepEqual(onlyOther.events.map((e) => e.name), ["Bahçe Akşamı"]);

    // Mekan kısıtlı CRM yöneticisi yalnızca kendi mekanını görür
    const restricted = { ...A.crm, venueIds: [otherVenueId] };
    const scoped = await getReports(restricted, { periodDays: 7 }, NOW);
    assert.equal(scoped.totals.admitted.current, 3);
    // Erişemediği mekan istense bile kapsam dışına çıkamaz
    const forced = await getReports(restricted, { periodDays: 7, venueId: A.venue.id }, NOW);
    assert.equal(forced.totals.admitted.current, 3);

    const b = await getReports(B.owner, { periodDays: 7 }, NOW);
    assert.equal(b.totals.admitted.current, 9, "B işletmesi yalnızca kendi verisini görür");
    assert.equal(b.promoters.length, 0);
  });

  test("uzun dönemde eski kayıtlar da sayılır; kampanya yoksa liste boş", async () => {
    const r90 = await getReports(A.owner, { periodDays: 90 }, NOW);
    assert.equal(r90.series.visits.length, 90);
    assert.equal(r90.totals.admitted.current, 11, "önceki dönemdeki giriş de 90 günlük aralığa girer");
    assert.equal(r90.totals.newCustomers.current, 3);
    assert.deepEqual(r90.campaigns, []);
    assert.deepEqual(r90.consents, { WHATSAPP: 0, SMS: 0, EMAIL: 0 });
  });
});
