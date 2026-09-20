import "server-only";
import type { Prisma } from "@prisma/client";
import { db, isUniqueViolation } from "@/lib/db";
import { assertCan, can, canAccessVenue, venueScope, type ServiceContext } from "@/lib/authz";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanText, foldText, fullName } from "@/lib/normalize";
import { formatDateTime } from "@/lib/datetime";
import { isOneOf, ROLES, type Role } from "@/lib/domain";
import { logActivity } from "@/modules/activity/service";
import { registrationStats } from "@/modules/events/service";
import {
  ENTRY_LATE_HOURS,
  PASS_STATE_LABELS,
  PASS_STATE_MESSAGES,
  entryWindow,
  evaluateEntryPass,
  maskedName,
  type PassPurpose,
  type PassState,
} from "./rules";
import {
  SERIALIZABLE,
  createPass,
  evaluateLoadedPass,
  findPassByToken,
  sharePass,
  type LoadedPass,
  type PassShare,
} from "./internal";

function stateError(state: Exclude<PassState, "VALID">) {
  return new ConflictError(PASS_STATE_MESSAGES[state], state);
}

// ─────────────────────────────────────────────── Giriş QR'ı (etkinlik)

async function findRegistration(ctx: ServiceContext, registrationId: string) {
  if (!registrationId) throw new ValidationError({ registrationId: ["Guest kaydı seçin."] });
  const reg = await db.eventRegistration.findFirst({
    where: { id: registrationId, tenantId: ctx.tenantId, event: venueScope(ctx) },
    include: {
      event: true,
      customer: { select: { firstName: true, lastName: true } },
    },
  });
  if (!reg) throw new NotFoundError("Guest kaydı bulunamadı.");
  return reg;
}

export type EntryPassResult = PassShare & { state: PassState; stateLabel: string; guestName: string; eventName: string };

/**
 * Guest kaydı için giriş QR'ını getirir; yoksa oluşturur (idempotent).
 * reissue: mevcut kodu iptal edip yenisini verir (kullanılmış kod yenilenemez).
 */
export async function getOrIssueEntryPass(
  ctx: ServiceContext,
  registrationId: string,
  opts: { reissue?: boolean } = {},
): Promise<EntryPassResult> {
  assertCan(ctx, "passes.issue");
  const reg = await findRegistration(ctx, registrationId);
  const now = new Date();
  if (reg.event.status === "CANCELLED") throw stateError("EVENT_CANCELLED");
  if (reg.accessStatus !== "ACTIVE") throw stateError("REGISTRATION_CANCELLED");
  if (entryWindow(reg.event).closesAt < now) {
    throw new ConflictError("Giriş süresi dolmuş etkinlik için QR oluşturulamaz.", "EXPIRED");
  }
  const guestName = fullName(reg.customer);

  const pass = await db.$transaction(async (tx) => {
    const existing = await tx.pass.findFirst({
      where: { tenantId: ctx.tenantId, purpose: "EVENT_ENTRY", registrationId: reg.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (existing && !opts.reissue) return existing;

    const checkIn = await tx.checkIn.findUnique({ where: { registrationId: reg.id } });
    if (checkIn) {
      if (existing) return existing;
      throw new ConflictError("Bu guest için giriş zaten kaydedildi; yeni QR gerekmez.", "ALREADY_CHECKED_IN");
    }
    if (existing) await tx.pass.update({ where: { id: existing.id }, data: { revokedAt: now } });
    const created = await createPass(tx, {
      tenantId: ctx.tenantId,
      purpose: "EVENT_ENTRY",
      customerId: reg.customerId,
      registrationId: reg.id,
      maxUses: 1,
      issuedByUserId: ctx.userId,
    });
    await logActivity(tx, ctx, {
      action: existing ? "pass.reissued" : "pass.issued",
      entityType: "pass",
      entityId: created.id,
      customerId: reg.customerId,
      eventId: reg.eventId,
      metadata: { customerName: guestName, eventName: reg.event.name, purpose: "EVENT_ENTRY" },
    });
    return created;
  }, SERIALIZABLE);

  const state = evaluateEntryPass(pass, reg, reg.event, now);
  return { ...sharePass(pass), state, stateLabel: PASS_STATE_LABELS[state], guestName, eventName: reg.event.name };
}

// ─────────────────────────────────────────────── Check-in (kapı)

function parseAdmitted(value: unknown, partySize: number): number {
  if (value === undefined || value === null || value === "") return partySize;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > partySize) {
    throw new ValidationError({ admittedCount: [`Giriş yapan kişi sayısı 1 ile ${partySize} arasında olmalı.`] });
  }
  return n;
}

async function recordCheckIn(
  ctx: ServiceContext,
  input: {
    registration: { id: string; customerId: string; customer: { firstName: string; lastName: string } };
    event: { id: string; name: string };
    pass: { id: string; useCount: number } | null;
    admitted: number;
    method: "QR" | "MANUAL";
    now: Date;
  },
) {
  const { registration, event, pass, admitted, method, now } = input;
  try {
    return await db.$transaction(async (tx) => {
      if (pass) {
        // Compare-and-set: yalnızca okunan useCount hâlâ geçerliyse artır. Eşzamanlı ikinci okutma 0 satır günceller.
        const res = await tx.pass.updateMany({
          where: { id: pass.id, tenantId: ctx.tenantId, revokedAt: null, useCount: pass.useCount },
          data: { useCount: pass.useCount + 1, lastUsedAt: now },
        });
        if (res.count === 0) throw new ConflictError("Bu QR az önce başka bir cihazdan kullanıldı.", "USED");
      }
      const checkIn = await tx.checkIn.create({
        data: {
          tenantId: ctx.tenantId,
          eventId: event.id,
          registrationId: registration.id,
          customerId: registration.customerId,
          admittedCount: admitted,
          method,
          passId: pass?.id ?? null,
          checkedInByUserId: ctx.userId,
          checkedInAt: now,
        },
      });
      await logActivity(tx, ctx, {
        action: "checkin.recorded",
        entityType: "checkin",
        entityId: checkIn.id,
        customerId: registration.customerId,
        eventId: event.id,
        metadata: { customerName: fullName(registration.customer), eventName: event.name, admittedCount: admitted, method },
      });
      return checkIn;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Bu guest için giriş zaten kaydedildi.", "ALREADY_CHECKED_IN");
    throw e;
  }
}

/** QR okutularak giriş onayı. */
export async function redeemEntryPass(ctx: ServiceContext, token: string, raw: { admittedCount?: unknown } = {}) {
  assertCan(ctx, "door.checkin");
  const pass = await findPassByToken(token, ctx.tenantId);
  if (!pass || pass.purpose !== "EVENT_ENTRY" || !pass.registration) throw new NotFoundError("QR bulunamadı.");
  const reg = pass.registration;
  if (!canAccessVenue(ctx, reg.event.venueId)) throw new ForbiddenError("Bu mekanın girişlerini doğrulama yetkiniz yok.");

  const now = new Date();
  const { state } = await evaluateLoadedPass(pass, now);
  if (state !== "VALID") throw stateError(state);
  const admitted = parseAdmitted(raw.admittedCount, reg.partySize);
  return recordCheckIn(ctx, {
    registration: { id: reg.id, customerId: reg.customerId, customer: pass.customer },
    event: reg.event,
    pass,
    admitted,
    method: "QR",
    now,
  });
}

/** QR'sız manuel giriş (listeden). Kullanılmamış bir giriş QR'ı varsa o da tüketilir. */
export async function manualCheckIn(ctx: ServiceContext, registrationId: string, raw: { admittedCount?: unknown } = {}) {
  assertCan(ctx, "door.checkin");
  const reg = await findRegistration(ctx, registrationId);
  const now = new Date();
  const state = evaluateEntryPass({ revokedAt: null, useCount: 0, maxUses: 1 }, reg, reg.event, now);
  if (state !== "VALID") throw stateError(state);
  const admitted = parseAdmitted(raw.admittedCount, reg.partySize);
  const pass = await db.pass.findFirst({
    where: { tenantId: ctx.tenantId, purpose: "EVENT_ENTRY", registrationId: reg.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return recordCheckIn(ctx, {
    registration: reg,
    event: reg.event,
    pass: pass && pass.useCount < pass.maxUses ? pass : null,
    admitted,
    method: "MANUAL",
    now,
  });
}

// ─────────────────────────────────────────────── Girişi geri alma ve pencere uzatma

/**
 * Yanlış kaydedilen girişi siler; QR kullanıldıysa yeniden geçerli hâle getirir.
 * Kayıt silinse de işlem aktivite geçmişinde kalır (denetim izi).
 */
export async function undoCheckIn(ctx: ServiceContext, registrationId: string) {
  assertCan(ctx, "checkin.undo");
  const reg = await findRegistration(ctx, registrationId);
  const checkIn = await db.checkIn.findFirst({ where: { registrationId: reg.id, tenantId: ctx.tenantId } });
  if (!checkIn) throw new ConflictError("Bu guest için giriş kaydı yok.", "NO_CHECKIN");

  return db.$transaction(async (tx) => {
    // deleteMany + count: aynı anda başka bir cihaz geri almışsa ikinci işlem boşa düşer.
    const removed = await tx.checkIn.deleteMany({ where: { id: checkIn.id, tenantId: ctx.tenantId } });
    if (removed.count === 0) throw new ConflictError("Giriş kaydı az önce değiştirildi; sayfayı yenileyin.", "NO_CHECKIN");

    let passRestored = false;
    if (checkIn.passId) {
      const pass = await tx.pass.findFirst({ where: { id: checkIn.passId, tenantId: ctx.tenantId } });
      if (pass && !pass.revokedAt && pass.useCount > 0) {
        const res = await tx.pass.updateMany({
          where: { id: pass.id, tenantId: ctx.tenantId, useCount: pass.useCount },
          data: { useCount: pass.useCount - 1, lastUsedAt: pass.useCount - 1 === 0 ? null : pass.lastUsedAt },
        });
        passRestored = res.count > 0;
      }
    }

    await logActivity(tx, ctx, {
      action: "checkin.undone",
      entityType: "checkin",
      entityId: checkIn.id,
      customerId: reg.customerId,
      eventId: reg.eventId,
      metadata: {
        customerName: fullName(reg.customer),
        eventName: reg.event.name,
        admittedCount: checkIn.admittedCount,
        method: checkIn.method,
        checkedInAt: checkIn.checkedInAt.toISOString(),
        passRestored,
      },
    });
    return { passRestored, admittedCount: checkIn.admittedCount };
  }, SERIALIZABLE);
}

const EXTEND_MIN_MINUTES = 15;
const EXTEND_MAX_MINUTES = 180;

/**
 * Giriş penceresini uzatır (gece uzadığında geç gelen guest'ler için).
 * Yeni kapanış, şu an ile mevcut kapanıştan geç olanın üzerine eklenir;
 * etkinlik bitişinden en fazla ENTRY_LATE_HOURS saat sonrasına kadar çıkabilir.
 */
export async function extendEntryWindow(ctx: ServiceContext, eventId: string, rawMinutes: unknown) {
  assertCan(ctx, "entry.extend");
  const minutes = Number(rawMinutes);
  if (!Number.isInteger(minutes) || minutes < EXTEND_MIN_MINUTES || minutes > EXTEND_MAX_MINUTES) {
    throw new ValidationError({ minutes: [`Uzatma ${EXTEND_MIN_MINUTES} ile ${EXTEND_MAX_MINUTES} dakika arasında olmalı.`] });
  }
  const event = await db.event.findFirst({ where: { id: eventId, tenantId: ctx.tenantId, ...venueScope(ctx) } });
  if (!event) throw new NotFoundError("Etkinlik bulunamadı.");
  if (event.status === "CANCELLED") throw stateError("EVENT_CANCELLED");

  const now = new Date();
  const latest = new Date(event.endsAt.getTime() + ENTRY_LATE_HOURS * 3600 * 1000);
  const current = entryWindow(event).closesAt;
  const target = new Date(Math.min(Math.max(now.getTime(), current.getTime()) + minutes * 60_000, latest.getTime()));
  if (target <= current) {
    throw new ConflictError(`Giriş penceresi en fazla etkinlik bitişinden ${ENTRY_LATE_HOURS} saat sonrasına kadar uzatılabilir.`, "EXPIRED");
  }

  const updated = await db.$transaction(async (tx) => {
    const e = await tx.event.update({ where: { id: event.id }, data: { entryClosesAt: target } });
    await logActivity(tx, ctx, {
      action: "event.entry_extended",
      entityType: "event",
      entityId: event.id,
      eventId: event.id,
      metadata: { eventName: event.name, minutes, closesAtLabel: formatDateTime(target) },
    });
    return e;
  });
  return { closesAt: target, windowState: windowState(updated, new Date()) };
}

// ─────────────────────────────────────────────── Kapı ekranı

async function checkInStats(tenantId: string, eventIds: string[]) {
  const map = new Map<string, { checkIns: number; admitted: number }>();
  if (eventIds.length === 0) return map;
  const groups = await db.checkIn.groupBy({
    by: ["eventId"],
    where: { tenantId, eventId: { in: eventIds } },
    _count: { _all: true },
    _sum: { admittedCount: true },
  });
  for (const g of groups) map.set(g.eventId, { checkIns: g._count._all, admitted: g._sum.admittedCount ?? 0 });
  return map;
}

export type WindowState = "OPEN" | "NOT_YET" | "CLOSED" | "CANCELLED";

/** Girişi kapanmış etkinliğin kapı listesinde kalma süresi. */
const RECENTLY_CLOSED_MS = 6 * 3600 * 1000;

/** Kapı ekranında tek seferde gösterilen guest sayısı; fazlası aramayla bulunur. */
export const DOOR_GUEST_LIMIT = 300;

function windowState(event: { status: string; startsAt: Date; endsAt: Date; entryClosesAt: Date | null }, now: Date): WindowState {
  if (event.status === "CANCELLED") return "CANCELLED";
  const w = entryWindow(event);
  if (now < w.opensAt) return "NOT_YET";
  if (now > w.closesAt) return "CLOSED";
  return "OPEN";
}

/** Girişi açık ve 24 saat içinde başlayacak etkinlikler (erişilebilir mekanlar). */
export async function listDoorEvents(ctx: ServiceContext) {
  assertCan(ctx, "door.checkin");
  const now = new Date();
  const events = await db.event.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...venueScope(ctx),
      status: { not: "CANCELLED" },
      startsAt: { lte: new Date(now.getTime() + 24 * 3600 * 1000) },
      endsAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) },
    },
    include: { venue: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  // Kapanan etkinlik listede kısa süre kalır: geç giriş için pencere uzatılabilsin.
  const relevant = events.filter(
    (e) => windowState(e, now) !== "CLOSED" || now.getTime() - entryWindow(e).closesAt.getTime() <= RECENTLY_CLOSED_MS,
  );
  const ids = relevant.map((e) => e.id);
  const [regs, checks] = await Promise.all([registrationStats(ctx.tenantId, ids), checkInStats(ctx.tenantId, ids)]);
  return relevant.map((e) => ({
    id: e.id,
    name: e.name,
    venueName: e.venue.name,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    status: e.status,
    windowState: windowState(e, now),
    window: entryWindow(e),
    ...(regs.get(e.id) ?? { registrations: 0, people: 0 }),
    ...(checks.get(e.id) ?? { checkIns: 0, admitted: 0 }),
  }));
}

/** Kapı ekranı guest listesi — yalnızca giriş için gereken bilgiler (ad, kişi sayısı, not, giriş durumu). */
export async function getDoorEvent(ctx: ServiceContext, eventId: string, q = "") {
  assertCan(ctx, "door.checkin");
  const event = await db.event.findFirst({
    where: { id: eventId, tenantId: ctx.tenantId, ...venueScope(ctx) },
    include: { venue: { select: { name: true } } },
  });
  if (!event) throw new NotFoundError("Etkinlik bulunamadı.");
  const query = cleanText(q);
  const now = new Date();

  const [guests, totals, checks] = await Promise.all([
    db.eventRegistration.findMany({
      where: {
        tenantId: ctx.tenantId,
        eventId: event.id,
        accessStatus: "ACTIVE",
        ...(query ? { customer: { searchName: { contains: foldText(query) } } } : {}),
      },
      select: {
        id: true,
        partySize: true,
        note: true,
        customer: { select: { firstName: true, lastName: true, searchName: true } },
        checkIns: { select: { admittedCount: true, checkedInAt: true, method: true } },
      },
      orderBy: { customer: { searchName: "asc" } },
      take: DOOR_GUEST_LIMIT,
    }),
    registrationStats(ctx.tenantId, [event.id]),
    checkInStats(ctx.tenantId, [event.id]),
  ]);

  return {
    event: { id: event.id, name: event.name, venueName: event.venue.name, startsAt: event.startsAt, endsAt: event.endsAt, status: event.status },
    window: entryWindow(event),
    windowState: windowState(event, now),
    stats: {
      ...(totals.get(event.id) ?? { registrations: 0, people: 0 }),
      ...(checks.get(event.id) ?? { checkIns: 0, admitted: 0 }),
    },
    filtered: query.length > 0,
    limit: DOOR_GUEST_LIMIT,
    truncated: guests.length === DOOR_GUEST_LIMIT,
    guests: guests.map((g) => ({
      id: g.id,
      name: fullName(g.customer),
      partySize: g.partySize,
      note: g.note,
      checkIn: g.checkIns[0] ?? null,
    })),
  };
}

// ─────────────────────────────────────────────── Panel özetleri (gerçek ölçüm)

export async function getEventCheckInStats(ctx: ServiceContext, eventId: string) {
  assertCan(ctx, "events.view");
  const event = await db.event.findFirst({ where: { id: eventId, tenantId: ctx.tenantId, ...venueScope(ctx) }, select: { id: true } });
  if (!event) throw new NotFoundError("Etkinlik bulunamadı.");
  const groups = await db.checkIn.groupBy({
    by: ["method"],
    where: { tenantId: ctx.tenantId, eventId: event.id },
    _count: { _all: true },
    _sum: { admittedCount: true },
  });
  const pick = (m: string) => groups.find((g) => g.method === m);
  return {
    checkIns: groups.reduce((s, g) => s + g._count._all, 0),
    admitted: groups.reduce((s, g) => s + (g._sum.admittedCount ?? 0), 0),
    viaQr: pick("QR")?._count._all ?? 0,
    manual: pick("MANUAL")?._count._all ?? 0,
  };
}

/** Müşteri profili: doğrulanmış girişler ve avantaj kullanımları. */
export async function getCustomerVerifiedActivity(ctx: ServiceContext, customerId: string) {
  assertCan(ctx, "customers.view");
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!customer) throw new NotFoundError("Müşteri bulunamadı.");
  const [checkIns, redemptions] = await Promise.all([
    db.checkIn.findMany({
      where: { tenantId: ctx.tenantId, customerId: customer.id, event: venueScope(ctx) },
      select: { registrationId: true, checkedInAt: true, admittedCount: true, method: true },
      orderBy: { checkedInAt: "desc" },
    }),
    db.perkRedemption.findMany({
      where: { tenantId: ctx.tenantId, customerId: customer.id },
      include: { perk: { select: { name: true } } },
      orderBy: { redeemedAt: "desc" },
      take: 20,
    }),
  ]);
  return {
    checkIns,
    checkInByRegistration: Object.fromEntries(checkIns.map((c) => [c.registrationId, c])),
    redemptionCount: await db.perkRedemption.count({ where: { tenantId: ctx.tenantId, customerId: customer.id } }),
    redemptions: redemptions.map((r) => ({ id: r.id, perkName: r.perk.name, redeemedAt: r.redeemedAt })),
  };
}

/** Dashboard: seçili dönemde doğrulanmış giriş ve avantaj kullanımı. */
export async function getVerifiedSummary(ctx: ServiceContext, opts: { periodDays: number; venueId: string | null }) {
  assertCan(ctx, "dashboard.view");
  const from = new Date(Date.now() - opts.periodDays * 24 * 3600 * 1000);
  const venueId = opts.venueId && canAccessVenue(ctx, opts.venueId) ? opts.venueId : null;
  const eventWhere: Prisma.EventWhereInput = { ...venueScope(ctx), ...(venueId ? { venueId } : {}) };
  const [checkIns, redemptions] = await Promise.all([
    db.checkIn.aggregate({
      where: { tenantId: ctx.tenantId, checkedInAt: { gte: from }, event: eventWhere },
      _count: { _all: true },
      _sum: { admittedCount: true },
    }),
    db.perkRedemption.count({
      where: {
        tenantId: ctx.tenantId,
        redeemedAt: { gte: from },
        ...(venueId ? { perk: { OR: [{ venueId: null }, { venueId }] } } : {}),
      },
    }),
  ]);
  return { checkIns: checkIns._count._all, admitted: checkIns._sum.admittedCount ?? 0, redemptions };
}

// ─────────────────────────────────────────────── Doğrulama sayfası (/q)

type StaffCheckIn = { admittedCount: number; checkedInAt: Date; method: string; byName: string | null; byUserId: string | null };

export type StaffPassView = {
  purpose: PassPurpose;
  state: PassState;
  stateLabel: string;
  venueName: string | null;
  entry?: {
    eventId: string;
    eventName: string;
    startsAt: Date;
    endsAt: Date;
    opensAt: Date;
    closesAt: Date;
    guestName: string;
    partySize: number;
    note: string | null;
    checkIn: StaffCheckIn | null;
  };
  perk?: {
    perkName: string;
    description: string | null;
    terms: string | null;
    holder: string;
    limit: number;
    remaining: number;
    validUntil: Date | null;
    lastRedemption: { at: Date; byName: string | null; byUserId: string | null } | null;
  };
};

export type StaffPassResolution =
  | { kind: "invalid" }
  | { kind: "outsider" }
  | { kind: "forbidden"; tenantName: string; message: string }
  | { kind: "staff"; tenantName: string; role: Role; view: StaffPassView };

export async function membershipContext(userId: string, tenantId: string): Promise<ServiceContext | null> {
  const m = await db.membership.findFirst({
    where: { userId, tenantId, status: "ACTIVE", tenant: { status: "ACTIVE" } },
    include: { venueAccess: { select: { venueId: true } } },
  });
  if (!m || !isOneOf(ROLES, m.role)) return null;
  return {
    tenantId,
    userId,
    membershipId: m.id,
    role: m.role as Role,
    venueIds: m.venueAccess.length > 0 ? m.venueAccess.map((v) => v.venueId) : null,
  };
}

function staffPermissionError(ctx: ServiceContext, pass: LoadedPass): string | null {
  const entry = pass.purpose === "EVENT_ENTRY";
  if (!can(ctx.role, entry ? "door.checkin" : "perks.redeem")) {
    return entry ? "Giriş QR'larını doğrulama yetkiniz yok." : "Avantaj QR'larını doğrulama yetkiniz yok.";
  }
  const venue = entry ? pass.registration?.event.venue : pass.perk?.venue;
  if (venue && !canAccessVenue(ctx, venue.id)) return `Bu QR ${venue.name} mekanına ait; bu mekanda doğrulama yetkiniz yok.`;
  return null;
}

async function userName(id: string | null | undefined) {
  if (!id) return null;
  return (await db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;
}

/**
 * Okutulan QR için personel görünümü. Kullanıcı pass'in tenant'ında üye değilse "outsider"
 * (sayfa müşteri görünümüne yönlenir; hiçbir iç bilgi gösterilmez).
 */
export async function resolveStaffPass(userId: string, token: string): Promise<StaffPassResolution> {
  const pass = await findPassByToken(token);
  if (!pass) return { kind: "invalid" };
  const ctx = await membershipContext(userId, pass.tenantId);
  if (!ctx) return { kind: "outsider" };
  const denied = staffPermissionError(ctx, pass);
  if (denied) return { kind: "forbidden", tenantName: pass.tenant.name, message: denied };

  const { state, redemptions } = await evaluateLoadedPass(pass);
  const base = { purpose: pass.purpose as PassPurpose, state, stateLabel: PASS_STATE_LABELS[state] };

  if (pass.purpose === "EVENT_ENTRY" && pass.registration) {
    const reg = pass.registration;
    const checkIn = await db.checkIn.findUnique({ where: { registrationId: reg.id } });
    const w = entryWindow(reg.event);
    return {
      kind: "staff",
      tenantName: pass.tenant.name,
      role: ctx.role,
      view: {
        ...base,
        venueName: reg.event.venue.name,
        entry: {
          eventId: reg.event.id,
          eventName: reg.event.name,
          startsAt: reg.event.startsAt,
          endsAt: reg.event.endsAt,
          opensAt: w.opensAt,
          closesAt: w.closesAt,
          guestName: fullName(pass.customer),
          partySize: reg.partySize,
          note: reg.note,
          checkIn: checkIn
            ? {
                admittedCount: checkIn.admittedCount,
                checkedInAt: checkIn.checkedInAt,
                method: checkIn.method,
                byName: await userName(checkIn.checkedInByUserId),
                byUserId: checkIn.checkedInByUserId,
              }
            : null,
        },
      },
    };
  }

  const perk = pass.perk!;
  const last = await db.perkRedemption.findFirst({ where: { tenantId: pass.tenantId, passId: pass.id }, orderBy: { redeemedAt: "desc" } });
  return {
    kind: "staff",
    tenantName: pass.tenant.name,
    role: ctx.role,
    view: {
      ...base,
      venueName: perk.venue?.name ?? null,
      perk: {
        perkName: perk.name,
        description: perk.description,
        terms: perk.terms,
        holder: maskedName(pass.customer.firstName, pass.customer.lastName),
        limit: perk.perCustomerLimit,
        remaining: Math.max(0, Math.min(perk.perCustomerLimit - redemptions, pass.maxUses - pass.useCount)),
        validUntil: perk.validUntil,
        lastRedemption: last
          ? { at: last.redeemedAt, byName: await userName(last.redeemedByUserId), byUserId: last.redeemedByUserId }
          : null,
      },
    },
  };
}

// ─────────────────────────────────────────────── Müşteri pass sayfası (/pass)

export type PublicPassView = {
  purpose: PassPurpose;
  state: PassState;
  stateLabel: string;
  venueName: string;
  holder: string;
  showQr: boolean;
  qr: PassShare["qr"];
  entry?: { eventName: string; startsAt: Date; endsAt: Date; opensAt: Date; closesAt: Date; partySize: number };
  perk?: { perkName: string; description: string | null; terms: string | null; validUntil: Date | null; remaining: number; limit: number };
  usedAt: Date | null;
};

/**
 * Token sahibinin gördüğü sayfa. Kişisel veri olarak yalnızca maskeli ad gösterilir
 * (telefon, e-posta, notlar yok). Token bilinmiyorsa null.
 */
export async function getPublicPassView(token: string): Promise<PublicPassView | null> {
  const pass = await findPassByToken(token);
  if (!pass || pass.tenant.status !== "ACTIVE") return null;
  const { state, redemptions } = await evaluateLoadedPass(pass);
  const share = sharePass(pass);
  const common = {
    purpose: pass.purpose as PassPurpose,
    state,
    stateLabel: PASS_STATE_LABELS[state],
    holder: maskedName(pass.customer.firstName, pass.customer.lastName),
    showQr: state === "VALID" || state === "NOT_YET_VALID",
    qr: share.qr,
    usedAt: pass.lastUsedAt,
  };
  if (pass.purpose === "EVENT_ENTRY" && pass.registration) {
    const event = pass.registration.event;
    const w = entryWindow(event);
    return {
      ...common,
      venueName: event.venue.name,
      entry: {
        eventName: event.name,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        opensAt: w.opensAt,
        closesAt: w.closesAt,
        partySize: pass.registration.partySize,
      },
    };
  }
  if (!pass.perk) return null;
  return {
    ...common,
    venueName: pass.perk.venue?.name ?? pass.tenant.name,
    perk: {
      perkName: pass.perk.name,
      description: pass.perk.description,
      terms: pass.perk.terms,
      validUntil: pass.perk.validUntil,
      limit: pass.perk.perCustomerLimit,
      remaining: Math.max(0, Math.min(pass.perk.perCustomerLimit - redemptions, pass.maxUses - pass.useCount)),
    },
  };
}
