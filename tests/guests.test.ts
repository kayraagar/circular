import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import type { ServiceContext } from "@/lib/authz";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import { cancelRegistration, createEvent } from "@/modules/events/service";
import { manualCheckIn, redeemEntryPass } from "@/modules/passes/service";
import {
  addGuestToEvent,
  getEventGuestList,
  getOrIssueGuestPass,
  getPromoterStats,
  listPromoterEvents,
  listPromoterOptions,
} from "@/modules/guests/service";
import { guestSource, guestStatus, summarizeGuests } from "@/modules/guests/status";
import { eventInput, localIn, makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
let pr2: ServiceContext;
let openEvent: { id: string };

const code = (c: string) => (e: unknown) => e instanceof ConflictError && e.code === c;
const guest = (n: number, extra: Record<string, unknown> = {}) => ({ firstName: `Misafir${n}`, lastName: "Deneme", phone: `0532 700 00 ${String(n).padStart(2, "0")}`, partySize: "1", ...extra });

before(async () => {
  await resetDb();
  A = await makeTenant("ga");
  B = await makeTenant("gb");
  const user = await db.user.create({ data: { email: "pr2@ga.test", name: "İkinci PR", passwordHash: "x" } });
  const m = await db.membership.create({ data: { userId: user.id, tenantId: A.tenant.id, role: "PR" } });
  pr2 = { tenantId: A.tenant.id, userId: user.id, membershipId: m.id, role: "PR", venueIds: null };
  openEvent = await createEvent(A.owner, eventInput(A.venue.id, { name: "Açık Gece", startsAt: localIn(-1), endsAt: localIn(5) }));
});

after(async () => {
  await db.$disconnect();
});

describe("durum ve kaynak kuralları", () => {
  test("durum ve kaynak kayıtlardan türetilir, oran kişi bazlıdır", () => {
    assert.equal(guestStatus({ accessStatus: "ACTIVE", checkedIn: false }), "PENDING");
    assert.equal(guestStatus({ accessStatus: "ACTIVE", checkedIn: true }), "CHECKED_IN");
    assert.equal(guestStatus({ accessStatus: "CANCELLED", checkedIn: false }), "CANCELLED");
    assert.equal(guestStatus({ accessStatus: "CANCELLED", checkedIn: true }), "CHECKED_IN", "giriş gerçekleştiyse içeride sayılır");
    assert.equal(guestSource("PR"), "PROMOTER");
    assert.equal(guestSource("PR_REFERRAL"), "PROMOTER");
    assert.equal(guestSource("WALK_IN"), "WALK_IN");
    assert.equal(guestSource("STAFF"), "ORGANIC");

    const s = summarizeGuests([
      { accessStatus: "ACTIVE", partySize: 4, admittedCount: 3 },
      { accessStatus: "ACTIVE", partySize: 2, admittedCount: null },
      { accessStatus: "CANCELLED", partySize: 5, admittedCount: null },
    ]);
    assert.deepEqual(
      { r: s.registrations, p: s.people, c: s.checkedIn, a: s.admitted, pe: s.pending, x: s.cancelled },
      { r: 2, p: 6, c: 1, a: 3, pe: 1, x: 1 },
    );
    assert.equal(s.checkInRate, 0.5);
  });
});

describe("misafir ekleme", () => {
  test("PR ekler: PR kaynağı ve ataması, iletişim izni oluşmaz", async () => {
    const result = await addGuestToEvent(A.pr, openEvent.id, guest(1, { partySize: "2" }));
    assert.equal(result.status, "PENDING");
    assert.equal(result.existingCustomer, null, "PR'a numaranın kayıtlı olup olmadığı söylenmez");

    const reg = await db.eventRegistration.findUniqueOrThrow({ where: { id: result.registrationId }, include: { customer: true } });
    assert.equal(reg.channel, "PR");
    assert.equal(reg.prMembershipId, A.pr.membershipId);
    assert.equal(reg.partySize, 2);
    assert.equal(reg.customer.source, "PR_GUEST");
    assert.equal(reg.customer.sourceMembershipId, A.pr.membershipId);
    assert.equal(reg.customer.phone, "+905327000001");
    assert.equal(await db.contactConsent.count({ where: { customerId: reg.customerId } }), 0);
  });

  test("aynı telefon aynı etkinliğe ikinci kez eklenemez (farklı yazımlar ve roller dahil)", async () => {
    await assert.rejects(addGuestToEvent(A.pr, openEvent.id, guest(1, { phone: "+90 532 700 00 01" })), code("DUPLICATE"));
    await assert.rejects(addGuestToEvent(pr2, openEvent.id, guest(1, { phone: "05327000001" })), code("DUPLICATE"));
    await assert.rejects(addGuestToEvent(A.owner, openEvent.id, guest(1, { phone: "0 (532) 700 00 01" })), code("DUPLICATE"));

    const other = await createEvent(A.owner, eventInput(A.venue.id, { name: "Başka Gece" }));
    assert.equal((await addGuestToEvent(A.pr, other.id, guest(1))).status, "PENDING", "başka etkinliğe eklenebilir");
  });

  test("telefon ve alanlar doğrulanır", async () => {
    await assert.rejects(addGuestToEvent(A.pr, openEvent.id, guest(2, { phone: "123" })), ValidationError);
    await assert.rejects(addGuestToEvent(A.pr, openEvent.id, guest(2, { phone: "" })), ValidationError);
    await assert.rejects(addGuestToEvent(A.pr, openEvent.id, guest(2, { partySize: "0" })), ValidationError);
    await assert.rejects(addGuestToEvent(A.pr, openEvent.id, guest(2, { firstName: "" })), ValidationError);
  });

  test("yönetim kaynağı ve PR ataması doğrulanır", async () => {
    await assert.rejects(addGuestToEvent(A.owner, openEvent.id, guest(3, { source: "PROMOTER" })), ValidationError, "PR seçilmeli");
    await assert.rejects(addGuestToEvent(A.owner, openEvent.id, guest(3, { source: "PROMOTER", promoterMembershipId: B.pr.membershipId })), ValidationError, "başka işletmenin PR'ı");
    await assert.rejects(addGuestToEvent(A.owner, openEvent.id, guest(3, { source: "PROMOTER", promoterMembershipId: A.crm.membershipId })), ValidationError, "PR olmayan üyelik");
    await assert.rejects(addGuestToEvent(A.owner, openEvent.id, guest(3, { source: "INSTAGRAM" })), ValidationError);

    const walkIn = await addGuestToEvent(A.crm, openEvent.id, guest(3, { source: "WALK_IN" }));
    const reg = await db.eventRegistration.findUniqueOrThrow({ where: { id: walkIn.registrationId }, include: { customer: true } });
    assert.equal(reg.channel, "WALK_IN");
    assert.equal(reg.customer.source, "WALK_IN");
    assert.equal(walkIn.existingCustomer, false);

    const assigned = await addGuestToEvent(A.owner, openEvent.id, guest(4, { source: "PROMOTER", promoterMembershipId: pr2.membershipId }));
    assert.equal((await db.eventRegistration.findUniqueOrThrow({ where: { id: assigned.registrationId } })).prMembershipId, pr2.membershipId);
  });

  test("CRM'de kayıtlı numara: müşteri değişmez, PR kayıtlı kişinin adını öğrenmez", async () => {
    const existing = await createCustomer(A.owner, { firstName: "Selin", lastName: "Kaya", phone: "0532 700 00 90" });
    const result = await addGuestToEvent(A.pr, openEvent.id, { firstName: "Başka", lastName: "İsim", phone: "0532 700 00 90", partySize: "1" });
    assert.equal(result.existingCustomer, null);

    const customer = await db.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(customer.firstName, "Selin", "kayıtlı müşterinin adı değişmez");

    const list = await getEventGuestList(A.pr, openEvent.id);
    const row = list.guests.find((g) => g.id === result.registrationId);
    assert.equal(row?.name, "Kayıtlı müşteri");
    assert.ok(!JSON.stringify(list).includes("Selin"));
    const search = await getEventGuestList(A.pr, openEvent.id, { q: "selin" });
    assert.equal(search.guests.length, 0, "ad araması kayıtlı kişinin adını sızdırmaz");
    const byPhone = await getEventGuestList(A.pr, openEvent.id, { q: "7000090" });
    assert.equal(byPhone.guests.length, 1, "telefonla bulunur");
  });

  test("iptal edilmiş kaydı PR yeniden ekleyemez; yönetim ekleyebilir", async () => {
    const r = await addGuestToEvent(A.pr, openEvent.id, guest(5));
    await cancelRegistration(A.owner, r.registrationId);
    await assert.rejects(addGuestToEvent(A.pr, openEvent.id, guest(5)), code("REGISTRATION_CANCELLED"));
    const again = await addGuestToEvent(A.owner, openEvent.id, guest(5, { source: "PROMOTER", promoterMembershipId: A.pr.membershipId }));
    assert.equal(again.registrationId, r.registrationId);
    const reg = await db.eventRegistration.findUniqueOrThrow({ where: { id: r.registrationId } });
    assert.equal(reg.accessStatus, "ACTIVE");
  });

  test("kapasite ve etkinlik durumu", async () => {
    const small = await createEvent(A.owner, eventInput(A.venue.id, { name: "Küçük", capacity: "3" }));
    await assert.rejects(addGuestToEvent(A.pr, small.id, guest(6, { partySize: "4" })), code("CAPACITY_EXCEEDED"));

    const draft = await createEvent(A.owner, eventInput(A.venue.id, { name: "Taslak", status: "DRAFT" }));
    await assert.rejects(addGuestToEvent(A.pr, draft.id, guest(6)), NotFoundError, "PR taslağı göremez");

    const ended = await createEvent(A.owner, eventInput(A.venue.id, { name: "Bitti" }));
    await db.event.update({ where: { id: ended.id }, data: { startsAt: new Date(Date.now() - 5 * 3600_000), endsAt: new Date(Date.now() - 3600_000) } });
    await assert.rejects(addGuestToEvent(A.pr, ended.id, guest(6)), code("EVENT_ENDED"));
  });

  test("aynı numarayla eşzamanlı iki ekleme tek kayıt oluşturur", async () => {
    const results = await Promise.allSettled([addGuestToEvent(A.pr, openEvent.id, guest(7)), addGuestToEvent(pr2, openEvent.id, guest(7))]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(code("DUPLICATE")(rejected.reason), String(rejected.reason));
    assert.equal(await db.customer.count({ where: { tenantId: A.tenant.id, phone: "+905327000007" } }), 1);
  });
});

describe("liste, istatistik ve kapsam", () => {
  test("PR yalnızca kendi misafirlerini görür; ad ve telefon maskeli", async () => {
    await addGuestToEvent(pr2, openEvent.id, guest(20));
    await addGuestToEvent(A.owner, openEvent.id, guest(21));

    const mine = await getEventGuestList(A.pr, openEvent.id);
    assert.equal(mine.scope, "own");
    const regs = await db.eventRegistration.findMany({ where: { eventId: openEvent.id, prMembershipId: A.pr.membershipId } });
    assert.equal(mine.guests.length, regs.length);
    const json = JSON.stringify(mine);
    assert.ok(!json.includes("Misafir20") && !json.includes("Misafir21"), "başkasının misafiri görünmez");
    assert.ok(!json.includes("5327000001") && !json.includes("532 700 00 01"), "tam telefon görünmez");
    assert.ok(mine.guests.every((g) => g.phone !== null), "maskeli telefon yine de gösterilir");
    const own = mine.guests.find((g) => g.name.startsWith("Misafir1"));
    assert.equal(own?.name, "Misafir1 D.");
    assert.equal(own?.promoterName, null);
    assert.equal(mine.event.capacity, null);

    const all = await getEventGuestList(A.owner, openEvent.id);
    assert.equal(all.scope, "all");
    assert.ok(all.guests.some((g) => g.name === "Misafir20 Deneme" && g.promoterName === "İkinci PR"));
    assert.ok(all.guests.some((g) => g.name === "Misafir21 Deneme" && g.source === "ORGANIC"));

    await assert.rejects(getEventGuestList(A.door, openEvent.id), ForbiddenError);
    await assert.rejects(getPromoterStats(A.waiter, openEvent.id), ForbiddenError);
    await assert.rejects(getEventGuestList(B.pr, openEvent.id), NotFoundError, "başka işletme");
    await assert.rejects(getEventGuestList(B.owner, openEvent.id), NotFoundError);
    const other = await db.venue.create({ data: { tenantId: A.tenant.id, name: "Diğer", slug: "ga-diger", type: "PUB" } });
    await assert.rejects(getEventGuestList({ ...A.pr, venueIds: [other.id] }, openEvent.id), NotFoundError, "mekan kapsamı");
  });

  test("gerçek girişler: kapıdaki giriş İçeride, iptal İptal; PR sayıları yalnızca kendisinin", async () => {
    const a = await addGuestToEvent(A.pr, openEvent.id, guest(30, { partySize: "3" }));
    const b = await addGuestToEvent(A.pr, openEvent.id, guest(31, { partySize: "2" }));
    await manualCheckIn(A.door, a.registrationId, { admittedCount: 2 });
    await cancelRegistration(A.owner, b.registrationId);

    const list = await getEventGuestList(A.pr, openEvent.id);
    assert.equal(list.guests.find((g) => g.id === a.registrationId)?.status, "CHECKED_IN");
    assert.equal(list.guests.find((g) => g.id === b.registrationId)?.status, "CANCELLED");

    const own = await getPromoterStats(A.pr, openEvent.id);
    const expected = (await db.eventRegistration.findMany({
      where: { eventId: openEvent.id, prMembershipId: A.pr.membershipId },
      include: { checkIns: true },
    })).map((r) => ({ accessStatus: r.accessStatus, partySize: r.partySize, admittedCount: r.checkIns[0]?.admittedCount ?? null }));
    const summary = summarizeGuests(expected);
    assert.equal(own.scope, "own");
    assert.equal(own.byPromoter, null);
    assert.equal(own.registrations, summary.registrations);
    assert.equal(own.admitted, 2);
    assert.ok(own.cancelled >= 1);

    const all = await getPromoterStats(A.owner, openEvent.id);
    assert.equal(all.scope, "all");
    assert.ok(all.registrations > own.registrations);
    const prRow = all.byPromoter?.find((p) => p.membershipId === A.pr.membershipId);
    assert.equal(prRow?.admitted, 2);
    assert.ok(all.byPromoter?.some((p) => p.membershipId === pr2.membershipId));
    assert.ok(all.byPromoter?.some((p) => p.membershipId === null), "PR'sız kayıtlar ayrı satırda");
  });

  test("PR portalı ve PR seçenekleri", async () => {
    const draft = await createEvent(A.owner, eventInput(A.venue.id, { name: "Gizli taslak", status: "DRAFT" }));
    const events = await listPromoterEvents(A.pr);
    assert.ok(events.some((e) => e.id === openEvent.id && e.stats.registrations > 0));
    assert.ok(!events.some((e) => e.id === draft.id));
    assert.equal((await listPromoterEvents(B.pr)).length, 0);

    const options = await listPromoterOptions(A.owner);
    assert.deepEqual(options.map((o) => o.membershipId).sort(), [A.pr.membershipId, pr2.membershipId].sort());
    assert.deepEqual(await listPromoterOptions(A.pr), []);
  });
});

describe("giriş QR'ı ve veritabanı koruması", () => {
  test("PR yalnızca kendi misafiri için QR alır; kod kapıda çalışır", async () => {
    const mine = await addGuestToEvent(A.pr, openEvent.id, guest(40));
    const theirs = await addGuestToEvent(pr2, openEvent.id, guest(41));

    const pass = await getOrIssueGuestPass(A.pr, mine.registrationId);
    assert.equal(pass.state, "VALID");
    assert.equal(pass.guestName, "Misafir40 D.");
    const again = await getOrIssueGuestPass(A.pr, mine.registrationId);
    assert.equal(again.passId, pass.passId, "idempotent");

    await assert.rejects(getOrIssueGuestPass(A.pr, theirs.registrationId), NotFoundError);
    assert.equal((await getOrIssueGuestPass(A.owner, theirs.registrationId)).state, "VALID", "yönetim herkes için alabilir");

    const token = pass.scanUrl.split("/").pop()!;
    await redeemEntryPass(A.door, token);
    const list = await getEventGuestList(A.pr, openEvent.id);
    assert.equal(list.guests.find((g) => g.id === mine.registrationId)?.status, "CHECKED_IN");
    const afterEntry = await getOrIssueGuestPass(A.pr, mine.registrationId, { reissue: true });
    assert.equal(afterEntry.passId, pass.passId, "giriş yapmış misafirin kodu yenilenmez");
  });

  test("başka işletmenin PR üyeliği kayda bağlanamaz (composite FK)", async () => {
    const customer = await createCustomer(A.owner, { firstName: "Ham", lastName: "Kayıt", phone: "0532 700 00 99" });
    await assert.rejects(
      db.eventRegistration.create({
        data: { tenantId: A.tenant.id, eventId: openEvent.id, customerId: customer.id, channel: "PR", prMembershipId: B.pr.membershipId },
      }),
    );
  });
});
