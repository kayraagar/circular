import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import { cancelRegistration, changeEventStatus, createEvent } from "@/modules/events/service";
import { getEventGuestList, getPromoterStats } from "@/modules/guests/service";
import { createInviteLink, getMyInviteLink, registerViaInvite, resetInviteRateLimit, resolveInvite } from "@/modules/guests/invite";
import { findPassByToken } from "@/modules/passes/internal";
import { redeemEntryPass } from "@/modules/passes/service";
import { eventInput, localIn, makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
let event: { id: string };
let code: string;

const conflict = (c: string) => (e: unknown) => e instanceof ConflictError && e.code === c;
const guest = (n: number, extra: Record<string, unknown> = {}) => ({ firstName: `Davetli${n}`, lastName: "Link", phone: `0532 900 00 ${String(n).padStart(2, "0")}`, partySize: "1", ...extra });
const signup = (fields: Record<string, unknown>, ip = "10.1.1.1") => registerViaInvite(code, fields, { ip });

before(async () => {
  await resetDb();
  A = await makeTenant("ia");
  B = await makeTenant("ib");
  // Giriş penceresi açık olsun diye 2 saat sonra başlayan etkinlik
  event = await createEvent(A.owner, eventInput(A.venue.id, { name: "Link Gecesi", startsAt: localIn(2), endsAt: localIn(8), capacity: "40" }));
});

beforeEach(() => resetInviteRateLimit());

after(async () => {
  await db.$disconnect();
});

describe("PR davet linki", () => {
  test("PR kendi linkini oluşturur; yönetim oluşturamaz; yenilenince eski link çalışmaz", async () => {
    assert.equal(await getMyInviteLink(A.pr, event.id), null);
    const link = await createInviteLink(A.pr, event.id);
    assert.match(link.url, /\/davet\/[A-Za-z0-9_-]{22}$/);
    assert.ok(link.qr.d.length > 0);
    assert.equal(link.availability.state, "OPEN");
    assert.equal((await createInviteLink(A.pr, event.id)).code, link.code, "idempotent");

    await assert.rejects(createInviteLink(A.owner, event.id), ForbiddenError);
    await assert.rejects(createInviteLink(A.door, event.id), ForbiddenError);
    await assert.rejects(createInviteLink(B.pr, event.id), NotFoundError);
    const draft = await createEvent(A.owner, eventInput(A.venue.id, { status: "DRAFT" }));
    await assert.rejects(createInviteLink(A.pr, draft.id), NotFoundError);
    const cancelled = await createEvent(A.owner, eventInput(A.venue.id, { name: "İptal" }));
    await changeEventStatus(A.owner, cancelled.id, "cancel");
    await assert.rejects(createInviteLink(A.pr, cancelled.id), conflict("EVENT_NOT_OPEN"));

    const rotated = await createInviteLink(A.pr, event.id, { rotate: true });
    assert.notEqual(rotated.code, link.code);
    assert.equal(await resolveInvite(link.code), null, "eski link geçersiz");
    await assert.rejects(registerViaInvite(link.code, guest(90), { ip: "x" }), NotFoundError);
    const resolved = await resolveInvite(rotated.code);
    assert.equal(resolved?.event.name, "Link Gecesi");
    assert.equal(resolved?.promoterFirstName, "PR", "yalnızca PR'ın ilk adı görünür");
    code = rotated.code;
  });

  test("misafir linkten kayıt olur: PR'a atfedilir, kendi QR'ını alır, izin oluşmaz; kod kapıda çalışır", async () => {
    const result = await signup(guest(1, { partySize: "2" }));
    assert.equal(result.status, "created");
    const token = result.status === "created" ? result.passToken : "";
    const pass = await findPassByToken(token);
    assert.ok(pass?.registration);
    assert.equal(pass.issuedByUserId, null);

    const reg = await db.eventRegistration.findUniqueOrThrow({ where: { id: pass.registration.id }, include: { customer: true } });
    assert.equal(reg.channel, "PR_REFERRAL");
    assert.equal(reg.completionStatus, "SELF_COMPLETED");
    assert.equal(reg.prMembershipId, A.pr.membershipId);
    assert.equal(reg.partySize, 2);
    assert.equal(reg.customer.source, "PR_REFERRAL");
    assert.equal(reg.customer.sourceMembershipId, A.pr.membershipId);
    assert.equal(await db.contactConsent.count({ where: { customerId: reg.customerId } }), 0);

    const link = await getMyInviteLink(A.pr, event.id);
    assert.deepEqual(link?.stats, { registrations: 1, people: 2, admitted: 0 });
    const list = await getEventGuestList(A.pr, event.id);
    assert.ok(list.guests.some((g) => g.name === "Davetli1 L." && g.source === "PROMOTER"));
    assert.equal((await getPromoterStats(A.pr, event.id)).people, 2);

    await redeemEntryPass(A.door, token, { admittedCount: 2 });
    assert.equal((await getMyInviteLink(A.pr, event.id))?.stats.admitted, 2);
  });

  test("kayıtlı numara: kayıt alınır ama QR gösterilmez, müşteri bilgisi değişmez", async () => {
    const existing = await createCustomer(A.owner, { firstName: "Selin", lastName: "Kaya", phone: "0532 900 00 99" });
    const result = await signup({ firstName: "Başka", lastName: "Biri", phone: "+90 532 900 00 99", partySize: "1" });
    assert.equal(result.status, "registered_existing");
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: existing.id } })).firstName, "Selin");
    assert.equal(await db.pass.count({ where: { customerId: existing.id } }), 0, "QR üretilmez");
    const reg = await db.eventRegistration.findFirstOrThrow({ where: { eventId: event.id, customerId: existing.id } });
    assert.equal(reg.prMembershipId, A.pr.membershipId);
    const row = (await getEventGuestList(A.pr, event.id)).guests.find((g) => g.id === reg.id);
    assert.equal(row?.name, "Kayıtlı müşteri");
  });

  test("mükerrer, iptal edilmiş, kapasite, kayıt penceresi ve doğrulama", async () => {
    assert.equal((await signup(guest(1, { phone: "05329000001" }))).status, "duplicate");

    const r = await signup(guest(2));
    assert.equal(r.status, "created");
    const reg = await db.eventRegistration.findFirstOrThrow({ where: { eventId: event.id, customer: { phone: "+905329000002" } } });
    await cancelRegistration(A.owner, reg.id);
    assert.equal((await signup(guest(2))).status, "blocked", "iptal edilmiş kayıt linkle açılmaz");

    await assert.rejects(signup(guest(3, { phone: "123" })), ValidationError);
    await assert.rejects(signup(guest(3, { partySize: "11" })), ValidationError);
    await assert.rejects(signup(guest(3, { firstName: "" })), ValidationError);

    resetInviteRateLimit(); // aynı IP'den art arda deneme sınırı bu testin konusu değil
    // aktif kişi: 2 (Davetli1) + 1 (Selin) = 3; kapasite 4 iken 2 kişilik kayıt sığmaz
    await db.event.update({ where: { id: event.id }, data: { capacity: 4 } });
    await assert.rejects(signup(guest(4, { partySize: "2" })), conflict("CAPACITY_EXCEEDED"));
    await db.event.update({ where: { id: event.id }, data: { capacity: 40 } });

    await db.event.update({ where: { id: event.id }, data: { registrationClosesAt: new Date(Date.now() - 60_000) } });
    await assert.rejects(signup(guest(5)), conflict("INVITE_CLOSED"));
    assert.equal((await resolveInvite(code))?.availability.state, "CLOSED");
    await db.event.update({ where: { id: event.id }, data: { registrationClosesAt: null, registrationOpensAt: new Date(Date.now() + 3600_000) } });
    await assert.rejects(signup(guest(5)), conflict("INVITE_NOT_YET"));
    assert.equal((await resolveInvite(code))?.availability.state, "NOT_YET");
    await db.event.update({ where: { id: event.id }, data: { registrationOpensAt: null } });
  });

  test("bal küpü, hız sınırı; pasif PR ve askıdaki işletmede link çalışmaz", async () => {
    assert.equal((await signup(guest(6, { website: "http://spam.test" }))).status, "ignored");
    assert.equal(await db.customer.count({ where: { phone: "+905329000006" } }), 0);

    for (let i = 0; i < 8; i++) await assert.rejects(signup({ firstName: "", lastName: "", phone: "" }, "9.9.9.9"), ValidationError);
    await assert.rejects(signup(guest(7), "9.9.9.9"), conflict("RATE_LIMITED"));
    assert.equal((await signup(guest(7), "9.9.9.10")).status, "created", "başka IP etkilenmez");

    await assert.rejects(registerViaInvite("x", guest(8), { ip: "1" }), NotFoundError);
    assert.equal(await resolveInvite("A".repeat(22)), null);

    await db.membership.update({ where: { id: A.pr.membershipId }, data: { status: "DISABLED" } });
    assert.equal(await resolveInvite(code), null, "pasif PR'ın linki çalışmaz");
    await assert.rejects(signup(guest(8)), NotFoundError);
    await db.membership.update({ where: { id: A.pr.membershipId }, data: { status: "ACTIVE" } });

    await db.tenant.update({ where: { id: A.tenant.id }, data: { status: "SUSPENDED" } });
    assert.equal(await resolveInvite(code), null);
    await db.tenant.update({ where: { id: A.tenant.id }, data: { status: "ACTIVE" } });
  });

  test("aynı numarayla eşzamanlı iki gönderim tek kayıt oluşturur", async () => {
    const results = await Promise.all([signup(guest(9), "20.0.0.1"), signup(guest(9), "20.0.0.2")]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["created", "duplicate"]);
    assert.equal(await db.customer.count({ where: { tenantId: A.tenant.id, phone: "+905329000009" } }), 1);
  });
});
