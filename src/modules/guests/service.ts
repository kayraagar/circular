import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, isUniqueViolation } from "@/lib/db";
import { assertCan, venueScope, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText, foldText, formatPhone, fullName, maskPhone, normalizePhone, phoneSearchDigits } from "@/lib/normalize";
import { MAX_PARTY_SIZE, isOneOf } from "@/lib/domain";
import { logActivity } from "@/modules/activity/service";
import { SERIALIZABLE, createPass, sharePass, type PassShare } from "@/modules/passes/internal";
import { PASS_STATE_LABELS, entryWindow, evaluateEntryPass, maskedName, type PassState } from "@/modules/passes/rules";
import {
  GUEST_SOURCES,
  SOURCE_MAPPING,
  guestSource,
  guestStatus,
  summarizeGuests,
  type GuestSource,
  type GuestStatus,
  type GuestTotals,
} from "./status";

/**
 * PR (promoter) ve misafir listesi.
 *
 * Yetki ve kapsam:
 * - OWNER_ADMIN / CRM_MANAGER: etkinliğin tüm misafirlerini ve PR kırılımını görür.
 * - PR: yalnızca kendi getirdiği kayıtları görür (prMembershipId = kendi üyeliği); taslak etkinlikleri göremez.
 *   Ad ve telefon maskelenir: PR, CRM'de zaten kayıtlı bir numara girdiğinde o kişinin kayıtlı bilgisini öğrenmez.
 * - Her sorguda tenant ve mekan kapsamı uygulanır; PR ataması veritabanında composite FK ile de korunur.
 *
 * Durum (PENDING / CHECKED_IN / CANCELLED) ve kaynak (ORGANIC / PROMOTER / WALK_IN) saklanmaz,
 * mevcut kayıtlardan türetilir (bkz. ./status.ts). Giriş QR'ı mevcut güvenli pass sistemidir.
 */

const isPromoter = (ctx: ServiceContext) => ctx.role === "PR";

function registrationScope(ctx: ServiceContext): Prisma.EventRegistrationWhereInput {
  return isPromoter(ctx) ? { prMembershipId: ctx.membershipId } : {};
}

/**
 * PR'ın gördüğü ad: yalnızca kendisinin CRM'e eklediği kişinin maskeli adı.
 * Numara zaten kayıtlı bir müşteriye aitse adı gösterilmez (PR, CRM'deki kişinin kimliğini öğrenmez).
 */
function promoterVisibleName(ctx: ServiceContext, customer: { firstName: string; lastName: string; sourceMembershipId: string | null }) {
  return customer.sourceMembershipId === ctx.membershipId ? maskedName(customer.firstName, customer.lastName) : "Kayıtlı müşteri";
}

async function findGuestEvent(ctx: ServiceContext, eventId: string) {
  if (!eventId) throw new NotFoundError("Etkinlik bulunamadı.");
  const event = await db.event.findFirst({
    where: {
      id: eventId,
      tenantId: ctx.tenantId,
      ...venueScope(ctx),
      ...(isPromoter(ctx) ? { status: { not: "DRAFT" } } : {}),
    },
    include: { venue: { select: { name: true } } },
  });
  if (!event) throw new NotFoundError("Etkinlik bulunamadı.");
  return event;
}

async function membershipNames(tenantId: string, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await db.membership.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.user.name]));
}

type RegistrationRow = { accessStatus: string; partySize: number; admittedCount: number | null };

const REG_STATS_SELECT = {
  eventId: true,
  accessStatus: true,
  partySize: true,
  prMembershipId: true,
  checkIns: { select: { admittedCount: true } },
} satisfies Prisma.EventRegistrationSelect;

function toStatsRow(r: { accessStatus: string; partySize: number; checkIns: { admittedCount: number }[] }): RegistrationRow {
  return { accessStatus: r.accessStatus, partySize: r.partySize, admittedCount: r.checkIns[0]?.admittedCount ?? null };
}

// ─────────────────────────────────────────────── PR portalı: etkinlikler

export type PromoterEvent = {
  id: string;
  name: string;
  venueName: string;
  startsAt: Date;
  endsAt: Date;
  open: boolean;
  /** Giriş penceresi hâlâ açık mı (kapandıysa bekleyen misafirler "gelmedi" sayılır) */
  entryOpen: boolean;
  stats: GuestTotals & { checkInRate: number };
};

/** Yayındaki etkinlikler (son 7 gün + gelecek) ve kullanıcının kapsamındaki sayılar. */
export async function listPromoterEvents(ctx: ServiceContext, now = new Date()): Promise<PromoterEvent[]> {
  assertCan(ctx, "promoter.guests");
  const events = await db.event.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...venueScope(ctx),
      status: "PUBLISHED",
      endsAt: { gte: new Date(now.getTime() - 7 * 24 * 3600 * 1000) },
    },
    include: { venue: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  const rows = events.length
    ? await db.eventRegistration.findMany({
        where: { tenantId: ctx.tenantId, eventId: { in: events.map((e) => e.id) }, ...registrationScope(ctx) },
        select: REG_STATS_SELECT,
      })
    : [];
  const byEvent = new Map<string, RegistrationRow[]>();
  for (const r of rows) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), toStatsRow(r)]);

  return events.map((e) => ({
    id: e.id,
    name: e.name,
    venueName: e.venue.name,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    open: e.endsAt >= now,
    entryOpen: entryWindow(e).closesAt >= now,
    stats: summarizeGuests(byEvent.get(e.id) ?? []),
  }));
}

// ─────────────────────────────────────────────── İstatistik

export type PromoterBreakdown = {
  membershipId: string | null;
  name: string;
  registrations: number;
  people: number;
  checkedIn: number;
  admitted: number;
};

export type PromoterStats = GuestTotals & {
  checkInRate: number;
  scope: "own" | "all";
  capacity: number | null;
  byPromoter: PromoterBreakdown[] | null;
};

/**
 * Etkinlik istatistiği. PR yalnızca kendi getirdiği misafirlerin sayısını görür;
 * yönetim tüm sayıları, kapasiteyi ve PR kırılımını görür.
 */
export async function getPromoterStats(ctx: ServiceContext, eventId: string): Promise<PromoterStats> {
  assertCan(ctx, "promoter.guests");
  const event = await findGuestEvent(ctx, eventId);
  const rows = await db.eventRegistration.findMany({
    where: { tenantId: ctx.tenantId, eventId: event.id, ...registrationScope(ctx) },
    select: REG_STATS_SELECT,
  });
  const summary = summarizeGuests(rows.map(toStatsRow));
  if (isPromoter(ctx)) return { ...summary, scope: "own", capacity: null, byPromoter: null };

  const groups = new Map<string | null, RegistrationRow[]>();
  for (const r of rows) groups.set(r.prMembershipId, [...(groups.get(r.prMembershipId) ?? []), toStatsRow(r)]);
  const names = await membershipNames(ctx.tenantId, [...groups.keys()]);
  const byPromoter = [...groups.entries()]
    .map(([membershipId, list]) => {
      const s = summarizeGuests(list);
      return {
        membershipId,
        name: membershipId ? (names.get(membershipId) ?? "PR") : "PR'sız (organik / kapıda)",
        registrations: s.registrations,
        people: s.people,
        checkedIn: s.checkedIn,
        admitted: s.admitted,
      };
    })
    .filter((p) => p.registrations > 0)
    .sort((a, b) => (a.membershipId === null ? 1 : b.membershipId === null ? -1 : b.admitted - a.admitted || b.people - a.people));

  return { ...summary, scope: "all", capacity: event.capacity, byPromoter };
}

// ─────────────────────────────────────────────── Misafir listesi

export type GuestRow = {
  id: string;
  name: string;
  phone: string | null;
  partySize: number;
  status: GuestStatus;
  source: GuestSource;
  promoterName: string | null;
  note: string | null;
  checkedInAt: Date | null;
  admittedCount: number | null;
  hasPass: boolean;
  createdAt: Date;
};

export const GUEST_LIST_LIMIT = 500;

export async function getEventGuestList(ctx: ServiceContext, eventId: string, opts: { q?: string } = {}, now = new Date()) {
  assertCan(ctx, "promoter.guests");
  const event = await findGuestEvent(ctx, eventId);
  const promoter = isPromoter(ctx);
  const query = cleanText(opts.q ?? "").slice(0, 100);
  const digits = query ? phoneSearchDigits(query) : null;

  // PR ada göre yalnızca kendi CRM'e eklediği kişilerde arayabilir (kayıtlı kişinin adı aramayla da sızmaz).
  const nameFilter: Prisma.CustomerWhereInput = promoter
    ? { searchName: { startsWith: foldText(query) }, sourceMembershipId: ctx.membershipId }
    : { searchName: { contains: foldText(query) } };
  const search: Prisma.EventRegistrationWhereInput = query
    ? { customer: { OR: [nameFilter, ...(digits ? [{ phone: { contains: digits } }] : [])] } }
    : {};

  const rows = await db.eventRegistration.findMany({
    where: { tenantId: ctx.tenantId, eventId: event.id, ...registrationScope(ctx), ...search },
    select: {
      id: true,
      partySize: true,
      accessStatus: true,
      channel: true,
      note: true,
      createdAt: true,
      prMembershipId: true,
      customer: { select: { firstName: true, lastName: true, phone: true, sourceMembershipId: true } },
      checkIns: { select: { checkedInAt: true, admittedCount: true } },
      passes: { where: { purpose: "EVENT_ENTRY", revokedAt: null }, select: { id: true }, take: 1 },
    },
    orderBy: [{ customer: { searchName: "asc" } }],
    take: GUEST_LIST_LIMIT,
  });
  const names = promoter ? new Map<string, string>() : await membershipNames(ctx.tenantId, rows.map((r) => r.prMembershipId));
  const cancelled = event.status === "CANCELLED";

  return {
    event: {
      id: event.id,
      name: event.name,
      venueName: event.venue.name,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      capacity: promoter ? null : event.capacity,
      canAddGuests: !cancelled && event.endsAt >= now,
      entryOpen: !cancelled && entryWindow(event).closesAt >= now,
    },
    scope: promoter ? ("own" as const) : ("all" as const),
    filtered: query.length > 0,
    truncated: rows.length === GUEST_LIST_LIMIT,
    guests: rows.map(
      (r): GuestRow => ({
        id: r.id,
        name: promoter ? promoterVisibleName(ctx, r.customer) : fullName(r.customer),
        phone: promoter ? maskPhone(r.customer.phone) : r.customer.phone ? formatPhone(r.customer.phone) : null,
        partySize: r.partySize,
        status: guestStatus({ accessStatus: r.accessStatus, checkedIn: r.checkIns.length > 0 }),
        source: guestSource(r.channel),
        promoterName: promoter ? null : r.prMembershipId ? (names.get(r.prMembershipId) ?? "PR") : null,
        note: promoter ? null : r.note,
        checkedInAt: r.checkIns[0]?.checkedInAt ?? null,
        admittedCount: r.checkIns[0]?.admittedCount ?? null,
        hasPass: r.passes.length > 0,
        createdAt: r.createdAt,
      }),
    ),
  };
}

/** Yönetim için PR seçenekleri (misafir eklerken atama). */
export async function listPromoterOptions(ctx: ServiceContext) {
  assertCan(ctx, "promoter.guests");
  if (isPromoter(ctx)) return [];
  const rows = await db.membership.findMany({
    where: { tenantId: ctx.tenantId, role: "PR", status: "ACTIVE" },
    select: { id: true, user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ membershipId: r.id, name: r.user.name }));
}

// ─────────────────────────────────────────────── Misafir ekleme

const guestSchema = z.object({
  firstName: z.string().trim().min(1, "Ad zorunludur.").max(80, "Ad en fazla 80 karakter olabilir."),
  lastName: z.string().trim().min(1, "Soyad zorunludur.").max(80, "Soyad en fazla 80 karakter olabilir."),
  // libphonenumber-js ile doğrulanır ve E.164'e çevrilir (varsayılan ülke TR).
  phone: z
    .string()
    .trim()
    .min(1, "Telefon numarası zorunludur.")
    .max(32, "Telefon numarası çok uzun.")
    .transform((value, ctx) => {
      const result = normalizePhone(value);
      if (!result || !result.ok) {
        ctx.addIssue({ code: "custom", message: "Geçerli bir telefon numarası girin (ör. 0532 123 45 67)." });
        return z.NEVER;
      }
      return result.e164;
    }),
  partySize: z.coerce
    .number({ error: "Kişi sayısı girin." })
    .int("Kişi sayısı tam sayı olmalı.")
    .min(1, "Kişi sayısı en az 1 olmalı.")
    .max(MAX_PARTY_SIZE, `Kişi sayısı en fazla ${MAX_PARTY_SIZE} olabilir.`),
  note: z.string().trim().max(300, "Not en fazla 300 karakter olabilir.").default(""),
  source: z.string().trim().default(""),
  promoterMembershipId: z.string().trim().max(64).default(""),
});

export type AddGuestResult = { registrationId: string; status: GuestStatus; existingCustomer: boolean | null };

const DUPLICATE_MESSAGE = "Bu telefon numarasıyla bu etkinlikte zaten kayıt var.";

/**
 * Etkinliğe misafir ekler. Aynı telefon numarasıyla aynı etkinliğe ikinci kayıt engellenir
 * (servis kontrolü + tenant içinde tekil telefon + etkinlik başına tekil müşteri).
 * Numara CRM'de kayıtlıysa mevcut müşteri kullanılır, bilgileri değiştirilmez.
 * Misafir eklemek iletişim izni veya üyelik oluşturmaz.
 */
export async function addGuestToEvent(ctx: ServiceContext, eventId: string, raw: unknown, now = new Date()): Promise<AddGuestResult> {
  assertCan(ctx, "promoter.guests");
  const parsed = guestSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  const promoter = isPromoter(ctx);
  const errors: FieldErrors = {};

  // PR her zaman kendi adına ekler; yönetim kaynağı ve PR'ı seçebilir.
  let source: GuestSource = "PROMOTER";
  let promoterMembershipId: string | null = promoter ? ctx.membershipId : null;
  if (!promoter) {
    if (v.source && !isOneOf(GUEST_SOURCES, v.source)) errors.source = ["Geçerli bir kaynak seçin."];
    source = isOneOf(GUEST_SOURCES, v.source) ? v.source : "ORGANIC";
    if (source === "PROMOTER") {
      const membership = v.promoterMembershipId
        ? await db.membership.findFirst({ where: { id: v.promoterMembershipId, tenantId: ctx.tenantId, role: "PR", status: "ACTIVE" } })
        : null;
      if (!membership) errors.promoterMembershipId = ["Geçerli bir PR seçin."];
      promoterMembershipId = membership?.id ?? null;
    }
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const event = await findGuestEvent(ctx, eventId);
  if (event.status === "CANCELLED") throw new ConflictError("İptal edilmiş etkinliğe misafir eklenemez.", "EVENT_CANCELLED");
  if (event.endsAt < now) throw new ConflictError("Sona ermiş etkinliğe misafir eklenemez.", "EVENT_ENDED");

  const mapping = SOURCE_MAPPING[source];
  const firstName = cleanText(v.firstName);
  const lastName = cleanText(v.lastName);

  try {
    return await db.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone: v.phone } });
      if (customer?.archivedAt) {
        throw new ConflictError(
          promoter ? "Bu numarayla misafir eklenemiyor; yöneticinize başvurun." : "Bu numara arşivdeki bir müşteriye ait; önce müşteriyi arşivden çıkarın.",
          "CUSTOMER_ARCHIVED",
        );
      }

      const existing = customer
        ? await tx.eventRegistration.findUnique({
            where: { eventId_customerId: { eventId: event.id, customerId: customer.id } },
            include: { checkIns: { select: { id: true } } },
          })
        : null;
      if (existing && (existing.accessStatus === "ACTIVE" || existing.checkIns.length > 0)) {
        throw new ConflictError(DUPLICATE_MESSAGE, "DUPLICATE");
      }
      if (existing && promoter) {
        throw new ConflictError("Bu numaranın bu etkinlikteki kaydı iptal edilmiş; yeniden eklemek için yöneticinize başvurun.", "REGISTRATION_CANCELLED");
      }

      if (event.capacity !== null) {
        const agg = await tx.eventRegistration.aggregate({
          where: { eventId: event.id, accessStatus: "ACTIVE" },
          _sum: { partySize: true },
        });
        const people = agg._sum.partySize ?? 0;
        if (people + v.partySize > event.capacity) {
          throw new ConflictError(
            promoter ? "Etkinliğin kapasitesi dolu; bu kişi sayısıyla misafir eklenemiyor." : `Kapasite aşılıyor: ${event.capacity} kişilik kapasitenin ${people} kişisi dolu.`,
            "CAPACITY_EXCEEDED",
          );
        }
      }

      let customerId = customer?.id ?? null;
      let customerName = customer ? fullName(customer) : `${firstName} ${lastName}`;
      if (!customerId) {
        const created = await tx.customer.create({
          data: {
            tenantId: ctx.tenantId,
            firstName,
            lastName,
            searchName: foldText(`${firstName} ${lastName}`),
            phone: v.phone,
            source: mapping.customerSource,
            sourceVenueId: event.venueId,
            sourceMembershipId: promoterMembershipId,
            createdByUserId: ctx.userId,
          },
        });
        customerId = created.id;
        customerName = fullName(created);
        await logActivity(tx, ctx, {
          action: "customer.created",
          entityType: "customer",
          entityId: created.id,
          customerId: created.id,
          eventId: event.id,
          metadata: { customerName, sourceLabel: `Misafir listesi: ${event.name}` },
        });
      }

      const data = {
        partySize: v.partySize,
        channel: mapping.channel,
        prMembershipId: promoterMembershipId,
        addedByUserId: ctx.userId,
        note: v.note || null,
      };
      const meta = { customerName, eventName: event.name, partySize: v.partySize };
      const registration = existing
        ? await tx.eventRegistration.update({
            where: { id: existing.id },
            data: { ...data, accessStatus: "ACTIVE", cancelledAt: null },
          })
        : await tx.eventRegistration.create({
            data: {
              ...data,
              tenantId: ctx.tenantId,
              eventId: event.id,
              customerId,
              completionStatus: "STAFF_ENTERED",
              accessStatus: "ACTIVE",
            },
          });
      await logActivity(tx, ctx, {
        action: existing ? "registration.reactivated" : "registration.added",
        entityType: "registration",
        entityId: registration.id,
        customerId,
        eventId: event.id,
        metadata: meta,
      });

      return {
        registrationId: registration.id,
        status: "PENDING",
        // PR'a numaranın CRM'de kayıtlı olup olmadığı söylenmez.
        existingCustomer: promoter ? null : !!customer,
      } as AddGuestResult;
    }, SERIALIZABLE);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(DUPLICATE_MESSAGE, "DUPLICATE");
    throw error;
  }
}

// ─────────────────────────────────────────────── Giriş QR'ı

export type GuestPassResult = PassShare & { state: PassState; stateLabel: string; guestName: string; eventName: string };

/**
 * Misafirin giriş QR'ını getirir veya oluşturur (mevcut güvenli pass sistemi; token DB'de özet olarak saklanır).
 * PR yalnızca kendi getirdiği misafir için QR alabilir.
 */
export async function getOrIssueGuestPass(
  ctx: ServiceContext,
  registrationId: string,
  opts: { reissue?: boolean } = {},
  now = new Date(),
): Promise<GuestPassResult> {
  assertCan(ctx, "promoter.guests");
  if (!registrationId) throw new ValidationError({ registrationId: ["Misafir seçin."] });
  const promoter = isPromoter(ctx);
  const reg = await db.eventRegistration.findFirst({
    where: {
      id: registrationId,
      tenantId: ctx.tenantId,
      ...registrationScope(ctx),
      event: { ...venueScope(ctx), ...(promoter ? { status: { not: "DRAFT" } } : {}) },
    },
    include: {
      event: true,
      customer: { select: { firstName: true, lastName: true, sourceMembershipId: true } },
      checkIns: { select: { id: true } },
    },
  });
  if (!reg) throw new NotFoundError("Misafir bulunamadı.");
  if (reg.event.status === "CANCELLED") throw new ConflictError("Etkinlik iptal edildiği için QR oluşturulamaz.", "EVENT_CANCELLED");
  if (reg.accessStatus !== "ACTIVE") throw new ConflictError("Misafir kaydı iptal edildiği için QR oluşturulamaz.", "REGISTRATION_CANCELLED");
  if (entryWindow(reg.event).closesAt < now) throw new ConflictError("Giriş süresi dolmuş etkinlik için QR oluşturulamaz.", "EXPIRED");

  const guestName = promoter ? promoterVisibleName(ctx, reg.customer) : fullName(reg.customer);
  const pass = await db.$transaction(async (tx) => {
    const existing = await tx.pass.findFirst({
      where: { tenantId: ctx.tenantId, purpose: "EVENT_ENTRY", registrationId: reg.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (existing && !opts.reissue) return existing;
    if (reg.checkIns.length > 0) {
      if (existing) return existing;
      throw new ConflictError("Bu misafirin girişi zaten kaydedildi; yeni QR gerekmez.", "ALREADY_CHECKED_IN");
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
      metadata: { customerName: fullName(reg.customer), eventName: reg.event.name, purpose: "EVENT_ENTRY" },
    });
    return created;
  }, SERIALIZABLE);

  const state = evaluateEntryPass(pass, reg, reg.event, now);
  return { ...sharePass(pass), state, stateLabel: PASS_STATE_LABELS[state], guestName, eventName: reg.event.name };
}
