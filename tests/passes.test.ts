import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer, setCustomerArchived } from "@/modules/customers/service";
import { addExistingGuest, cancelRegistration, changeEventStatus, createEvent } from "@/modules/events/service";
import {
  extendEntryWindow,
  getCustomerVerifiedActivity,
  getDoorEvent,
  getEventCheckInStats,
  getOrIssueEntryPass,
  getPublicPassView,
  listDoorEvents,
  manualCheckIn,
  redeemEntryPass,
  resolveStaffPass,
  undoCheckIn,
} from "@/modules/passes/service";
import {
  createPerk,
  getOrIssuePerkPass,
  listCustomerPerks,
  listMyRedemptionsToday,
  redeemPerkPass,
  setPerkStatus,
} from "@/modules/perks/service";
import { derivePassToken, hashPassToken, isWellFormedPassToken } from "@/modules/passes/token";
import { ENTRY_LATE_HOURS, entryWindow, evaluateEntryPass, maskedName } from "@/modules/passes/rules";
import { encodeQr, formatBitsFor, gfMultiply, reedSolomonDivisor, reedSolomonRemainder } from "@/lib/qr/encoder";
import { eventInput, localIn, makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
let guest: { id: string };
let openEvent: { id: string };

const tokenOf = (url: string) => url.split("/").pop()!;
const code = (c: string) => (e: unknown) => e instanceof ConflictError && e.code === c;

async function newGuest(eventId: string, n: number, partySize = 1) {
  const c = await createCustomer(A.owner, { firstName: `Misafir${n}`, lastName: "Test", phone: `0532 000 20 ${String(n).padStart(2, "0")}` });
  const reg = await addExistingGuest(A.owner, eventId, { customerId: c.id, partySize });
  return { customer: c, reg };
}

before(async () => {
  await resetDb();
  A = await makeTenant("qa");
  B = await makeTenant("qb");
  guest = await createCustomer(A.owner, { firstName: "Ayşe", lastName: "Yılmaz", phone: "0532 000 10 01", email: "ayse@example.com" });
  openEvent = await createEvent(A.owner, eventInput(A.venue.id, { name: "Açık Gece", startsAt: localIn(-1), endsAt: localIn(5) }));
});

after(async () => {
  await db.$disconnect();
});

describe("QR kodlayıcı", () => {
  test("Reed–Solomon kod sözcükleri üreteç köklerinde sıfırlanır", () => {
    for (const degree of [10, 18, 26]) {
      const divisor = reedSolomonDivisor(degree);
      const data = Array.from({ length: 40 }, (_, i) => (i * 37 + 11) & 0xff);
      const codeword = [...data, ...reedSolomonRemainder(data, divisor)];
      let root = 1;
      for (let i = 0; i < degree; i++) {
        let y = 0;
        for (const b of codeword) y = gfMultiply(y, root) ^ b;
        assert.equal(y, 0, `derece ${degree}, kök α^${i}`);
        root = gfMultiply(root, 2);
      }
    }
  });

  test("biçim bitleri standart tabloyla eşleşir (M, maske 0 = 101010000010010)", () => {
    assert.equal(formatBitsFor(0), 0b101010000010010);
  });

  test("sürüm seçimi ve bulucu desenleri", () => {
    assert.equal(encodeQr("HELLO").version, 1);
    const url = `http://localhost:3000/q/${"a".repeat(32)}`;
    const qr = encodeQr(url);
    assert.equal(qr.size, 17 + 4 * qr.version);
    for (let i = 0; i < 7; i++) assert.equal(qr.modules[0][i], true, "üst sol bulucu");
    assert.equal(qr.modules[1][1], false);
    assert.equal(qr.modules[3][3], true);
    assert.throws(() => encodeQr("x".repeat(300)));
  });
});

describe("token", () => {
  test("türetme deterministik, 192 bit ve kişisel veri içermez", () => {
    const t1 = derivePassToken("pass-1");
    assert.equal(t1, derivePassToken("pass-1"));
    assert.notEqual(t1, derivePassToken("pass-2"));
    assert.ok(isWellFormedPassToken(t1));
    assert.equal(Buffer.from(t1, "base64url").length, 24);
    assert.match(hashPassToken(t1), /^[0-9a-f]{64}$/);
    assert.equal(isWellFormedPassToken("../../etc"), false);
  });

  test("kurallar: giriş penceresi ve maskeli ad", () => {
    const event = { status: "PUBLISHED", startsAt: new Date("2026-09-20T19:00:00Z"), endsAt: new Date("2026-09-21T01:00:00Z"), entryClosesAt: null };
    const pass = { revokedAt: null, useCount: 0, maxUses: 1 };
    const reg = { accessStatus: "ACTIVE" };
    assert.equal(evaluateEntryPass(pass, reg, event, new Date("2026-09-20T12:59:00Z")), "NOT_YET_VALID");
    assert.equal(evaluateEntryPass(pass, reg, event, new Date("2026-09-20T13:01:00Z")), "VALID");
    assert.equal(evaluateEntryPass(pass, reg, event, new Date("2026-09-21T01:01:00Z")), "EXPIRED");
    assert.equal(entryWindow(event).closesAt.toISOString(), "2026-09-21T01:00:00.000Z");
    assert.equal(maskedName("Ayşe", "ılgaz"), "Ayşe I.");
  });
});

describe("giriş QR'ı", () => {
  let token: string;
  let regId: string;

  before(async () => {
    const reg = await addExistingGuest(A.owner, openEvent.id, { customerId: guest.id, partySize: 3 });
    regId = reg.id;
  });

  test("oluşturma idempotent; QR yalnızca doğrulama bağlantısı taşır", async () => {
    const p1 = await getOrIssueEntryPass(A.owner, regId);
    const p2 = await getOrIssueEntryPass(A.crm, regId);
    assert.equal(p1.passId, p2.passId);
    assert.equal(p1.state, "VALID");
    assert.match(p1.scanUrl, /^http:\/\/test\.local\/q\/[A-Za-z0-9_-]{32}$/);
    token = tokenOf(p1.scanUrl);
    const stored = await db.pass.findUniqueOrThrow({ where: { id: p1.passId } });
    assert.equal(stored.tokenHash, hashPassToken(token));
    assert.ok(!JSON.stringify(stored).includes(token), "ham token DB'de saklanmaz");
  });

  test("müşteri sayfası yalnızca maskeli ad gösterir", async () => {
    const view = await getPublicPassView(token);
    assert.ok(view);
    assert.equal(view.holder, "Ayşe Y.");
    assert.equal(view.showQr, true);
    const json = JSON.stringify(view);
    for (const secret of ["Yılmaz", "+905320001001", "ayse@example.com"]) assert.ok(!json.includes(secret), secret);
    assert.equal(await getPublicPassView("x".repeat(32)), null);
  });

  test("başka tenant ve yetkisiz roller doğrulayamaz", async () => {
    await assert.rejects(redeemEntryPass(B.door, token), NotFoundError);
    assert.equal((await resolveStaffPass(B.door.userId, token)).kind, "outsider");
    assert.equal((await resolveStaffPass(A.crm.userId, token)).kind, "forbidden");
    await assert.rejects(redeemEntryPass(A.waiter, token), ForbiddenError);
    await assert.rejects(redeemEntryPass(A.crm, token), ForbiddenError);
  });

  test("mekan kısıtlı kapı görevlisi başka mekanın QR'ını doğrulayamaz", async () => {
    const other = await db.venue.create({ data: { tenantId: A.tenant.id, name: "Diğer", slug: "qa-diger", type: "PUB" } });
    await assert.rejects(redeemEntryPass({ ...A.door, venueIds: [other.id] }, token), ForbiddenError);
  });

  test("kişi sayısı parti büyüklüğünü aşamaz", async () => {
    await assert.rejects(redeemEntryPass(A.door, token, { admittedCount: 4 }), ValidationError);
  });

  test("iki cihaz aynı anda okutursa yalnızca bir giriş kaydedilir", async () => {
    const results = await Promise.allSettled([
      redeemEntryPass(A.door, token, { admittedCount: 3 }),
      redeemEntryPass(A.owner, token, { admittedCount: 3 }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof ConflictError, String(rejected.reason));
    assert.equal(await db.checkIn.count({ where: { registrationId: regId } }), 1);
    const stored = await db.pass.findFirstOrThrow({ where: { registrationId: regId, revokedAt: null } });
    assert.equal(stored.useCount, 1);
  });

  test("kullanılmış QR: tekrar okutma reddedilir, personel giriş bilgisini görür, müşteri QR'ı görmez", async () => {
    await assert.rejects(redeemEntryPass(A.door, token), code("USED"));
    const res = await resolveStaffPass(A.door.userId, token);
    assert.equal(res.kind, "staff");
    if (res.kind === "staff") {
      assert.equal(res.view.state, "USED");
      assert.equal(res.view.entry?.checkIn?.admittedCount, 3);
      assert.ok(!JSON.stringify(res.view).includes("+90532"), "kapı görünümünde telefon yok");
    }
    const view = await getPublicPassView(token);
    assert.equal(view?.showQr, false);
  });

  test("manuel giriş kullanılmamış QR'ı tüketir; ikinci giriş engellenir", async () => {
    const { reg } = await newGuest(openEvent.id, 1, 2);
    const pass = await getOrIssueEntryPass(A.owner, reg.id);
    await manualCheckIn(A.door, reg.id, { admittedCount: 1 });
    await assert.rejects(redeemEntryPass(A.door, tokenOf(pass.scanUrl)), code("USED"));
    await assert.rejects(manualCheckIn(A.door, reg.id), code("ALREADY_CHECKED_IN"));
  });

  test("yenilenen QR eskisini iptal eder", async () => {
    const { reg } = await newGuest(openEvent.id, 2);
    const old = await getOrIssueEntryPass(A.owner, reg.id);
    const fresh = await getOrIssueEntryPass(A.owner, reg.id, { reissue: true });
    assert.notEqual(old.passId, fresh.passId);
    await assert.rejects(redeemEntryPass(A.door, tokenOf(old.scanUrl)), code("REVOKED"));
    assert.equal((await getPublicPassView(tokenOf(old.scanUrl)))?.state, "REVOKED");
    await redeemEntryPass(A.door, tokenOf(fresh.scanUrl));
  });

  test("iptal edilen guest kaydı ve iptal edilen etkinlik girişe izin vermez", async () => {
    const { reg } = await newGuest(openEvent.id, 3);
    const pass = await getOrIssueEntryPass(A.owner, reg.id);
    await cancelRegistration(A.owner, reg.id);
    await assert.rejects(redeemEntryPass(A.door, tokenOf(pass.scanUrl)), code("REGISTRATION_CANCELLED"));
    await assert.rejects(getOrIssueEntryPass(A.owner, reg.id), code("REGISTRATION_CANCELLED"));

    const future = await createEvent(A.owner, eventInput(A.venue.id, { name: "Gelecek" }));
    const g = await newGuest(future.id, 4);
    const futurePass = await getOrIssueEntryPass(A.owner, g.reg.id);
    assert.equal(futurePass.state, "NOT_YET_VALID");
    await assert.rejects(redeemEntryPass(A.door, tokenOf(futurePass.scanUrl)), code("NOT_YET_VALID"));
    await changeEventStatus(A.owner, future.id, "cancel");
    await assert.rejects(redeemEntryPass(A.door, tokenOf(futurePass.scanUrl)), code("EVENT_CANCELLED"));
  });

  test("kapı ekranı: yalnızca giriş bilgileri, tenant izolasyonu ve gerçek sayılar", async () => {
    const events = await listDoorEvents(A.door);
    const open = events.find((e) => e.id === openEvent.id);
    assert.ok(open);
    assert.equal(open.windowState, "OPEN");
    assert.equal(open.checkIns, 3);
    assert.equal(open.admitted, 5);
    const door = await getDoorEvent(A.door, openEvent.id);
    assert.ok(!JSON.stringify(door).includes("+90532"), "kapı listesinde telefon yok");
    assert.equal(door.guests.filter((g) => g.checkIn).length, 3);
    await assert.rejects(getDoorEvent(B.door, openEvent.id), NotFoundError);
    assert.equal((await listDoorEvents(B.door)).length, 0);
    await assert.rejects(listDoorEvents(A.crm), ForbiddenError);

    const stats = await getEventCheckInStats(A.owner, openEvent.id);
    assert.deepEqual(stats, { checkIns: 3, admitted: 5, viaQr: 2, manual: 1 });
    const activity = await getCustomerVerifiedActivity(A.owner, guest.id);
    assert.equal(activity.checkIns.length, 1);
    await assert.rejects(getCustomerVerifiedActivity(B.owner, guest.id), NotFoundError);
  });
});

describe("avantaj QR'ı", () => {
  test("tanım doğrulaması ve tenant'lar arası mekan engeli", async () => {
    await assert.rejects(createPerk(A.owner, { name: "X", perCustomerLimit: "0" }), ValidationError);
    await assert.rejects(createPerk(A.owner, { name: "Kokteyl", venueId: B.venue.id }), ValidationError);
    await assert.rejects(createPerk(A.door, { name: "Kokteyl" }), ForbiddenError);
  });

  test("kişi başı limit, rol ve tenant kontrolleri", async () => {
    const perk = await createPerk(A.owner, { name: "Hoş geldin kokteyli", perCustomerLimit: "2", venueId: A.venue.id });
    const pass = await getOrIssuePerkPass(A.crm, { customerId: guest.id, perkId: perk.id });
    assert.equal(pass.remaining, 2);
    const again = await getOrIssuePerkPass(A.owner, { customerId: guest.id, perkId: perk.id });
    assert.equal(again.passId, pass.passId);
    const token = tokenOf(pass.scanUrl);

    await assert.rejects(redeemPerkPass(A.door, token), ForbiddenError);
    await assert.rejects(redeemPerkPass(A.crm, token), ForbiddenError);
    await assert.rejects(redeemPerkPass(B.waiter, token), NotFoundError);
    await assert.rejects(getOrIssuePerkPass(B.owner, { customerId: guest.id, perkId: perk.id }), NotFoundError);

    assert.equal((await redeemPerkPass(A.waiter, token)).remaining, 1);
    const staff = await resolveStaffPass(A.waiter.userId, token);
    assert.equal(staff.kind, "staff");
    if (staff.kind === "staff") {
      assert.equal(staff.view.perk?.holder, "Ayşe Y.");
      assert.equal(staff.view.perk?.remaining, 1);
      assert.ok(!JSON.stringify(staff.view).includes("Yılmaz"), "garson tam adı görmez");
    }
    assert.equal((await redeemPerkPass(A.waiter, token)).remaining, 0);
    await assert.rejects(redeemPerkPass(A.waiter, token), code("USED"));
    await assert.rejects(getOrIssuePerkPass(A.owner, { customerId: guest.id, perkId: perk.id }), code("LIMIT_REACHED"));

    const mine = await listMyRedemptionsToday(A.waiter);
    assert.equal(mine.length, 2);
    assert.equal(mine[0].holder, "Ayşe Y.");
    const perks = await listCustomerPerks(A.owner, guest.id);
    assert.equal(perks.find((p) => p.perkId === perk.id)?.availability, "LIMIT_REACHED");
    assert.equal((await getCustomerVerifiedActivity(A.owner, guest.id)).redemptionCount, 2);
  });

  test("eşzamanlı iki kullanımda yalnızca biri geçer", async () => {
    const perk = await createPerk(A.owner, { name: "Tatlı ikramı", perCustomerLimit: "1" });
    const pass = await getOrIssuePerkPass(A.owner, { customerId: guest.id, perkId: perk.id });
    const token = tokenOf(pass.scanUrl);
    const results = await Promise.allSettled([redeemPerkPass(A.waiter, token), redeemPerkPass(A.owner, token)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await db.perkRedemption.count({ where: { perkId: perk.id } }), 1);
  });

  test("arşivlenen avantaj kullanılamaz", async () => {
    const perk = await createPerk(A.owner, { name: "Kahve", perCustomerLimit: "3" });
    const pass = await getOrIssuePerkPass(A.owner, { customerId: guest.id, perkId: perk.id });
    await setPerkStatus(A.owner, perk.id, "ARCHIVED");
    await assert.rejects(redeemPerkPass(A.waiter, tokenOf(pass.scanUrl)), code("PERK_INACTIVE"));
    await assert.rejects(setPerkStatus(B.owner, perk.id, "ACTIVE"), NotFoundError);
  });
});

describe("girişi geri alma", () => {
  test("yalnızca işletme sahibi geri alır; QR yeniden geçerli olur", async () => {
    const { reg } = await newGuest(openEvent.id, 10, 2);
    const pass = await getOrIssueEntryPass(A.owner, reg.id);
    const token = tokenOf(pass.scanUrl);
    await redeemEntryPass(A.door, token, { admittedCount: 2 });

    await assert.rejects(undoCheckIn(A.door, reg.id), ForbiddenError);
    await assert.rejects(undoCheckIn(A.crm, reg.id), ForbiddenError);
    await assert.rejects(undoCheckIn(B.owner, reg.id), NotFoundError);

    const result = await undoCheckIn(A.owner, reg.id);
    assert.equal(result.passRestored, true);
    assert.equal(await db.checkIn.count({ where: { registrationId: reg.id } }), 0);
    const stored = await db.pass.findUniqueOrThrow({ where: { id: pass.passId } });
    assert.equal(stored.useCount, 0);
    assert.equal(stored.lastUsedAt, null);
    assert.equal((await getPublicPassView(token))?.state, "VALID");

    const again = await redeemEntryPass(A.door, token, { admittedCount: 1 });
    assert.equal(again.admittedCount, 1);
    await assert.rejects(undoCheckIn(A.owner, "olmayan-kayit"), NotFoundError);
  });

  test("manuel giriş geri alınır; denetim kaydı kalır", async () => {
    const { reg } = await newGuest(openEvent.id, 11);
    await manualCheckIn(A.door, reg.id);
    const result = await undoCheckIn(A.owner, reg.id);
    assert.equal(result.passRestored, false);
    assert.equal(await db.checkIn.count({ where: { registrationId: reg.id } }), 0);
    await assert.rejects(undoCheckIn(A.owner, reg.id), code("NO_CHECKIN"));

    const log = await db.activityLog.findFirst({
      where: { tenantId: A.tenant.id, action: "checkin.undone" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(log, "geri alma aktivite geçmişine yazılır");
    await manualCheckIn(A.door, reg.id); // geri alındıktan sonra yeniden giriş yapılabilir
  });
});

describe("giriş penceresi uzatma", () => {
  test("kapanan giriş uzatılır; geç giriş kaydedilir", async () => {
    const late = await createEvent(A.owner, eventInput(A.venue.id, { name: "Geç Gece", startsAt: localIn(-3), endsAt: localIn(1) }));
    const { reg } = await newGuest(late.id, 12);
    await db.event.update({ where: { id: late.id }, data: { entryClosesAt: new Date(Date.now() - 30 * 60_000) } });

    await assert.rejects(manualCheckIn(A.door, reg.id), code("EXPIRED"));
    await assert.rejects(extendEntryWindow(A.crm, late.id, 60), ForbiddenError);
    await assert.rejects(extendEntryWindow(A.waiter, late.id, 60), ForbiddenError);
    await assert.rejects(extendEntryWindow(B.door, late.id, 60), NotFoundError);
    await assert.rejects(extendEntryWindow(A.door, late.id, 5), ValidationError);

    const extended = await extendEntryWindow(A.door, late.id, 60);
    assert.equal(extended.windowState, "OPEN");
    assert.ok(extended.closesAt.getTime() > Date.now());
    assert.equal((await manualCheckIn(A.door, reg.id)).method, "MANUAL");

    // Bitişten en fazla ENTRY_LATE_HOURS saat sonrasına kadar uzatılabilir.
    await db.event.update({
      where: { id: late.id },
      data: { entryClosesAt: new Date(Date.now() + (ENTRY_LATE_HOURS + 1) * 3600 * 1000) },
    });
    await assert.rejects(extendEntryWindow(A.door, late.id, 60), code("EXPIRED"));
  });

  test("giriş kapanışı bitişten sonrasına ayarlanabilir, sınırı aşamaz", async () => {
    const event = await createEvent(A.owner, eventInput(A.venue.id, { name: "Uzun Gece", entryClosesAt: localIn(56) }));
    assert.ok(event.entryClosesAt && event.entryClosesAt > event.endsAt, "bitişten sonrası kabul edilir");
    await assert.rejects(
      createEvent(A.owner, eventInput(A.venue.id, { name: "Çok Uzun Gece", entryClosesAt: localIn(54 + ENTRY_LATE_HOURS + 1) })),
      ValidationError,
    );
  });
});

describe("arşiv kuralı ve kapı listesi sınırı", () => {
  test("arşivdeki müşterinin QR'ları çalışmaya devam eder", async () => {
    const { customer, reg } = await newGuest(openEvent.id, 13);
    const entry = await getOrIssueEntryPass(A.owner, reg.id);
    const perk = await createPerk(A.owner, { name: "Arşiv ikramı", perCustomerLimit: "1" });
    await setCustomerArchived(A.owner, customer.id, true);

    const perkPass = await getOrIssuePerkPass(A.owner, { customerId: customer.id, perkId: perk.id });
    assert.equal((await redeemPerkPass(A.waiter, tokenOf(perkPass.scanUrl))).remaining, 0);
    assert.equal((await redeemEntryPass(A.door, tokenOf(entry.scanUrl))).admittedCount, 1);
    assert.ok((await listCustomerPerks(A.owner, customer.id)).length > 0);
  });

  test("kapı listesi sınırı raporlanır", async () => {
    const door = await getDoorEvent(A.door, openEvent.id);
    assert.equal(door.limit, 300);
    assert.equal(door.truncated, false);
  });
});
