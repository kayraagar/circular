/**
 * Demo verisi — iki ayrı işletme (tenant). Tüm kişi, mekan ve işletme adları kurgusaldır.
 * E-postalar ayrılmış example.com / .example alan adlarını kullanır.
 * Telefonlar +90 555 000 xx xx deseninde yer tutucudur; hiçbir mesaj gönderilmez.
 *
 * Çalıştırma: npm run db:seed  (mevcut tüm verileri SİLER)
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { derivePassToken, hashPassToken } from "../src/modules/passes/token";
import { foldText } from "../src/lib/normalize";
import { localDayKey, parseLocalDateTime } from "../src/lib/datetime";
import { CUSTOMER_SOURCE_LABELS, type CustomerSource, type Role } from "../src/lib/domain";

const db = new PrismaClient();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const now = Date.now();

// Deterministik rastgelelik: her seed aynı demo verisini üretir
let seed = 20260915;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const chance = (p: number) => rand() < p;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function weighted<T extends string>(weights: [T, number][]): T {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of weights) if ((r -= w) <= 0) return v;
  return weights[weights.length - 1][0];
}
/** Bugünden `days` gün sonra, İstanbul saatiyle "HH:mm" */
function at(days: number, hm: string) {
  return parseLocalDateTime(`${localDayKey(new Date(now + days * DAY))}T${hm}`)!;
}
const between = (a: number, b: number) => new Date(a + rand() * Math.max(0, b - a));

const FIRST = ["Ayşe", "Mehmet", "Zeynep", "Can", "Elif", "Emre", "Selin", "Burak", "Deniz", "Ece", "Kaan", "İpek", "Oğuz", "Şule", "Cem", "Melis", "Arda", "Irmak", "Tolga", "Defne", "Barış", "Naz", "Onur", "Yağmur", "Kerem", "Nil", "Umut", "Buse", "Efe", "Gizem", "Mert", "Asya", "Serkan", "Ceren", "Alp", "Duru", "Berk", "Pelin", "Sinan", "Ezgi"];
const LAST = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Aydın", "Öztürk", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Özdemir", "Polat", "Erdem", "Güneş", "Aksoy", "Tekin", "Uçar", "Başaran", "Işık"];
const NOTES = ["Balkon tarafındaki masayı tercih ediyor.", "Glütensiz seçenek soruyor.", "Kurumsal etkinlik organizasyonu yapıyor.", "Genelde arkadaş grubuyla geliyor.", "Doğum gününü mekanda kutlamak istiyor.", "Canlı müzik gecelerini takip ediyor."];

type Actor = { id: string; name: string };

async function wipe() {
  await db.$transaction([
    db.activityLog.deleteMany(),
    db.perkRedemption.deleteMany(),
    db.checkIn.deleteMany(),
    db.pass.deleteMany(),
    db.perk.deleteMany(),
    db.eventPrAssignment.deleteMany(),
    db.eventRegistration.deleteMany(),
    db.event.deleteMany(),
    db.contactConsent.deleteMany(),
    db.venueMembership.deleteMany(),
    db.customerTag.deleteMany(),
    db.tag.deleteMany(),
    db.customer.deleteMany(),
    db.membershipVenue.deleteMany(),
    db.membership.deleteMany(),
    db.venue.deleteMany(),
    db.session.deleteMany(),
    db.user.deleteMany(),
    db.tenant.deleteMany(),
  ]);
}

async function log(
  tenantId: string,
  actor: Actor,
  action: string,
  entity: { type: string; id: string },
  createdAt: Date,
  extra: { customerId?: string; eventId?: string; metadata?: Record<string, unknown> } = {},
) {
  await db.activityLog.create({
    data: {
      tenantId,
      actorUserId: actor.id,
      action,
      entityType: entity.type,
      entityId: entity.id,
      customerId: extra.customerId,
      eventId: extra.eventId,
      metadata: extra.metadata ? JSON.stringify(extra.metadata) : null,
      createdAt,
    },
  });
}

type PerkDef = {
  name: string;
  /** venueByKey anahtarı; verilmezse tüm mekanlarda geçerli */
  venue?: string;
  description?: string;
  terms?: string;
  /** kişi başı kullanım hakkı */
  limit: number;
  validDays?: number;
  /** kaç demo müşteriye QR verilsin */
  issueTo: number;
};

type EventDef = {
  name: string;
  venue: string;
  day: number;
  start: string;
  hours: number;
  capacity: number | null;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  target: number;
  description: string;
};

async function seedTenant(opts: {
  tenant: { name: string; slug: string };
  venues: { key: string; name: string; slug: string; type: string; city: string; address: string }[];
  actors: Actor[];
  customerCount: number;
  phoneOffset: number;
  tags: string[];
  events: EventDef[];
  perks?: PerkDef[];
  /** Kapıda girişleri onaylayan personel (check-in kayıtlarının sahibi) */
  doorActor?: Actor;
  /** Avantaj kullanımını onaylayan personel */
  waiterActor?: Actor;
  /** Geçmiş etkinliklerde giriş yapan guest oranı */
  checkInRate?: number;
  sharedCustomer?: { firstName: string; lastName: string; phone: string };
}) {
  const tenant = await db.tenant.create({ data: opts.tenant });
  const venueByKey = new Map<string, { id: string; name: string }>();
  for (const v of opts.venues) {
    const created = await db.venue.create({
      data: { tenantId: tenant.id, name: v.name, slug: v.slug, type: v.type, city: v.city, address: v.address },
    });
    venueByKey.set(v.key, created);
  }

  // Etkinlikler
  const events: { id: string; name: string; venueId: string; startsAt: Date; endsAt: Date; createdAt: Date; capacity: number | null; status: string; target: number; people: number }[] = [];
  for (const def of opts.events) {
    const venue = venueByKey.get(def.venue)!;
    const startsAt = at(def.day, def.start);
    const endsAt = new Date(startsAt.getTime() + def.hours * HOUR);
    const createdAt = new Date(Math.min(now - 2 * HOUR, startsAt.getTime() - int(18, 30) * DAY));
    const actor = opts.actors[0];
    const cancelledAt = def.status === "CANCELLED" ? new Date(Math.min(now - HOUR, createdAt.getTime() + 6 * DAY)) : null;
    const ev = await db.event.create({
      data: {
        tenantId: tenant.id,
        venueId: venue.id,
        name: def.name,
        description: def.description,
        startsAt,
        endsAt,
        capacity: def.capacity,
        status: def.status,
        registrationOpensAt: def.status === "DRAFT" ? null : new Date(createdAt.getTime() + DAY),
        registrationClosesAt: def.status === "DRAFT" ? null : new Date(startsAt.getTime() - 2 * HOUR),
        publishedAt: def.status === "DRAFT" ? null : new Date(createdAt.getTime() + HOUR),
        cancelledAt,
        createdByUserId: actor.id,
        createdAt,
      },
    });
    await log(tenant.id, actor, "event.created", { type: "event", id: ev.id }, createdAt, { eventId: ev.id, metadata: { eventName: ev.name } });
    if (def.status !== "DRAFT") {
      await log(tenant.id, actor, "event.published", { type: "event", id: ev.id }, new Date(createdAt.getTime() + HOUR), { eventId: ev.id, metadata: { eventName: ev.name } });
    }
    events.push({ ...ev, target: def.target, people: 0 });
  }

  // Etiketler
  const tagIds = new Map<string, string>();
  for (const name of opts.tags) {
    const t = await db.tag.create({ data: { tenantId: tenant.id, name, nameKey: foldText(name) } });
    tagIds.set(name, t.id);
  }

  // Müşteriler
  const pairs = shuffle(FIRST.flatMap((f) => LAST.map((l) => [f, l] as const))).slice(0, opts.customerCount);
  const customers: { id: string; name: string; createdAt: Date }[] = [];
  const openEvents = events.filter((e) => e.createdAt.getTime() < now);

  async function register(customer: { id: string; name: string; createdAt: Date }, ev: (typeof events)[number], actor: Actor, when?: Date) {
    const partySize = Number(weighted([["1", 55], ["2", 25], ["3", 10], ["4", 10]]));
    if (ev.capacity !== null && ev.people + partySize > ev.capacity) return false;
    const createdAt =
      when ?? between(Math.max(ev.createdAt.getTime(), customer.createdAt.getTime()), Math.min(now - 10 * 60_000, ev.startsAt.getTime()));
    const reg = await db.eventRegistration.create({
      data: {
        tenantId: tenant.id,
        eventId: ev.id,
        customerId: customer.id,
        partySize,
        channel: "STAFF",
        completionStatus: "STAFF_ENTERED",
        accessStatus: "ACTIVE",
        addedByUserId: actor.id,
        note: chance(0.12) ? pick(["Doğum günü", "Masa isteği var", "Geç gelecek"]) : null,
        createdAt,
      },
    });
    ev.people += partySize;
    await log(tenant.id, actor, "registration.added", { type: "registration", id: reg.id }, createdAt, {
      customerId: customer.id,
      eventId: ev.id,
      metadata: { customerName: customer.name, eventName: ev.name, partySize },
    });
    return true;
  }

  for (let i = 0; i < pairs.length; i++) {
    let [firstName, lastName] = pairs[i];
    let phone: string | null = `+90555000${String(opts.phoneOffset + i).padStart(4, "0")}`;
    if (i === 0 && opts.sharedCustomer) {
      ({ firstName, lastName, phone } = opts.sharedCustomer);
    }
    const source: CustomerSource = weighted([["MANUAL", 30], ["WALK_IN", 20], ["IMPORT", 12], ["STAFF_GUEST", 38]]);
    const guestEvent = source === "STAFF_GUEST" && openEvents.length ? pick(openEvents) : null;
    const createdAt = guestEvent
      ? between(guestEvent.createdAt.getTime(), Math.min(now - 30 * 60_000, guestEvent.startsAt.getTime()))
      : source === "IMPORT"
        ? new Date(now - 140 * DAY + int(0, 48) * HOUR)
        : new Date(now - Math.floor(Math.pow(rand(), 1.8) * 120 * DAY) - int(1, 20) * HOUR);
    const email = chance(0.72) ? `${foldText(firstName)}.${foldText(lastName)}${i + 1}@example.com`.replace(/\s/g, "") : null;
    if (!email && !phone) phone = `+90555000${String(opts.phoneOffset + i).padStart(4, "0")}`;
    const actor = pick(opts.actors);
    const name = `${firstName} ${lastName}`;

    const c = await db.customer.create({
      data: {
        tenantId: tenant.id,
        firstName,
        lastName,
        searchName: foldText(name),
        phone,
        email,
        birthDate: chance(0.4) ? `${int(1978, 2004)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}` : null,
        notes: chance(0.2) ? pick(NOTES) : null,
        source,
        sourceVenueId: guestEvent?.venueId ?? null,
        createdByUserId: actor.id,
        createdAt,
      },
    });
    const customer = { id: c.id, name, createdAt };
    customers.push(customer);
    await log(tenant.id, actor, "customer.created", { type: "customer", id: c.id }, createdAt, {
      customerId: c.id,
      eventId: guestEvent?.id,
      metadata: { customerName: name, sourceLabel: guestEvent ? `Guest listesi: ${guestEvent.name}` : CUSTOMER_SOURCE_LABELS[source] },
    });

    // Etiketler
    const tagCount = weighted([["0", 40], ["1", 40], ["2", 20]]);
    for (const tag of shuffle(opts.tags).slice(0, Number(tagCount))) {
      await db.customerTag.create({ data: { tenantId: tenant.id, customerId: c.id, tagId: tagIds.get(tag)! } });
    }

    // İletişim izinleri — guest listesi kaynağı otomatik izin almaz; burada ayrıca kaydedilmiş gibi modellenir
    const channels: ("WHATSAPP" | "SMS" | "EMAIL")[] = [];
    if (phone && chance(0.42)) channels.push("WHATSAPP");
    if (phone && chance(0.22)) channels.push("SMS");
    if (email && chance(0.33)) channels.push("EMAIL");
    for (const channel of channels) {
      const grantedAt = new Date(Math.min(now - 5 * 60_000, createdAt.getTime() + int(1, 72) * HOUR));
      const revoked = chance(0.1);
      const revokedAt = revoked ? new Date(Math.min(now - 60_000, grantedAt.getTime() + int(2, 30) * DAY)) : null;
      const consent = await db.contactConsent.create({
        data: {
          tenantId: tenant.id,
          customerId: c.id,
          channel,
          status: revoked ? "REVOKED" : "GRANTED",
          source: "STAFF_RECORDED",
          note: "Demo: kasa kayıt formu",
          recordedByUserId: actor.id,
          grantedAt,
          revokedAt,
        },
      });
      await log(tenant.id, actor, "consent.granted", { type: "consent", id: consent.id }, grantedAt, {
        customerId: c.id,
        metadata: { customerName: name, channel, note: "Demo: kasa kayıt formu" },
      });
      if (revokedAt) {
        await log(tenant.id, actor, "consent.revoked", { type: "consent", id: consent.id }, revokedAt, {
          customerId: c.id,
          metadata: { customerName: name, channel },
        });
      }
    }

    if (guestEvent) await register(customer, guestEvent, actor, createdAt);
  }

  // Ek guest kayıtları (mevcut müşteriler)
  for (const ev of events) {
    const registered = new Set((await db.eventRegistration.findMany({ where: { eventId: ev.id }, select: { customerId: true } })).map((r) => r.customerId));
    for (const c of shuffle(customers)) {
      const count = registered.size;
      if (count >= ev.target) break;
      if (registered.has(c.id) || c.createdAt.getTime() > Math.min(now, ev.startsAt.getTime())) continue;
      if (await register(c, ev, pick(opts.actors))) registered.add(c.id);
    }
  }

  // İptaller: bazı guest kayıtları ve iptal edilen etkinliğin tüm kayıtları
  for (const ev of events) {
    const regs = await db.eventRegistration.findMany({ where: { eventId: ev.id }, include: { customer: true } });
    for (const r of regs) {
      const cancelWhole = ev.status === "CANCELLED";
      if (!cancelWhole && !chance(0.07)) continue;
      const cancelledAt = new Date(Math.min(now - 60_000, r.createdAt.getTime() + int(2, 48) * HOUR));
      await db.eventRegistration.update({ where: { id: r.id }, data: { accessStatus: "CANCELLED", cancelledAt } });
      if (!cancelWhole) {
        await log(tenant.id, opts.actors[0], "registration.cancelled", { type: "registration", id: r.id }, cancelledAt, {
          customerId: r.customerId,
          eventId: ev.id,
          metadata: { customerName: `${r.customer.firstName} ${r.customer.lastName}`, eventName: ev.name },
        });
      }
    }
    if (ev.status === "CANCELLED") {
      const e = await db.event.findUniqueOrThrow({ where: { id: ev.id } });
      await log(tenant.id, opts.actors[0], "event.cancelled", { type: "event", id: ev.id }, e.cancelledAt ?? new Date(now - HOUR), {
        eventId: ev.id,
        metadata: { eventName: ev.name, cancelledRegistrations: regs.length },
      });
    }
  }

  // Giriş QR'ları ve gerçek girişler.
  // Geçmiş etkinliklerde bir kısmı kullanılmış (check-in), bir kısmı kullanılmamış (gelmedi);
  // yaklaşan etkinlikte kullanılmamış QR'lar demo için hazır bekler.
  const doorActor = opts.doorActor ?? opts.actors[0];
  for (const ev of events) {
    if (ev.status === "CANCELLED") continue;
    const past = ev.endsAt.getTime() < now;
    const regs = await db.eventRegistration.findMany({ where: { eventId: ev.id, accessStatus: "ACTIVE" }, include: { customer: true } });
    for (const r of regs) {
      if (!chance(past ? 0.85 : 0.6)) continue;
      const passId = randomUUID();
      const used = past && chance(opts.checkInRate ?? 0.7);
      const checkedInAt = used ? between(ev.startsAt.getTime(), Math.min(now - 60_000, ev.endsAt.getTime())) : null;
      await db.pass.create({
        data: {
          id: passId,
          tenantId: tenant.id,
          purpose: "EVENT_ENTRY",
          tokenHash: hashPassToken(derivePassToken(passId)),
          customerId: r.customerId,
          registrationId: r.id,
          maxUses: 1,
          useCount: used ? 1 : 0,
          lastUsedAt: checkedInAt,
          issuedByUserId: opts.actors[0].id,
          createdAt: new Date(Math.min(r.createdAt.getTime() + HOUR, now - 60_000)),
        },
      });
      if (!checkedInAt) continue;
      const method = chance(0.2) ? "MANUAL" : "QR";
      const admittedCount = r.partySize > 1 && chance(0.25) ? r.partySize - 1 : r.partySize;
      const customerName = `${r.customer.firstName} ${r.customer.lastName}`;
      const checkIn = await db.checkIn.create({
        data: {
          tenantId: tenant.id,
          eventId: ev.id,
          registrationId: r.id,
          customerId: r.customerId,
          admittedCount,
          method,
          passId,
          checkedInByUserId: doorActor.id,
          checkedInAt,
        },
      });
      await log(tenant.id, doorActor, "checkin.recorded", { type: "checkin", id: checkIn.id }, checkedInAt, {
        customerId: r.customerId,
        eventId: ev.id,
        metadata: { customerName, eventName: ev.name, admittedCount, method },
      });
    }
  }

  // Avantajlar, avantaj QR'ları ve kullanımlar
  const waiterActor = opts.waiterActor ?? opts.actors[0];
  for (const def of opts.perks ?? []) {
    const createdAt = new Date(now - int(15, 45) * DAY);
    const perk = await db.perk.create({
      data: {
        tenantId: tenant.id,
        venueId: def.venue ? (venueByKey.get(def.venue)?.id ?? null) : null,
        name: def.name,
        description: def.description ?? null,
        terms: def.terms ?? null,
        perCustomerLimit: def.limit,
        validUntil: def.validDays ? new Date(now + def.validDays * DAY) : null,
        createdByUserId: opts.actors[0].id,
        createdAt,
      },
    });
    await log(tenant.id, opts.actors[0], "perk.created", { type: "perk", id: perk.id }, createdAt, {
      metadata: { perkName: perk.name, limit: perk.perCustomerLimit },
    });

    for (const c of shuffle(customers).slice(0, def.issueTo)) {
      const issuedAt = between(Math.max(createdAt.getTime(), c.createdAt.getTime()), now - 2 * HOUR);
      const redeemed = chance(0.5);
      const redeemedAt = redeemed ? between(issuedAt.getTime(), now - HOUR) : null;
      const passId = randomUUID();
      await db.pass.create({
        data: {
          id: passId,
          tenantId: tenant.id,
          purpose: "PERK_REDEMPTION",
          tokenHash: hashPassToken(derivePassToken(passId)),
          customerId: c.id,
          perkId: perk.id,
          maxUses: def.limit,
          useCount: redeemed ? 1 : 0,
          lastUsedAt: redeemedAt,
          issuedByUserId: opts.actors[0].id,
          createdAt: issuedAt,
        },
      });
      if (!redeemedAt) continue;
      const redemption = await db.perkRedemption.create({
        data: {
          tenantId: tenant.id,
          perkId: perk.id,
          passId,
          customerId: c.id,
          redeemedByUserId: waiterActor.id,
          redeemedAt,
        },
      });
      await log(tenant.id, waiterActor, "perk.redeemed", { type: "redemption", id: redemption.id }, redeemedAt, {
        customerId: c.id,
        metadata: { customerName: c.name, perkName: perk.name },
      });
    }
  }

  return { tenant, venueByKey, customers: customers.length, events: events.length };
}

async function user(email: string, name: string, passwordHash: string, isPlatformAdmin = false) {
  return db.user.create({ data: { email, name, passwordHash, isPlatformAdmin } });
}

async function member(userId: string, tenantId: string, role: Role, venueIds: string[] = []) {
  const m = await db.membership.create({ data: { userId, tenantId, role } });
  for (const venueId of venueIds) await db.membershipVenue.create({ data: { membershipId: m.id, venueId, tenantId } });
  return m;
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Demo seed production ortamında çalıştırılamaz.");
  }
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("SEED_DEMO_PASSWORD en az 8 karakter olmalı (.env dosyasını kontrol edin).");
  }

  await wipe();
  const hash = await hashPassword(password);

  const deniz = await user("sahip@orbita.example", "Deniz Aksoy", hash);
  const ece = await user("crm@orbita.example", "Ece Karaca", hash);
  const mert = await user("pr@orbita.example", "Mert Tan", hash);
  const burak = await user("kapi@orbita.example", "Burak Ilgaz", hash);
  const sena = await user("garson@orbita.example", "Sena Uysal", hash);
  const selin = await user("sahip@lumen.example", "Selin Aydın", hash);
  const kaan = await user("danisman@circular.example", "Kaan Ersoy", hash);
  await user("platform@circular.example", "Platform Yöneticisi", hash, true);

  const orbita = await seedTenant({
    tenant: { name: "Orbita Hospitality", slug: "orbita" },
    venues: [
      { key: "club", name: "Orbita Kulüp", slug: "orbita-kulup", type: "NIGHTCLUB", city: "İstanbul", address: "Beyoğlu (kurgusal adres)" },
      { key: "garden", name: "Orbita Bahçe", slug: "orbita-bahce", type: "RESTAURANT", city: "İstanbul", address: "Kadıköy (kurgusal adres)" },
    ],
    actors: [
      { id: deniz.id, name: deniz.name },
      { id: ece.id, name: ece.name },
    ],
    customerCount: 58,
    phoneOffset: 1,
    tags: ["VIP", "Doğum günü", "Kurumsal", "Techno", "Caz", "Sık gelen"],
    doorActor: { id: burak.id, name: burak.name },
    waiterActor: { id: sena.id, name: sena.name },
    checkInRate: 0.72,
    perks: [
      {
        name: "Hoş geldin kokteyli",
        venue: "club",
        description: "İlk gelişinize özel ikram kokteyli.",
        terms: "Gece 01:00'e kadar, kişi başı bir kez.",
        limit: 1,
        validDays: 60,
        issueTo: 10,
      },
      {
        name: "Doğum günü tatlısı",
        venue: "garden",
        description: "Doğum günü haftanızda tatlı ikramı.",
        terms: "Doğum gününden itibaren 7 gün içinde geçerlidir.",
        limit: 1,
        validDays: 120,
        issueTo: 6,
      },
      {
        name: "Sık gelen: 5. içecek bizden",
        description: "Her iki mekanda da geçerli.",
        terms: "Aynı gün içinde bir kez kullanılabilir.",
        limit: 3,
        issueTo: 8,
      },
    ],
    events: [
      { name: "Deep House Cuma", venue: "club", day: -12, start: "23:00", hours: 5, capacity: 250, status: "PUBLISHED", target: 22, description: "Konuk DJ performansıyla uzun set." },
      { name: "Caz ve Şarap Akşamı", venue: "garden", day: -5, start: "20:00", hours: 3.5, capacity: 60, status: "PUBLISHED", target: 14, description: "Canlı trio eşliğinde seçili şarap eşleşmeleri." },
      { name: "Sezon Açılış Partisi", venue: "club", day: 2, start: "23:00", hours: 6, capacity: 300, status: "PUBLISHED", target: 26, description: "Yeni sezonun ilk gecesi. Guest listesi 01:00'e kadar geçerli." },
      { name: "Şef Masası: Ege Mutfağı", venue: "garden", day: 6, start: "19:30", hours: 3, capacity: 24, status: "PUBLISHED", target: 14, description: "Tek masa, sınırlı kontenjan, sabit menü." },
      { name: "Açık Hava Sinema", venue: "garden", day: 9, start: "21:00", hours: 2.5, capacity: 80, status: "CANCELLED", target: 6, description: "Hava durumu nedeniyle iptal edildi." },
      { name: "Techno Gecesi: Orbit 02", venue: "club", day: 13, start: "23:30", hours: 5.5, capacity: 200, status: "DRAFT", target: 3, description: "Line-up netleşince yayına alınacak." },
    ],
  });

  const lumen = await seedTenant({
    tenant: { name: "Lumen Kafe", slug: "lumen" },
    venues: [{ key: "moda", name: "Lumen Kafe Moda", slug: "lumen-moda", type: "CAFE", city: "İstanbul", address: "Moda (kurgusal adres)" }],
    actors: [{ id: selin.id, name: selin.name }],
    customerCount: 24,
    phoneOffset: 501,
    tags: ["Kahve kulübü", "Atölye", "Hafta sonu"],
    checkInRate: 0.8,
    perks: [
      {
        name: "Kahve kulübü: 5. kahve bizden",
        description: "Kahve kulübü üyelerine.",
        terms: "Filtre ve espresso bazlı içeceklerde geçerli.",
        limit: 3,
        issueTo: 8,
      },
      {
        name: "Atölye indirimi",
        venue: "moda",
        description: "İkinci atölye katılımında indirim.",
        terms: "Aynı ay içinde geçerlidir.",
        limit: 1,
        validDays: 45,
        issueTo: 4,
      },
    ],
    // Aynı kişi iki işletmede de kayıtlı — veriler otomatik birleştirilmez
    sharedCustomer: { firstName: "Zeynep", lastName: "Arslan", phone: "+905550000900" },
    events: [
      { name: "Latte Art Atölyesi", venue: "moda", day: -8, start: "11:00", hours: 2, capacity: 16, status: "PUBLISHED", target: 8, description: "Başlangıç seviyesi, malzemeler dahil." },
      { name: "Akustik Pazar", venue: "moda", day: 4, start: "16:00", hours: 2.5, capacity: 40, status: "PUBLISHED", target: 9, description: "Bahçede akustik set." },
      { name: "Kitap Kulübü: Eylül", venue: "moda", day: 11, start: "19:00", hours: 2, capacity: 20, status: "DRAFT", target: 4, description: "Ayın kitabı toplantısı." },
    ],
  });

  // Orbita'da da aynı kişi (farklı tenant, ayrı kayıt)
  await db.customer.create({
    data: {
      tenantId: orbita.tenant.id,
      firstName: "Zeynep",
      lastName: "Arslan",
      searchName: foldText("Zeynep Arslan"),
      phone: "+905550000900",
      email: null,
      source: "WALK_IN",
      createdByUserId: deniz.id,
      createdAt: new Date(now - 20 * DAY),
    },
  });

  const club = orbita.venueByKey.get("club")!.id;
  const garden = orbita.venueByKey.get("garden")!.id;
  await member(deniz.id, orbita.tenant.id, "OWNER_ADMIN");
  await member(ece.id, orbita.tenant.id, "CRM_MANAGER");
  await member(mert.id, orbita.tenant.id, "PR");
  await member(burak.id, orbita.tenant.id, "DOOR", [club]);
  await member(sena.id, orbita.tenant.id, "WAITER", [garden]);
  await member(selin.id, lumen.tenant.id, "OWNER_ADMIN");
  await member(kaan.id, orbita.tenant.id, "CRM_MANAGER");
  await member(kaan.id, lumen.tenant.id, "OWNER_ADMIN");

  const [passes, checkIns, redemptions, perks] = await Promise.all([
    db.pass.count(),
    db.checkIn.count(),
    db.perkRedemption.count(),
    db.perk.count(),
  ]);
  console.log(`✔ Orbita Hospitality: ${orbita.customers + 1} müşteri, ${orbita.events} etkinlik`);
  console.log(`✔ Lumen Kafe: ${lumen.customers} müşteri, ${lumen.events} etkinlik`);
  console.log(`✔ ${perks} avantaj · ${passes} QR · ${checkIns} gerçek giriş · ${redemptions} avantaj kullanımı`);
  console.log("✔ Kullanıcılar: sahip@orbita.example, crm@orbita.example, pr@orbita.example, kapi@orbita.example,");
  console.log("  garson@orbita.example, sahip@lumen.example, danisman@circular.example, platform@circular.example");
  console.log("  Şifre: SEED_DEMO_PASSWORD");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
