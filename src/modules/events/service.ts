import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db, isUniqueViolation } from "@/lib/db";
import { assertCan, canAccessVenue, venueScope, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText, foldText, fullName } from "@/lib/normalize";
import { parseLocalDateTime } from "@/lib/datetime";
import { MAX_PARTY_SIZE, isOneOf, type EventStatus } from "@/lib/domain";
import { logActivity } from "@/modules/activity/service";
import { customerSearchWhere, findContactConflict, parseContactFields } from "@/modules/customers/service";
import { ENTRY_LATE_HOURS } from "@/modules/passes/rules";

// ─────────────────────────────────────────────── Etkinlik doğrulama

const MAX_DURATION_MS = 7 * 24 * 3600 * 1000;

const eventSchema = z.object({
  name: z.string().trim().min(2, "Etkinlik adı en az 2 karakter olmalı.").max(120, "Etkinlik adı en fazla 120 karakter."),
  venueId: z.string().trim().min(1, "Mekan seçin."),
  description: z.string().trim().max(2000, "Açıklama en fazla 2000 karakter olabilir.").default(""),
  startsAt: z.string().default(""),
  endsAt: z.string().default(""),
  capacity: z.string().trim().default(""),
  registrationOpensAt: z.string().default(""),
  registrationClosesAt: z.string().default(""),
  entryClosesAt: z.string().default(""),
  status: z.string().default("DRAFT"),
});

type EventData = {
  name: string;
  venueId: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  entryClosesAt: Date | null;
  status: EventStatus;
};

async function parseEvent(ctx: ServiceContext, raw: unknown, mode: "create" | "update"): Promise<EventData> {
  const errors: FieldErrors = {};
  const add = (k: string, m: string) => (errors[k] = [...(errors[k] ?? []), m]);
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;

  const venue = await db.venue.findFirst({ where: { id: v.venueId, tenantId: ctx.tenantId, isActive: true } });
  if (!venue || !canAccessVenue(ctx, venue.id)) add("venueId", "Geçerli bir mekan seçin.");

  const required = (key: "startsAt" | "endsAt") => {
    if (!v[key]) {
      add(key, "Tarih ve saat zorunludur.");
      return null;
    }
    const d = parseLocalDateTime(v[key]);
    if (!d) add(key, "Geçerli bir tarih ve saat girin.");
    return d;
  };
  const optional = (key: "registrationOpensAt" | "registrationClosesAt" | "entryClosesAt") => {
    if (!v[key]) return null;
    const d = parseLocalDateTime(v[key]);
    if (!d) add(key, "Geçerli bir tarih ve saat girin.");
    return d;
  };

  const startsAt = required("startsAt");
  const endsAt = required("endsAt");
  const registrationOpensAt = optional("registrationOpensAt");
  const registrationClosesAt = optional("registrationClosesAt");
  const entryClosesAt = optional("entryClosesAt");

  if (startsAt && endsAt) {
    if (endsAt <= startsAt) add("endsAt", "Bitiş, başlangıçtan sonra olmalı.");
    else if (endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS) add("endsAt", "Etkinlik en fazla 7 gün sürebilir.");
    if (mode === "create" && endsAt.getTime() < Date.now()) add("endsAt", "Sona ermiş bir etkinlik oluşturulamaz.");
    if (entryClosesAt && (entryClosesAt < startsAt || entryClosesAt.getTime() > endsAt.getTime() + ENTRY_LATE_HOURS * 3600 * 1000)) {
      add("entryClosesAt", `Giriş kapanışı, başlangıç ile bitişten en fazla ${ENTRY_LATE_HOURS} saat sonrası arasında olmalı.`);
    }
    if (registrationClosesAt && registrationClosesAt > endsAt) {
      add("registrationClosesAt", "Kayıt kapanışı etkinlik bitişinden sonra olamaz.");
    }
  }
  if (registrationOpensAt && registrationClosesAt && registrationClosesAt <= registrationOpensAt) {
    add("registrationClosesAt", "Kayıt kapanışı, kayıt açılışından sonra olmalı.");
  }

  let capacity: number | null = null;
  if (v.capacity !== "") {
    const n = Number(v.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 100000) add("capacity", "Kapasite 1 ile 100.000 arasında tam sayı olmalı.");
    else capacity = n;
  }

  const status = v.status;
  if (mode === "create" && status !== "DRAFT" && status !== "PUBLISHED") add("status", "Geçerli bir yayın durumu seçin.");

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return {
    name: cleanText(v.name),
    venueId: v.venueId,
    description: v.description || null,
    startsAt: startsAt!,
    endsAt: endsAt!,
    capacity,
    registrationOpensAt,
    registrationClosesAt,
    entryClosesAt,
    status: status as EventStatus,
  };
}

async function findEvent(ctx: ServiceContext, id: string) {
  const event = await db.event.findFirst({
    where: { id, tenantId: ctx.tenantId, ...venueScope(ctx) },
    include: { venue: { select: { id: true, name: true, slug: true } } },
  });
  if (!event) throw new NotFoundError("Etkinlik bulunamadı.");
  return event;
}

async function headcount(eventId: string) {
  const agg = await db.eventRegistration.aggregate({
    where: { eventId, accessStatus: "ACTIVE" },
    _sum: { partySize: true },
    _count: { _all: true },
  });
  return { registrations: agg._count._all, people: agg._sum.partySize ?? 0 };
}

// ─────────────────────────────────────────────── Etkinlik CRUD

export async function createEvent(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx, "events.manage");
  const data = await parseEvent(ctx, raw, "create");
  return db.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        ...data,
        tenantId: ctx.tenantId,
        createdByUserId: ctx.userId,
        publishedAt: data.status === "PUBLISHED" ? new Date() : null,
      },
    });
    await logActivity(tx, ctx, {
      action: "event.created",
      entityType: "event",
      entityId: event.id,
      eventId: event.id,
      metadata: { eventName: event.name },
    });
    return event;
  });
}

export async function updateEvent(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx, "events.manage");
  const existing = await findEvent(ctx, id);
  if (existing.status === "CANCELLED") {
    throw new ConflictError("İptal edilmiş etkinlik düzenlenemez.", "EVENT_CANCELLED");
  }
  const data = await parseEvent(ctx, { ...(raw as object), status: existing.status }, "update");
  if (data.capacity !== null) {
    const { people } = await headcount(id);
    if (data.capacity < people) {
      throw new ValidationError({ capacity: [`Kapasite, mevcut ${people} kişilik guest listesinin altına düşürülemez.`] });
    }
  }
  const { status: _ignored, ...rest } = data;
  return db.$transaction(async (tx) => {
    const event = await tx.event.update({ where: { id: existing.id }, data: rest });
    await logActivity(tx, ctx, {
      action: "event.updated",
      entityType: "event",
      entityId: id,
      eventId: id,
      metadata: { eventName: event.name },
    });
    return event;
  });
}

export async function changeEventStatus(ctx: ServiceContext, id: string, op: string) {
  assertCan(ctx, "events.manage");
  const event = await findEvent(ctx, id);
  const transitions: Record<string, { from: EventStatus[]; to: EventStatus; action: "event.published" | "event.unpublished" | "event.cancelled" }> = {
    publish: { from: ["DRAFT"], to: "PUBLISHED", action: "event.published" },
    unpublish: { from: ["PUBLISHED"], to: "DRAFT", action: "event.unpublished" },
    cancel: { from: ["DRAFT", "PUBLISHED"], to: "CANCELLED", action: "event.cancelled" },
  };
  const t = transitions[op];
  if (!t) throw new ValidationError({ op: ["Geçersiz işlem."] });
  if (!t.from.includes(event.status as EventStatus)) {
    throw new ConflictError("Etkinliğin mevcut durumu bu işleme uygun değil.", "INVALID_TRANSITION");
  }
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.event.update({
      where: { id: event.id },
      data: {
        status: t.to,
        ...(t.to === "PUBLISHED" ? { publishedAt: now } : {}),
        ...(t.to === "CANCELLED" ? { cancelledAt: now } : {}),
      },
    });
    // İptal edilen etkinlikte giriş hakkı kalmaz; kayıtlar geçmiş için korunur.
    let cancelledRegistrations = 0;
    if (t.to === "CANCELLED") {
      const res = await tx.eventRegistration.updateMany({
        where: { eventId: event.id, tenantId: ctx.tenantId, accessStatus: "ACTIVE" },
        data: { accessStatus: "CANCELLED", cancelledAt: now },
      });
      cancelledRegistrations = res.count;
    }
    await logActivity(tx, ctx, {
      action: t.action,
      entityType: "event",
      entityId: id,
      eventId: id,
      metadata: { eventName: event.name, ...(t.to === "CANCELLED" ? { cancelledRegistrations } : {}) },
    });
    return updated;
  });
}

// ─────────────────────────────────────────────── Listeleme

export type EventScope = "upcoming" | "past" | "all";

export async function listEvents(ctx: ServiceContext, opts: { scope: EventScope; venueId?: string | null }) {
  assertCan(ctx, "events.view");
  const now = new Date();
  const where: Prisma.EventWhereInput = {
    tenantId: ctx.tenantId,
    ...venueScope(ctx),
    ...(opts.venueId && canAccessVenue(ctx, opts.venueId) ? { venueId: opts.venueId } : {}),
    ...(opts.scope === "upcoming" ? { endsAt: { gte: now } } : {}),
    ...(opts.scope === "past" ? { endsAt: { lt: now } } : {}),
  };
  const events = await db.event.findMany({
    where,
    include: { venue: { select: { id: true, name: true } } },
    orderBy: { startsAt: opts.scope === "upcoming" ? "asc" : "desc" },
    take: 200,
  });
  const stats = await registrationStats(ctx.tenantId, events.map((e) => e.id));
  return events.map((e) => ({ ...e, ...(stats.get(e.id) ?? { registrations: 0, people: 0 }) }));
}

export async function registrationStats(tenantId: string, eventIds: string[]) {
  const map = new Map<string, { registrations: number; people: number }>();
  if (eventIds.length === 0) return map;
  const groups = await db.eventRegistration.groupBy({
    by: ["eventId"],
    where: { tenantId, eventId: { in: eventIds }, accessStatus: "ACTIVE" },
    _count: { _all: true },
    _sum: { partySize: true },
  });
  for (const g of groups) map.set(g.eventId, { registrations: g._count._all, people: g._sum.partySize ?? 0 });
  return map;
}

export async function getEventForEdit(ctx: ServiceContext, id: string) {
  assertCan(ctx, "events.manage");
  return findEvent(ctx, id);
}

export async function getEventDetail(ctx: ServiceContext, id: string, opts: { q?: string } = {}) {
  assertCan(ctx, "events.view");
  const event = await findEvent(ctx, id);
  const q = cleanText(opts.q);
  const registrations = await db.eventRegistration.findMany({
    where: { tenantId: ctx.tenantId, eventId: event.id, ...(q ? { customer: customerSearchWhere(q) } : {}) },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, archivedAt: true } },
      _count: { select: { checkIns: true } },
    },
    orderBy: [{ accessStatus: "asc" }, { createdAt: "desc" }],
  });
  const addedByIds = [...new Set(registrations.map((r) => r.addedByUserId).filter((x): x is string => !!x))];
  const users = addedByIds.length
    ? await db.user.findMany({ where: { id: { in: addedByIds } }, select: { id: true, name: true } })
    : [];
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const totals = await db.eventRegistration.groupBy({
    by: ["accessStatus"],
    where: { tenantId: ctx.tenantId, eventId: event.id },
    _count: { _all: true },
    _sum: { partySize: true },
  });
  const active = totals.find((t) => t.accessStatus === "ACTIVE");
  const cancelled = totals.find((t) => t.accessStatus === "CANCELLED");
  return {
    event,
    stats: {
      registrations: active?._count._all ?? 0,
      people: active?._sum.partySize ?? 0,
      cancelled: cancelled?._count._all ?? 0,
    },
    registrations: registrations.map((r) => ({
      ...r,
      customerName: fullName(r.customer),
      addedByName: r.addedByUserId ? (userNames.get(r.addedByUserId) ?? null) : null,
      checkInCount: r._count.checkIns,
    })),
    filtered: q.length > 0,
  };
}

// ─────────────────────────────────────────────── Guest işlemleri

const guestExtrasSchema = z.object({
  partySize: z.coerce
    .number({ error: "Kişi sayısı girin." })
    .int("Kişi sayısı tam sayı olmalı.")
    .min(1, "Kişi sayısı en az 1 olmalı.")
    .max(MAX_PARTY_SIZE, `Kişi sayısı en fazla ${MAX_PARTY_SIZE} olabilir.`),
  note: z.string().trim().max(300, "Not en fazla 300 karakter olabilir.").default(""),
});

function parseGuestExtras(raw: unknown) {
  const parsed = guestExtrasSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  return parsed.data;
}

/** Guest değişikliğine açık etkinliği getirir (tenant + mekan kapsamı + durum). */
async function openEventForGuests(ctx: ServiceContext, eventId: string) {
  const event = await findEvent(ctx, eventId);
  if (event.status === "CANCELLED") throw new ConflictError("İptal edilmiş etkinliğe guest eklenemez.", "EVENT_CANCELLED");
  if (event.endsAt.getTime() < Date.now()) throw new ConflictError("Sona ermiş etkinliğe guest eklenemez.", "EVENT_ENDED");
  return event;
}

export type AlreadyRegisteredDetail = { registrationId: string; customerId: string };
export type ExistingCustomerDetail = {
  customerId: string;
  name: string;
  field: "phone" | "email";
  alreadyRegistered: boolean;
  archived: boolean;
};

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

export async function addExistingGuest(
  ctx: ServiceContext,
  eventId: string,
  raw: { customerId: string; partySize: unknown; note?: unknown },
) {
  assertCan(ctx, "guests.manage");
  // undefined id Prisma'da "filtre yok" demektir — boş id asla sorguya girmemeli.
  if (typeof raw.customerId !== "string" || raw.customerId === "") {
    throw new ValidationError({ customerId: ["Bir müşteri seçin."] });
  }
  const extras = parseGuestExtras(raw);
  const event = await openEventForGuests(ctx, eventId);
  const customer = await db.customer.findFirst({ where: { id: raw.customerId, tenantId: ctx.tenantId } });
  if (!customer) throw new NotFoundError("Müşteri bulunamadı.");
  if (customer.archivedAt) throw new ConflictError("Arşivdeki müşteri guest olarak eklenemez.", "CUSTOMER_ARCHIVED");

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.eventRegistration.findUnique({
        where: { eventId_customerId: { eventId: event.id, customerId: customer.id } },
      });
      if (existing?.accessStatus === "ACTIVE") {
        throw new ConflictError<AlreadyRegisteredDetail>(
          `${fullName(customer)} bu etkinliğin guest listesinde zaten var.`,
          "ALREADY_REGISTERED",
          { registrationId: existing.id, customerId: customer.id },
        );
      }
      if (event.capacity !== null) {
        const agg = await tx.eventRegistration.aggregate({
          where: { eventId: event.id, accessStatus: "ACTIVE" },
          _sum: { partySize: true },
        });
        const people = agg._sum.partySize ?? 0;
        if (people + extras.partySize > event.capacity) {
          throw new ConflictError(
            `Kapasite aşılıyor: ${event.capacity} kişilik kapasitenin ${people} kişisi dolu.`,
            "CAPACITY_EXCEEDED",
          );
        }
      }
      const meta = { customerName: fullName(customer), eventName: event.name, partySize: extras.partySize };
      if (existing) {
        const reg = await tx.eventRegistration.update({
          where: { id: existing.id },
          data: {
            accessStatus: "ACTIVE",
            cancelledAt: null,
            partySize: extras.partySize,
            note: extras.note || existing.note,
            addedByUserId: ctx.userId,
          },
        });
        await logActivity(tx, ctx, {
          action: "registration.reactivated",
          entityType: "registration",
          entityId: reg.id,
          customerId: customer.id,
          eventId: event.id,
          metadata: meta,
        });
        return reg;
      }
      const reg = await tx.eventRegistration.create({
        data: {
          tenantId: ctx.tenantId,
          eventId: event.id,
          customerId: customer.id,
          partySize: extras.partySize,
          channel: "STAFF",
          completionStatus: "STAFF_ENTERED",
          accessStatus: "ACTIVE",
          addedByUserId: ctx.userId,
          note: extras.note || null,
        },
      });
      await logActivity(tx, ctx, {
        action: "registration.added",
        entityType: "registration",
        entityId: reg.id,
        customerId: customer.id,
        eventId: event.id,
        metadata: meta,
      });
      return reg;
    }, SERIALIZABLE);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError(`${fullName(customer)} bu etkinliğin guest listesinde zaten var.`, "ALREADY_REGISTERED");
    }
    throw e;
  }
}

/**
 * Yeni kişi için CRM kaydı + guest kaydı. Telefon/e-posta mevcut bir müşteriyle
 * eşleşirse yeni kayıt OLUŞTURULMAZ; arayüz mevcut müşteriyi eklemeyi önerir.
 * Guest eklemek iletişim izni veya üyelik oluşturmaz.
 */
export async function addNewGuest(ctx: ServiceContext, eventId: string, raw: Record<string, unknown>) {
  assertCan(ctx, "guests.manage");
  assertCan(ctx, "customers.create");
  const errors: FieldErrors = {};
  const contact = parseContactFields(raw, errors);
  let extras: { partySize: number; note: string } | null = null;
  try {
    extras = parseGuestExtras(raw);
  } catch (e) {
    if (e instanceof ValidationError) Object.assign(errors, e.fieldErrors);
    else throw e;
  }
  if (Object.keys(errors).length > 0 || !contact || !extras) throw new ValidationError(errors);

  const event = await openEventForGuests(ctx, eventId);
  const match = await findContactConflict(ctx.tenantId, contact);
  if (match) {
    const reg = await db.eventRegistration.findUnique({
      where: { eventId_customerId: { eventId: event.id, customerId: match.customerId } },
      select: { accessStatus: true },
    });
    const what = match.field === "phone" ? "Bu telefon numarası" : "Bu e-posta adresi";
    throw new ConflictError<ExistingCustomerDetail>(
      `${what} zaten ${match.name} adına kayıtlı. Yeni müşteri oluşturulmadı.`,
      "EXISTING_CUSTOMER",
      { ...match, alreadyRegistered: reg?.accessStatus === "ACTIVE" },
    );
  }

  const data = contact;
  const guest = extras;
  try {
    return await db.$transaction(async (tx) => {
      if (event.capacity !== null) {
        const agg = await tx.eventRegistration.aggregate({
          where: { eventId: event.id, accessStatus: "ACTIVE" },
          _sum: { partySize: true },
        });
        const people = agg._sum.partySize ?? 0;
        if (people + guest.partySize > event.capacity) {
          throw new ConflictError(
            `Kapasite aşılıyor: ${event.capacity} kişilik kapasitenin ${people} kişisi dolu.`,
            "CAPACITY_EXCEEDED",
          );
        }
      }
      const customer = await tx.customer.create({
        data: {
          tenantId: ctx.tenantId,
          firstName: data.firstName,
          lastName: data.lastName,
          searchName: foldText(`${data.firstName} ${data.lastName}`),
          phone: data.phone,
          email: data.email,
          source: "STAFF_GUEST",
          sourceVenueId: event.venueId,
          createdByUserId: ctx.userId,
        },
      });
      const customerName = fullName(customer);
      await logActivity(tx, ctx, {
        action: "customer.created",
        entityType: "customer",
        entityId: customer.id,
        customerId: customer.id,
        eventId: event.id,
        metadata: { customerName, sourceLabel: `Guest listesi: ${event.name}` },
      });
      const reg = await tx.eventRegistration.create({
        data: {
          tenantId: ctx.tenantId,
          eventId: event.id,
          customerId: customer.id,
          partySize: guest.partySize,
          channel: "STAFF",
          completionStatus: "STAFF_ENTERED",
          addedByUserId: ctx.userId,
          note: guest.note || null,
        },
      });
      await logActivity(tx, ctx, {
        action: "registration.added",
        entityType: "registration",
        entityId: reg.id,
        customerId: customer.id,
        eventId: event.id,
        metadata: { customerName, eventName: event.name, partySize: guest.partySize },
      });
      return { customer, registration: reg };
    }, SERIALIZABLE);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError("Bu iletişim bilgisiyle az önce başka bir kayıt oluşturuldu. Listeyi yenileyin.", "RACE");
    }
    throw e;
  }
}

export async function cancelRegistration(ctx: ServiceContext, registrationId: string) {
  assertCan(ctx, "guests.manage");
  const reg = await db.eventRegistration.findFirst({
    where: { id: registrationId, tenantId: ctx.tenantId, event: venueScope(ctx) },
    include: {
      event: { select: { id: true, name: true } },
      customer: { select: { firstName: true, lastName: true } },
    },
  });
  if (!reg) throw new NotFoundError("Guest kaydı bulunamadı.");
  if (reg.accessStatus === "CANCELLED") return reg;
  return db.$transaction(async (tx) => {
    const updated = await tx.eventRegistration.update({
      where: { id: reg.id },
      data: { accessStatus: "CANCELLED", cancelledAt: new Date() },
    });
    await logActivity(tx, ctx, {
      action: "registration.cancelled",
      entityType: "registration",
      entityId: reg.id,
      customerId: reg.customerId,
      eventId: reg.eventId,
      metadata: { customerName: fullName(reg.customer), eventName: reg.event.name },
    });
    return updated;
  });
}

/** Guest ekleme paneli için müşteri araması (en fazla 8 sonuç). */
export async function searchGuestCandidates(ctx: ServiceContext, eventId: string, q: string) {
  assertCan(ctx, "guests.manage");
  assertCan(ctx, "customers.view");
  const event = await findEvent(ctx, eventId);
  const search = customerSearchWhere(q);
  if (!search) return [];
  const rows = await db.customer.findMany({
    where: { tenantId: ctx.tenantId, archivedAt: null, ...search },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      registrations: { where: { eventId: event.id }, select: { accessStatus: true } },
    },
    orderBy: { searchName: "asc" },
    take: 8,
  });
  return rows.map((r) => ({
    id: r.id,
    name: fullName(r),
    phone: r.phone,
    email: r.email,
    registration: r.registrations[0]?.accessStatus ?? null,
  }));
}

export function isEventStatus(value: unknown): value is EventStatus {
  return isOneOf(["DRAFT", "PUBLISHED", "CANCELLED"] as const, value);
}
