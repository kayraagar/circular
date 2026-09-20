import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, canAccessVenue, venueScope, type ServiceContext } from "@/lib/authz";
import { CHANNELS, type Channel } from "@/lib/domain";
import { listActivity } from "@/modules/activity/service";
import { registrationStats } from "@/modules/events/service";

export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

export function parsePeriod(value: unknown): PeriodDays {
  const n = Number(value);
  return (PERIODS as readonly number[]).includes(n) ? (n as PeriodDays) : 30;
}

/**
 * Dashboard metrikleri — hepsi kayıtlardan anlık hesaplanır, önbelleğe alınmaz.
 * Check-in, gelir ve kampanya dönüşümü Faz 1'de ölçülmediği için burada YOKTUR.
 */
export async function getDashboard(ctx: ServiceContext, opts: { periodDays: PeriodDays; venueId: string | null }) {
  assertCan(ctx, "dashboard.view");
  const now = new Date();
  const dayMs = 24 * 3600 * 1000;
  const from = new Date(now.getTime() - opts.periodDays * dayMs);
  const prevFrom = new Date(from.getTime() - opts.periodDays * dayMs);

  const venueId = opts.venueId && canAccessVenue(ctx, opts.venueId) ? opts.venueId : null;
  const eventWhere: Prisma.EventWhereInput = {
    tenantId: ctx.tenantId,
    ...venueScope(ctx),
    ...(venueId ? { venueId } : {}),
  };
  const customerBase = { tenantId: ctx.tenantId, archivedAt: null };

  const [
    totalCustomers,
    newCustomers,
    prevNewCustomers,
    upcomingCount,
    upcoming,
    periodRegistrations,
    sourceGroups,
    consentGroups,
    activity,
  ] = await Promise.all([
    db.customer.count({ where: customerBase }),
    db.customer.count({ where: { ...customerBase, createdAt: { gte: from } } }),
    db.customer.count({ where: { ...customerBase, createdAt: { gte: prevFrom, lt: from } } }),
    db.event.count({ where: { ...eventWhere, status: { not: "CANCELLED" }, endsAt: { gte: now } } }),
    db.event.findMany({
      where: { ...eventWhere, status: { not: "CANCELLED" }, endsAt: { gte: now } },
      include: { venue: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
      take: 5,
    }),
    db.eventRegistration.aggregate({
      where: { tenantId: ctx.tenantId, accessStatus: "ACTIVE", createdAt: { gte: from }, event: eventWhere },
      _count: { _all: true },
      _sum: { partySize: true },
    }),
    db.customer.groupBy({ by: ["source"], where: customerBase, _count: { _all: true } }),
    db.contactConsent.groupBy({
      by: ["channel"],
      where: { tenantId: ctx.tenantId, status: "GRANTED", customer: { archivedAt: null } },
      _count: { _all: true },
    }),
    listActivity(ctx, { limit: 8 }),
  ]);

  const stats = await registrationStats(ctx.tenantId, upcoming.map((e) => e.id));
  const consents = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<Channel, number>;
  for (const g of consentGroups) if (g.channel in consents) consents[g.channel as Channel] = g._count._all;

  return {
    periodDays: opts.periodDays,
    venueId,
    totalCustomers,
    newCustomers,
    prevNewCustomers,
    upcomingCount,
    upcoming: upcoming.map((e) => ({ ...e, ...(stats.get(e.id) ?? { registrations: 0, people: 0 }) })),
    periodRegistrations: {
      count: periodRegistrations._count._all,
      people: periodRegistrations._sum.partySize ?? 0,
    },
    sources: sourceGroups
      .map((g) => ({ source: g.source, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    consents,
    activity: activity.items,
  };
}
