import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createEvent } from "@/modules/events/service";
import { createCustomer } from "@/modules/customers/service";
import { getPublicVenue, registrationState, resetVenuePageRateLimit, venueSignup } from "@/modules/venue-page/service";
import { VENUE_SIGNUP_CONSENT_VERSION } from "@/modules/venue-page/rules";
import { setVenueActive } from "@/modules/venues/service";
import { eventInput, makeTenant, resetDb } from "./helpers";

/**
 * Mekanın müşteriye açık sayfası. Üç kavram ayrıdır: CRM kaydı, mekan üyeliği ve
 * iletişim izni. Etkinliğe kaydolmak tek başına iletişim izni vermez.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let eventId: string;
const IP = { ip: "5.5.5.5" };

before(async () => {
  await resetDb();
  A = await makeTenant("pa");
  // eventInput varsayılan olarak yayındaki (PUBLISHED) etkinlik üretir.
  const event = await createEvent(A.owner, eventInput(A.venue.id, { capacity: "6", name: "Açılış Gecesi" }));
  eventId = event.id;
});

beforeEach(async () => {
  await resetVenuePageRateLimit();
});

after(async () => {
  await db.$disconnect();
});

describe("Kayıt penceresi", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const base = { startsAt: new Date("2026-10-10T18:00:00Z"), registrationOpensAt: null, registrationClosesAt: null, capacity: null };

  test("açılış verilmemişse pencere açıktır", () => {
    assert.equal(registrationState(base, 0, now).state, "OPEN");
  });

  test("açılıştan önce kayıt alınmaz", () => {
    assert.equal(registrationState({ ...base, registrationOpensAt: new Date("2026-10-05T00:00:00Z") }, 0, now).state, "NOT_YET");
  });

  test("kapanıştan sonra ve etkinlik başlayınca kayıt kapanır", () => {
    assert.equal(registrationState({ ...base, registrationClosesAt: new Date("2026-09-30T00:00:00Z") }, 0, now).state, "CLOSED");
    assert.equal(registrationState(base, 0, new Date("2026-10-11T00:00:00Z")).state, "CLOSED");
  });

  test("kapasite dolunca kayıt kapanır ve kalan yer bildirilir", () => {
    const full = registrationState({ ...base, capacity: 4 }, 4, now);
    assert.equal(full.state, "FULL");
    assert.equal(full.spotsLeft, 0);
    assert.equal(registrationState({ ...base, capacity: 4 }, 1, now).spotsLeft, 3);
  });
});

describe("Sayfa görünürlüğü", () => {
  test("bilinmeyen kısa ad bulunamaz", async () => {
    assert.equal(await getPublicVenue("olmayan-mekan"), null);
  });

  test("yalnızca yayındaki etkinlikler listelenir", async () => {
    const draft = await createEvent(A.owner, eventInput(A.venue.id, { name: "Taslak Gece", status: "DRAFT" }));
    const venue = await getPublicVenue(A.venue.slug);
    assert.ok(venue);
    assert.ok(venue.events.some((e) => e.id === eventId), "yayındaki etkinlik görünür");
    assert.ok(!venue.events.some((e) => e.id === draft.id), "taslak etkinlik görünmez");
    assert.equal(venue.tenantName, "Tenant pa");
  });

  test("kapalı mekanın sayfası açılmaz", async () => {
    const extra = await db.venue.create({ data: { tenantId: A.tenant.id, name: "Kapanacak", slug: "kapanacak-pa", type: "CAFE" } });
    await setVenueActive(A.owner, extra.id, false);
    assert.equal(await getPublicVenue("kapanacak-pa"), null);
  });
});

describe("Kendi kaydını açma", () => {
  test("bal küpü doldurulmuşsa sessizce yok sayılır", async () => {
    const before = await db.customer.count({ where: { tenantId: A.tenant.id } });
    const result = await venueSignup(A.venue.slug, { firstName: "Bot", lastName: "Bot", phone: "0532 600 00 99", website: "spam" }, { ip: "9.9.9.9" });
    assert.deepEqual(result, { status: "ignored" });
    assert.equal(await db.customer.count({ where: { tenantId: A.tenant.id } }), before);
  });

  test("eksik bilgi doğrulama hatası verir", async () => {
    await assert.rejects(venueSignup(A.venue.slug, { firstName: "A", lastName: "B" }, IP), ValidationError);
    // E-posta izni işaretliyse adres zorunludur.
    await assert.rejects(
      venueSignup(A.venue.slug, { firstName: "Ece", lastName: "Kaya", phone: "0532 600 00 01", consents: ["EMAIL"] }, IP),
      ValidationError,
    );
  });

  test("üyelik ve izinler ayrı kaydedilir, izin metni sürümü saklanır", async () => {
    const result = await venueSignup(
      A.venue.slug,
      { firstName: "Ece", lastName: "Kaya", phone: "0532 600 00 02", email: "ece@ornek.test", consents: ["EMAIL"] },
      IP,
    );
    assert.equal(result.status, "created");
    assert.equal(result.status === "created" ? result.passToken : "x", null, "etkinlik seçilmediyse QR verilmez");

    const customer = await db.customer.findFirstOrThrow({ where: { phone: "+905326000002" } });
    assert.equal(customer.source, "EVENT_PAGE");
    assert.equal(await db.venueMembership.count({ where: { customerId: customer.id, venueId: A.venue.id } }), 1);

    const consents = await db.contactConsent.findMany({ where: { customerId: customer.id } });
    assert.equal(consents.length, 1, "yalnızca işaretlenen kanal kaydedilir");
    assert.equal(consents[0].channel, "EMAIL");
    assert.equal(consents[0].source, "PUBLIC_SIGNUP");
    assert.equal(consents[0].consentTextVersion, VENUE_SIGNUP_CONSENT_VERSION);
  });

  test("izin işaretlenmezse hiç izin kaydı açılmaz", async () => {
    const result = await venueSignup(A.venue.slug, { firstName: "Mert", lastName: "Su", phone: "0532 600 00 03" }, IP);
    assert.equal(result.status, "created");
    const customer = await db.customer.findFirstOrThrow({ where: { phone: "+905326000003" } });
    assert.equal(await db.contactConsent.count({ where: { customerId: customer.id } }), 0);
  });

  test("zaten kayıtlı bilgi mevcut kaydı değiştirmez", async () => {
    await createCustomer(A.owner, { firstName: "Var", lastName: "Olan", phone: "0532 600 00 10", notes: "personel notu" });
    const result = await venueSignup(A.venue.slug, { firstName: "Başka", lastName: "Kişi", phone: "0532 600 00 10" }, IP);
    assert.deepEqual(result, { status: "existing" });
    const customer = await db.customer.findFirstOrThrow({ where: { phone: "+905326000010" } });
    assert.equal(customer.firstName, "Var", "herkese açık form mevcut kaydı güncelleyemez");
    assert.equal(customer.notes, "personel notu");
  });

  test("etkinliğe kaydolan kişiye giriş QR'ı verilir", async () => {
    const result = await venueSignup(
      A.venue.slug,
      { firstName: "Kayıt", lastName: "Olan", phone: "0532 600 00 20", eventId, partySize: "2" },
      IP,
    );
    assert.equal(result.status, "created");
    assert.ok(result.status === "created" && result.passToken, "QR verilir");
    assert.equal(result.status === "created" ? result.eventName : null, "Açılış Gecesi");

    const customer = await db.customer.findFirstOrThrow({ where: { phone: "+905326000020" } });
    const registration = await db.eventRegistration.findFirstOrThrow({ where: { customerId: customer.id, eventId } });
    assert.equal(registration.partySize, 2);
    assert.equal(registration.channel, "PUBLIC_PAGE");
    assert.equal(registration.completionStatus, "SELF_COMPLETED");
    assert.equal(await db.contactConsent.count({ where: { customerId: customer.id } }), 0, "etkinlik kaydı izin vermez");
  });

  test("kapasite aşılamaz", async () => {
    // Etkinlik kapasitesi 6; 2 kişi kayıtlı. 5 kişilik istek reddedilir.
    await assert.rejects(
      venueSignup(A.venue.slug, { firstName: "Kalabalık", lastName: "Grup", phone: "0532 600 00 21", eventId, partySize: "5" }, IP),
      ValidationError,
    );
  });

  test("yayında olmayan etkinliğe kaydolunamaz", async () => {
    const draft = await createEvent(A.owner, eventInput(A.venue.id, { name: "Gizli", status: "DRAFT" }));
    await assert.rejects(
      venueSignup(A.venue.slug, { firstName: "Meraklı", lastName: "Kişi", phone: "0532 600 00 22", eventId: draft.id }, IP),
      ValidationError,
    );
  });

  test("bilinmeyen mekana kayıt olunamaz", async () => {
    await assert.rejects(venueSignup("olmayan-mekan", { firstName: "A", lastName: "B", phone: "0532 600 00 30" }, IP), NotFoundError);
  });

  test("çok sayıda deneme sınırlanır", async () => {
    for (let i = 0; i < 5; i += 1) {
      await venueSignup(A.venue.slug, { firstName: "Sınır", lastName: `Test${i}`, phone: `0532 601 00 0${i}` }, { ip: "7.7.7.7" }).catch(() => undefined);
    }
    await assert.rejects(
      venueSignup(A.venue.slug, { firstName: "Sınır", lastName: "Son", phone: "0532 601 00 09" }, { ip: "7.7.7.7" }),
      ConflictError,
    );
  });
});
