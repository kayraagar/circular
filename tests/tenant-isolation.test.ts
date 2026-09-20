import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createCustomer,
  getCustomerProfile,
  listCustomers,
  parseCustomerFilters,
  setConsent,
  updateCustomer,
} from "@/modules/customers/service";
import {
  addExistingGuest,
  addNewGuest,
  cancelRegistration,
  changeEventStatus,
  createEvent,
  getEventDetail,
  listEvents,
} from "@/modules/events/service";
import { getDashboard } from "@/modules/dashboard/service";
import { listActivity } from "@/modules/activity/service";
import { eventInput, makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
let customerA: { id: string };
let customerB: { id: string };
let eventA: { id: string };
let eventB: { id: string };

const allFilters = parseCustomerFilters({});

before(async () => {
  await resetDb();
  A = await makeTenant("a");
  B = await makeTenant("b");
  customerA = await createCustomer(A.owner, { firstName: "Ayşe", lastName: "Yılmaz", phone: "0532 000 00 01" });
  customerB = await createCustomer(B.owner, { firstName: "Burak", lastName: "Demir", phone: "0532 000 00 02" });
  eventA = await createEvent(A.owner, eventInput(A.venue.id, { capacity: "10" }));
  eventB = await createEvent(B.owner, eventInput(B.venue.id));
});

after(async () => {
  await db.$disconnect();
});

describe("tenant izolasyonu", () => {
  test("müşteri listesi yalnızca kendi tenant'ını döndürür", async () => {
    const list = await listCustomers(A.owner, allFilters);
    assert.deepEqual(
      list.items.map((c) => c.id),
      [customerA.id],
    );
  });

  test("başka tenant'ın müşteri profili bulunamaz (404)", async () => {
    await assert.rejects(getCustomerProfile(A.owner, customerB.id), NotFoundError);
  });

  test("başka tenant'ın müşterisi güncellenemez ve veri değişmez", async () => {
    await assert.rejects(
      updateCustomer(A.owner, customerB.id, { firstName: "Hack", lastName: "Deneme", phone: "0532 000 00 02" }),
      NotFoundError,
    );
    const b = await db.customer.findUniqueOrThrow({ where: { id: customerB.id } });
    assert.equal(b.firstName, "Burak");
  });

  test("başka tenant'ın müşterisi için izin kaydedilemez", async () => {
    await assert.rejects(
      setConsent(A.owner, { customerId: customerB.id, channel: "SMS", grant: true, note: "deneme" }),
      NotFoundError,
    );
  });

  test("başka tenant'ın etkinliği görüntülenemez", async () => {
    await assert.rejects(getEventDetail(A.owner, eventB.id), NotFoundError);
    const events = await listEvents(A.owner, { scope: "all" });
    assert.ok(events.every((e) => e.tenantId === A.tenant.id));
  });

  test("başka tenant'ın müşterisi kendi etkinliğine guest eklenemez", async () => {
    await assert.rejects(addExistingGuest(A.owner, eventA.id, { customerId: customerB.id, partySize: 1 }), NotFoundError);
  });

  test("kendi müşterisi başka tenant'ın etkinliğine eklenemez", async () => {
    await assert.rejects(addExistingGuest(A.owner, eventB.id, { customerId: customerA.id, partySize: 1 }), NotFoundError);
  });

  test("boş müşteri id'si tüm tenant'ı eşleştirmez", async () => {
    await assert.rejects(addExistingGuest(A.owner, eventA.id, { customerId: "", partySize: 1 }), ValidationError);
  });

  test("veritabanı composite FK ile tenant'lar arası bağlantıyı reddeder", async () => {
    await assert.rejects(
      db.eventRegistration.create({
        data: { tenantId: A.tenant.id, eventId: eventA.id, customerId: customerB.id, channel: "STAFF" },
      }),
    );
  });

  test("başka tenant'ın guest kaydı iptal edilemez", async () => {
    const regB = await addExistingGuest(B.owner, eventB.id, { customerId: customerB.id, partySize: 1 });
    await assert.rejects(cancelRegistration(A.owner, regB.id), NotFoundError);
  });

  test("aktivite geçmişi tenant'lar arasında karışmaz", async () => {
    const { items } = await listActivity(A.owner, { limit: 100 });
    const ids = new Set([customerB.id, eventB.id]);
    assert.ok(items.every((i) => !ids.has(i.entityId) && !ids.has(i.customerId ?? "")));
  });

  test("aynı telefon farklı tenant'larda ayrı müşteri olabilir (otomatik birleştirme yok)", async () => {
    const c = await createCustomer(A.owner, { firstName: "Burak", lastName: "Demir", phone: "+90 532 000 00 02" });
    assert.notEqual(c.id, customerB.id);
    assert.equal(c.tenantId, A.tenant.id);
    await db.customer.delete({ where: { id: c.id } });
  });
});

describe("rol yetkileri (sunucu tarafı)", () => {
  test("kapı görevlisi müşteri listesine erişemez", async () => {
    await assert.rejects(listCustomers(A.door, allFilters), ForbiddenError);
  });
  test("PR Faz 1'de müşteri profili açamaz", async () => {
    await assert.rejects(getCustomerProfile(A.pr, customerA.id), ForbiddenError);
  });
  test("kapı görevlisi guest ekleyemez", async () => {
    await assert.rejects(addExistingGuest(A.door, eventA.id, { customerId: customerA.id, partySize: 1 }), ForbiddenError);
  });
  test("CRM yöneticisi müşteri ekleyebilir ama dashboard dışında yetkisiz işlem yapamaz", async () => {
    const list = await listCustomers(A.crm, allFilters);
    assert.ok(list.total >= 1);
    await assert.rejects(getDashboard(A.door, { periodDays: 30, venueId: null }), ForbiddenError);
  });
});

describe("mükerrer kayıt ve guest kuralları", () => {
  test("aynı telefon aynı tenant'ta ikinci kez oluşturulamaz (farklı biçimde yazılsa bile)", async () => {
    await assert.rejects(
      createCustomer(A.owner, { firstName: "Başka", lastName: "Kişi", phone: "+905320000001" }),
      (e: unknown) => e instanceof ConflictError && e.code === "DUPLICATE_CONTACT",
    );
  });

  test("aynı isim uyarı verir, onaylanınca oluşturulur", async () => {
    await assert.rejects(
      createCustomer(A.owner, { firstName: "AYŞE", lastName: "yılmaz", email: "ayse.baska@example.com" }),
      (e: unknown) => e instanceof ConflictError && e.code === "POSSIBLE_DUPLICATE",
    );
    const c = await createCustomer(
      A.owner,
      { firstName: "Ayşe", lastName: "Yılmaz", email: "ayse.baska@example.com" },
      { confirmPossibleDuplicate: true },
    );
    assert.ok(c.id);
  });

  test("iletişim bilgisi olmadan müşteri oluşturulamaz", async () => {
    await assert.rejects(createCustomer(A.owner, { firstName: "Adsız", lastName: "Kişi" }), ValidationError);
  });

  test("aynı müşteri aynı etkinliğe iki kez eklenemez", async () => {
    await addExistingGuest(A.owner, eventA.id, { customerId: customerA.id, partySize: 2 });
    await assert.rejects(
      addExistingGuest(A.owner, eventA.id, { customerId: customerA.id, partySize: 1 }),
      (e: unknown) => e instanceof ConflictError && e.code === "ALREADY_REGISTERED",
    );
    const count = await db.eventRegistration.count({ where: { eventId: eventA.id, customerId: customerA.id } });
    assert.equal(count, 1);
  });

  test("mevcut telefonla yeni guest girilirse yeni müşteri oluşturulmaz", async () => {
    const before = await db.customer.count({ where: { tenantId: A.tenant.id } });
    await assert.rejects(
      addNewGuest(A.owner, eventA.id, { firstName: "Ayşe", lastName: "Y.", phone: "0532-000-00-01", partySize: 1 }),
      (e: unknown) => e instanceof ConflictError && e.code === "EXISTING_CUSTOMER",
    );
    assert.equal(await db.customer.count({ where: { tenantId: A.tenant.id } }), before);
  });

  test("yeni guest CRM kaydı oluşturur ama iletişim izni veya üyelik oluşturmaz", async () => {
    const { customer } = await addNewGuest(A.owner, eventA.id, {
      firstName: "Can",
      lastName: "Öztürk",
      phone: "0532 000 00 03",
      partySize: 3,
    });
    assert.equal(customer.source, "STAFF_GUEST");
    assert.equal(await db.contactConsent.count({ where: { customerId: customer.id } }), 0);
    assert.equal(await db.venueMembership.count({ where: { customerId: customer.id } }), 0);
  });

  test("kapasite aşılamaz (kişi sayısı toplamı)", async () => {
    // eventA kapasite 10; şu an 2 + 3 = 5 kişi
    await assert.rejects(
      addNewGuest(A.owner, eventA.id, { firstName: "Deniz", lastName: "Kara", phone: "0532 000 00 04", partySize: 6 }),
      (e: unknown) => e instanceof ConflictError && e.code === "CAPACITY_EXCEEDED",
    );
  });

  test("iptal edilen guest yeniden eklenince aynı kayıt etkinleşir", async () => {
    const detail = await getEventDetail(A.owner, eventA.id);
    const reg = detail.registrations.find((r) => r.customerId === customerA.id)!;
    await cancelRegistration(A.owner, reg.id);
    const again = await addExistingGuest(A.owner, eventA.id, { customerId: customerA.id, partySize: 1 });
    assert.equal(again.id, reg.id);
    assert.equal(again.accessStatus, "ACTIVE");
  });
});

describe("dashboard tutarlılığı", () => {
  test("toplamlar kayıtlarla eşleşir", async () => {
    const d = await getDashboard(A.owner, { periodDays: 30, venueId: null });
    assert.equal(d.totalCustomers, await db.customer.count({ where: { tenantId: A.tenant.id, archivedAt: null } }));
    const active = await db.eventRegistration.aggregate({
      where: { tenantId: A.tenant.id, accessStatus: "ACTIVE" },
      _count: { _all: true },
      _sum: { partySize: true },
    });
    assert.equal(d.periodRegistrations.count, active._count._all);
    assert.equal(d.periodRegistrations.people, active._sum.partySize);
    assert.equal(d.upcomingCount, 1);
  });

  test("izin sayıları yalnızca GRANTED kayıtlardan gelir", async () => {
    await setConsent(A.owner, { customerId: customerA.id, channel: "WHATSAPP", grant: true, note: "Kasa formu" });
    let d = await getDashboard(A.owner, { periodDays: 7, venueId: null });
    assert.equal(d.consents.WHATSAPP, 1);
    await setConsent(A.owner, { customerId: customerA.id, channel: "WHATSAPP", grant: false });
    d = await getDashboard(A.owner, { periodDays: 7, venueId: null });
    assert.equal(d.consents.WHATSAPP, 0);
  });
});

describe("etkinlik durumu", () => {
  test("iptal edilen etkinlikte giriş hakları düşer ve guest eklenemez", async () => {
    const ev = await createEvent(A.owner, eventInput(A.venue.id, { name: "İptal Testi" }));
    await addExistingGuest(A.owner, ev.id, { customerId: customerA.id, partySize: 1 });
    await changeEventStatus(A.owner, ev.id, "cancel");
    const regs = await db.eventRegistration.findMany({ where: { eventId: ev.id } });
    assert.ok(regs.every((r) => r.accessStatus === "CANCELLED"));
    await assert.rejects(
      addExistingGuest(A.owner, ev.id, { customerId: customerA.id, partySize: 1 }),
      (e: unknown) => e instanceof ConflictError && e.code === "EVENT_CANCELLED",
    );
    await assert.rejects(changeEventStatus(B.owner, ev.id, "publish"), NotFoundError);
  });

  test("sona ermiş etkinlik oluşturulamaz, bitiş başlangıçtan önce olamaz", async () => {
    await assert.rejects(
      createEvent(A.owner, eventInput(A.venue.id, { startsAt: "2020-01-01T20:00", endsAt: "2020-01-01T23:00" })),
      ValidationError,
    );
    await assert.rejects(
      createEvent(A.owner, eventInput(A.venue.id, { endsAt: "2020-01-01T23:00" })),
      ValidationError,
    );
  });

  test("başka tenant'ın mekanında etkinlik oluşturulamaz", async () => {
    await assert.rejects(createEvent(A.owner, eventInput(B.venue.id)), ValidationError);
  });
});
