import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, isUniqueViolation } from "@/lib/db";
import { assertCan, venueScope, type ServiceContext } from "@/lib/authz";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanText, foldText, fullName, normalizePhone } from "@/lib/normalize";
import { qrSvgPath } from "@/lib/qr/encoder";
import { createRateLimiter } from "@/lib/rate-limit";
import { logActivity } from "@/modules/activity/service";
import { SERIALIZABLE, createPass } from "@/modules/passes/internal";
import { absoluteUrl, derivePassToken } from "@/modules/passes/token";
import { summarizeGuests } from "./status";

/**
 * PR davet linki.
 *
 * - PR, yayındaki bir etkinlik için kendine özel link (ve bu linkin QR'ını) oluşturur; yenileyince eskisi iptal olur.
 * - Misafir linkten ad, soyad, telefon ve kişi sayısıyla kaydını yapar; kayıt PR'a atfedilir (kanal PR_REFERRAL).
 * - Yeni kişiye giriş QR'ı hemen verilir. Numara işletmede zaten kayıtlıysa kayıt alınır ama QR ekranda
 *   GÖSTERİLMEZ: telefon doğrulaması olmadığından başkasının numarasını yazan kişi o müşterinin adını
 *   veya giriş hakkını ele geçiremez. PR bu misafir için QR'ı kendi listesinden iletebilir.
 * - Aynı numarayla aynı etkinliğe ikinci kayıt ve iptal edilmiş kaydın yeniden açılması engellenir.
 * - Kayıt penceresi (registrationOpensAt/ClosesAt), kapasite, bal küpü alanı ve hız sınırı uygulanır.
 * - Link sahibi PR pasife alınır veya işletme askıya alınırsa link çalışmaz.
 */

export const INVITE_MAX_PARTY = 10;
const CODE = /^[A-Za-z0-9_-]{22}$/;

export function invitePath(code: string) {
  return `/davet/${code}`;
}

function newCode() {
  return randomBytes(16).toString("base64url"); // 128 bit, 22 karakter
}

type EventWindow = { status: string; endsAt: Date; registrationOpensAt: Date | null; registrationClosesAt: Date | null };

export type InviteAvailability = { state: "OPEN" } | { state: "NOT_YET"; opensAt: Date } | { state: "CLOSED"; reason: string };

function availability(event: EventWindow, now: Date): InviteAvailability {
  if (event.status === "CANCELLED") return { state: "CLOSED", reason: "Etkinlik iptal edildi." };
  if (event.status !== "PUBLISHED") return { state: "CLOSED", reason: "Etkinlik yayında değil." };
  if (event.endsAt < now) return { state: "CLOSED", reason: "Etkinlik sona erdi." };
  if (event.registrationClosesAt && event.registrationClosesAt < now) return { state: "CLOSED", reason: "Kayıtlar kapandı." };
  if (event.registrationOpensAt && event.registrationOpensAt > now) return { state: "NOT_YET", opensAt: event.registrationOpensAt };
  return { state: "OPEN" };
}

// ─────────────────────────────────────────────── PR tarafı

function assertPromoter(ctx: ServiceContext) {
  assertCan(ctx, "promoter.guests");
  if (ctx.role !== "PR") throw new ForbiddenError("Davet linki PR hesaplarına özeldir.");
}

async function findPromoterEvent(ctx: ServiceContext, eventId: string) {
  if (!eventId) throw new NotFoundError("Etkinlik bulunamadı.");
  const event = await db.event.findFirst({ where: { id: eventId, tenantId: ctx.tenantId, ...venueScope(ctx), status: { not: "DRAFT" } } });
  if (!event) throw new NotFoundError("Etkinlik bulunamadı.");
  return event;
}

export type InviteLinkView = {
  code: string;
  url: string;
  qr: { viewBox: number; d: string };
  createdAt: Date;
  availability: InviteAvailability;
  /** Bu PR'ın bu etkinlikte davet linkleriyle (yenilenenler dahil) aldığı kayıtlar */
  stats: { registrations: number; people: number; admitted: number };
};

export async function getMyInviteLink(ctx: ServiceContext, eventId: string, now = new Date()): Promise<InviteLinkView | null> {
  assertPromoter(ctx);
  const event = await findPromoterEvent(ctx, eventId);
  const link = await db.prInviteLink.findFirst({
    where: { tenantId: ctx.tenantId, eventId: event.id, membershipId: ctx.membershipId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!link) return null;

  const rows = await db.eventRegistration.findMany({
    where: { tenantId: ctx.tenantId, eventId: event.id, prMembershipId: ctx.membershipId, channel: "PR_REFERRAL" },
    select: { accessStatus: true, partySize: true, checkIns: { select: { admittedCount: true } } },
  });
  const s = summarizeGuests(rows.map((r) => ({ accessStatus: r.accessStatus, partySize: r.partySize, admittedCount: r.checkIns[0]?.admittedCount ?? null })));
  const url = absoluteUrl(invitePath(link.code));
  return {
    code: link.code,
    url,
    qr: qrSvgPath(url),
    createdAt: link.createdAt,
    availability: availability(event, now),
    stats: { registrations: s.registrations, people: s.people, admitted: s.admitted },
  };
}

/** PR davet linki oluşturur (varsa aynısını döner). rotate: eski linki iptal edip yenisini üretir. */
export async function createInviteLink(ctx: ServiceContext, eventId: string, opts: { rotate?: boolean } = {}, now = new Date()) {
  assertPromoter(ctx);
  const event = await findPromoterEvent(ctx, eventId);
  const open = availability(event, now);
  if (open.state === "CLOSED") throw new ConflictError(`Davet linki oluşturulamaz: ${open.reason}`, "EVENT_NOT_OPEN");

  await db.$transaction(async (tx) => {
    const existing = await tx.prInviteLink.findFirst({
      where: { tenantId: ctx.tenantId, eventId: event.id, membershipId: ctx.membershipId, revokedAt: null },
    });
    if (existing && !opts.rotate) return;
    if (existing) await tx.prInviteLink.updateMany({ where: { tenantId: ctx.tenantId, eventId: event.id, membershipId: ctx.membershipId, revokedAt: null }, data: { revokedAt: now } });
    await tx.prInviteLink.create({ data: { tenantId: ctx.tenantId, eventId: event.id, membershipId: ctx.membershipId, code: newCode() } });
  }, SERIALIZABLE);

  return (await getMyInviteLink(ctx, event.id, now))!;
}

// ─────────────────────────────────────────────── Misafir tarafı (herkese açık)

async function loadInvite(code: string) {
  if (!CODE.test(code)) return null;
  const link = await db.prInviteLink.findUnique({
    where: { code },
    include: {
      event: { include: { venue: { select: { name: true } }, tenant: { select: { name: true, status: true } } } },
      membership: { select: { status: true, role: true, user: { select: { name: true } } } },
    },
  });
  if (!link || link.revokedAt) return null;
  if (link.event.tenant.status !== "ACTIVE") return null;
  if (link.membership.status !== "ACTIVE" || link.membership.role !== "PR") return null;
  if (link.event.status === "DRAFT") return null;
  return link;
}

export type PublicInvite = {
  code: string;
  tenantName: string;
  promoterFirstName: string;
  event: { name: string; venueName: string; startsAt: Date; endsAt: Date };
  availability: InviteAvailability;
};

export async function resolveInvite(code: string, now = new Date()): Promise<PublicInvite | null> {
  const link = await loadInvite(code);
  if (!link) return null;
  return {
    code: link.code,
    tenantName: link.event.tenant.name,
    promoterFirstName: link.membership.user.name.trim().split(/\s+/)[0] ?? "",
    event: { name: link.event.name, venueName: link.event.venue.name, startsAt: link.event.startsAt, endsAt: link.event.endsAt },
    availability: availability(link.event, now),
  };
}

const inviteLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8 });

/** Yalnızca testler için. */
export function resetInviteRateLimit() {
  inviteLimiter.reset();
}

const signupSchema = z.object({
  firstName: z.string().trim().min(1, "Adınızı yazın.").max(80, "Ad en fazla 80 karakter olabilir."),
  lastName: z.string().trim().min(1, "Soyadınızı yazın.").max(80, "Soyad en fazla 80 karakter olabilir."),
  phone: z
    .string()
    .trim()
    .min(1, "Telefon numaranızı yazın.")
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
    .max(INVITE_MAX_PARTY, `Tek kayıtta en fazla ${INVITE_MAX_PARTY} kişi olabilir.`),
});

export type InviteSignupResult =
  | { status: "created"; passToken: string }
  | { status: "registered_existing" }
  | { status: "duplicate" }
  | { status: "blocked" }
  | { status: "ignored" };

export async function registerViaInvite(
  code: string,
  raw: Record<string, unknown>,
  meta: { ip: string },
  now = new Date(),
): Promise<InviteSignupResult> {
  if (!CODE.test(code)) throw new NotFoundError("Davet bulunamadı.");
  const limit = inviteLimiter.hit(`${meta.ip}|${code}`);
  if (!limit.allowed) {
    throw new ConflictError(`Kısa sürede çok fazla deneme yapıldı. ${Math.max(1, Math.ceil(limit.retryAfterSec / 60))} dakika sonra tekrar deneyin.`, "RATE_LIMITED");
  }
  if (typeof raw.website === "string" && raw.website.trim() !== "") return { status: "ignored" };

  const link = await loadInvite(code);
  if (!link) throw new NotFoundError("Bu davet linki geçerli değil.");
  const open = availability(link.event, now);
  if (open.state === "CLOSED") throw new ConflictError(`Kayıt yapılamıyor: ${open.reason}`, "INVITE_CLOSED");
  if (open.state === "NOT_YET") throw new ConflictError("Bu etkinlik için kayıtlar henüz açılmadı.", "INVITE_NOT_YET");

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  const { event } = link;
  const tenantId = link.tenantId;
  const actor = { tenantId, userId: null };
  const firstName = cleanText(v.firstName);
  const lastName = cleanText(v.lastName);

  try {
    return await db.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { tenantId, phone: v.phone } });
      if (customer?.archivedAt) return { status: "blocked" } as const;

      const existing = customer
        ? await tx.eventRegistration.findUnique({
            where: { eventId_customerId: { eventId: event.id, customerId: customer.id } },
            include: { checkIns: { select: { id: true } } },
          })
        : null;
      if (existing && (existing.accessStatus === "ACTIVE" || existing.checkIns.length > 0)) return { status: "duplicate" } as const;
      if (existing) return { status: "blocked" } as const; // iptal edilmiş kayıt linkle yeniden açılmaz

      if (event.capacity !== null) {
        const agg = await tx.eventRegistration.aggregate({ where: { eventId: event.id, accessStatus: "ACTIVE" }, _sum: { partySize: true } });
        if ((agg._sum.partySize ?? 0) + v.partySize > event.capacity) {
          throw new ConflictError("Etkinliğin kapasitesi dolu; bu kişi sayısıyla kayıt yapılamıyor.", "CAPACITY_EXCEEDED");
        }
      }

      let customerId = customer?.id ?? null;
      const customerName = customer ? fullName(customer) : `${firstName} ${lastName}`;
      if (!customerId) {
        const created = await tx.customer.create({
          data: {
            tenantId,
            firstName,
            lastName,
            searchName: foldText(`${firstName} ${lastName}`),
            phone: v.phone,
            source: "PR_REFERRAL",
            sourceVenueId: event.venueId,
            sourceMembershipId: link.membershipId,
          },
        });
        customerId = created.id;
        await logActivity(tx, actor, {
          action: "customer.created",
          entityType: "customer",
          entityId: created.id,
          customerId: created.id,
          eventId: event.id,
          metadata: { customerName, sourceLabel: "PR davet linki" },
        });
      }

      const registration = await tx.eventRegistration.create({
        data: {
          tenantId,
          eventId: event.id,
          customerId,
          partySize: v.partySize,
          channel: "PR_REFERRAL",
          completionStatus: "SELF_COMPLETED",
          accessStatus: "ACTIVE",
          prMembershipId: link.membershipId,
        },
      });
      await logActivity(tx, actor, {
        action: "registration.self_registered",
        entityType: "registration",
        entityId: registration.id,
        customerId,
        eventId: event.id,
        metadata: { customerName, eventName: event.name, partySize: v.partySize, promoterName: link.membership.user.name },
      });

      // Kayıtlı numara: QR ekranda gösterilmez (bkz. modül açıklaması).
      if (customer) return { status: "registered_existing" } as const;

      const pass = await createPass(tx, {
        tenantId,
        purpose: "EVENT_ENTRY",
        customerId,
        registrationId: registration.id,
        maxUses: 1,
        issuedByUserId: null,
      });
      await logActivity(tx, actor, {
        action: "pass.issued",
        entityType: "pass",
        entityId: pass.id,
        customerId,
        eventId: event.id,
        metadata: { customerName, eventName: event.name, purpose: "EVENT_ENTRY" },
      });
      return { status: "created", passToken: derivePassToken(pass.id) } as const;
    }, SERIALIZABLE);
  } catch (error) {
    // Aynı numarayla eşzamanlı ikinci gönderim: ilk kayıt geçerlidir.
    if (isUniqueViolation(error)) return { status: "duplicate" };
    throw error;
  }
}
