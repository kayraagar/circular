import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, canAccessVenue, venueScope, type ServiceContext } from "@/lib/authz";
import { APP_TIME_ZONE, parseLocalDateTime } from "@/lib/datetime";
import { CHANNELS, CUSTOMER_SOURCE_LABELS, labelOf, type Channel } from "@/lib/domain";
import { CAMPAIGN_CHANNELS, deliveryTotals, MESSAGE_STATUSES, type CampaignChannel, type StatusCounts } from "@/modules/campaigns/rules";

/**
 * Raporlar — hepsi kayıtlardan anlık hesaplanır, önbelleğe alınmaz.
 * Yalnızca gerçekten ölçülen veriler: kapıdaki girişler, kayıtlar, müşteri kazanımı,
 * avantaj kullanımı, PR katkısı ve kampanya gönderim sonuçları.
 * Ölçülmeyenler (menü görüntüleme, ciro, kampanya dönüşümü) burada tahmin edilmez.
 */

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function parseReportPeriod(value: unknown): ReportPeriod {
  const n = Number(value);
  return (REPORT_PERIODS as readonly number[]).includes(n) ? (n as ReportPeriod) : 30;
}

const DAY_MS = 24 * 3600 * 1000;

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export const WEEKDAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Istanbul saatine göre gün anahtarı, saat ve haftanın günü. */
function zoned(date: Date) {
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    weekday: WEEKDAY_INDEX[p.weekday ?? "Mon"] ?? 0,
  };
}

export type SeriesPoint = { day: string; label: string; value: number };
export type Bucket = { label: string; value: number };
export type Delta = { current: number; previous: number };

const dayLabel = new Intl.DateTimeFormat("tr-TR", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short" });

/** Dönem için boş gün serisi (bugün dahil, eski → yeni). */
function emptySeries(days: number, now: Date): SeriesPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(now.getTime() - (days - 1 - i) * DAY_MS);
    return { day: zoned(date).day, label: dayLabel.format(date), value: 0 };
  });
}

function fill(series: SeriesPoint[], rows: { at: Date; value: number }[]): SeriesPoint[] {
  const index = new Map(series.map((p, i) => [p.day, i]));
  for (const row of rows) {
    const i = index.get(zoned(row.at).day);
    if (i !== undefined) series[i].value += row.value;
  }
  return series;
}

export type ReportData = Awaited<ReturnType<typeof getReports>>;

export async function getReports(ctx: ServiceContext, opts: { periodDays: ReportPeriod; venueId?: string | null }, now = new Date()) {
  assertCan(ctx, "reports.view");
  const days = opts.periodDays;
  // Dönem, Istanbul gününe göre başlar (sunucunun saat dilimi ne olursa olsun).
  const startOfDay = (date: Date) => parseLocalDateTime(`${zoned(date).day}T00:00`) ?? date;
  const from = startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  const prevFrom = startOfDay(new Date(from.getTime() - days * DAY_MS));

  const venueId = opts.venueId && canAccessVenue(ctx, opts.venueId) ? opts.venueId : null;
  const eventWhere: Prisma.EventWhereInput = { tenantId: ctx.tenantId, ...venueScope(ctx), ...(venueId ? { venueId } : {}) };
  const customerBase: Prisma.CustomerWhereInput = { tenantId: ctx.tenantId, archivedAt: null };

  const [checkIns, prevCheckIns, newCustomers, prevNewCustomerCount, registrations, prevRegistrationCount, redemptions, prevRedemptionCount, endedEvents, consents, revoked, campaignMessages] =
    await Promise.all([
      db.checkIn.findMany({
        where: { tenantId: ctx.tenantId, checkedInAt: { gte: from }, event: eventWhere },
        select: { checkedInAt: true, admittedCount: true, customerId: true },
      }),
      db.checkIn.aggregate({
        where: { tenantId: ctx.tenantId, checkedInAt: { gte: prevFrom, lt: from }, event: eventWhere },
        _sum: { admittedCount: true },
      }),
      db.customer.findMany({ where: { ...customerBase, createdAt: { gte: from } }, select: { createdAt: true, source: true } }),
      db.customer.count({ where: { ...customerBase, createdAt: { gte: prevFrom, lt: from } } }),
      db.eventRegistration.findMany({
        where: { tenantId: ctx.tenantId, accessStatus: "ACTIVE", createdAt: { gte: from }, event: eventWhere },
        select: { createdAt: true, partySize: true, channel: true, prMembershipId: true, checkIns: { select: { admittedCount: true } } },
      }),
      db.eventRegistration.count({ where: { tenantId: ctx.tenantId, accessStatus: "ACTIVE", createdAt: { gte: prevFrom, lt: from }, event: eventWhere } }),
      db.perkRedemption.findMany({
        where: { tenantId: ctx.tenantId, redeemedAt: { gte: from }, ...(venueId ? { perk: { OR: [{ venueId }, { venueId: null }] } } : {}) },
        select: { redeemedAt: true, perk: { select: { name: true } } },
      }),
      db.perkRedemption.count({ where: { tenantId: ctx.tenantId, redeemedAt: { gte: prevFrom, lt: from } } }),
      db.event.findMany({
        where: { ...eventWhere, status: "PUBLISHED", endsAt: { gte: from, lte: now } },
        select: {
          id: true,
          name: true,
          startsAt: true,
          capacity: true,
          venue: { select: { name: true } },
          registrations: { where: { accessStatus: "ACTIVE" }, select: { partySize: true } },
          checkIns: { select: { admittedCount: true } },
        },
        orderBy: { startsAt: "desc" },
        take: 12,
      }),
      db.contactConsent.groupBy({ by: ["channel", "status"], where: { tenantId: ctx.tenantId, customer: { archivedAt: null } }, _count: { _all: true } }),
      db.contactConsent.count({ where: { tenantId: ctx.tenantId, status: "REVOKED", revokedAt: { gte: from } } }),
      db.campaignMessage.findMany({
        where: { tenantId: ctx.tenantId, campaign: { mode: "LIVE" }, createdAt: { gte: from } },
        select: { status: true, openedAt: true, campaign: { select: { channel: true } } },
      }),
    ]);

  // ── Günlük seriler
  const visitSeries = fill(emptySeries(days, now), checkIns.map((c) => ({ at: c.checkedInAt, value: c.admittedCount })));
  const customerSeries = fill(emptySeries(days, now), newCustomers.map((c) => ({ at: c.createdAt, value: 1 })));
  const registrationSeries = fill(emptySeries(days, now), registrations.map((r) => ({ at: r.createdAt, value: r.partySize })));

  // ── Saat ve gün dağılımı (yalnızca gerçek girişler)
  const hourly: Bucket[] = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}`, value: 0 }));
  const weekly: Bucket[] = WEEKDAY_LABELS.map((label) => ({ label, value: 0 }));
  for (const c of checkIns) {
    const z = zoned(c.checkedInAt);
    hourly[z.hour].value += c.admittedCount;
    weekly[z.weekday].value += c.admittedCount;
  }

  const admitted = checkIns.reduce((n, c) => n + c.admittedCount, 0);
  const invitedPeople = registrations.reduce((n, r) => n + r.partySize, 0);
  const registrationsAdmitted = registrations.reduce((n, r) => n + (r.checkIns[0]?.admittedCount ?? 0), 0);
  const uniqueVisitors = new Set(checkIns.map((c) => c.customerId)).size;
  const returning = checkIns.length - uniqueVisitors;

  // ── Etkinlikler (biten etkinliklerde davetli → gerçek giriş)
  const events = endedEvents
    .map((e) => {
      const people = e.registrations.reduce((n, r) => n + r.partySize, 0);
      const came = e.checkIns.reduce((n, c) => n + c.admittedCount, 0);
      return {
        id: e.id,
        name: e.name,
        venueName: e.venue.name,
        startsAt: e.startsAt,
        people,
        admitted: came,
        capacity: e.capacity,
        rate: people > 0 ? came / people : 0,
      };
    })
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  // ── Müşteri kazanım kaynakları (dönem içinde eklenenler)
  const sourceCounts = new Map<string, number>();
  for (const c of newCustomers) sourceCounts.set(c.source, (sourceCounts.get(c.source) ?? 0) + 1);
  const sources: Bucket[] = [...sourceCounts.entries()]
    .map(([source, value]) => ({ label: labelOf(CUSTOMER_SOURCE_LABELS, source), value }))
    .sort((a, b) => b.value - a.value);

  // ── Guest kanalı: kim getirdi
  const prPeople = registrations.filter((r) => r.prMembershipId).reduce((n, r) => n + r.partySize, 0);
  const walkInPeople = registrations.filter((r) => r.channel === "WALK_IN").reduce((n, r) => n + r.partySize, 0);
  const guestMix: Bucket[] = [
    { label: "PR", value: prPeople },
    { label: "Kapıda", value: walkInPeople },
    { label: "Diğer", value: Math.max(0, invitedPeople - prPeople - walkInPeople) },
  ].filter((b) => b.value > 0);

  // ── PR katkısı (dönem içindeki kayıtlar)
  const prIds = [...new Set(registrations.map((r) => r.prMembershipId).filter((x): x is string => x !== null))];
  const prMembers = prIds.length
    ? await db.membership.findMany({ where: { id: { in: prIds }, tenantId: ctx.tenantId }, select: { id: true, user: { select: { name: true } } } })
    : [];
  const promoters = prMembers
    .map((m) => {
      const own = registrations.filter((r) => r.prMembershipId === m.id);
      return {
        name: m.user.name,
        people: own.reduce((n, r) => n + r.partySize, 0),
        admitted: own.reduce((n, r) => n + (r.checkIns[0]?.admittedCount ?? 0), 0),
      };
    })
    .sort((a, b) => b.admitted - a.admitted || b.people - a.people)
    .slice(0, 6);

  // ── Avantajlar
  const perkCounts = new Map<string, number>();
  for (const r of redemptions) perkCounts.set(r.perk.name, (perkCounts.get(r.perk.name) ?? 0) + 1);
  const perks: Bucket[] = [...perkCounts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);

  // ── İzinler
  const granted = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<Channel, number>;
  for (const g of consents) if (g.status === "GRANTED" && g.channel in granted) granted[g.channel as Channel] = g._count._all;

  // ── Kampanya gönderimleri (kanal bazında gerçek durumlar)
  const campaigns = CAMPAIGN_CHANNELS.map((channel) => {
    const rows = campaignMessages.filter((m) => m.campaign.channel === channel);
    const counts = Object.fromEntries(MESSAGE_STATUSES.map((s) => [s, 0])) as StatusCounts;
    for (const r of rows) if (r.status in counts) counts[r.status as keyof StatusCounts] += 1;
    const totals = deliveryTotals(counts);
    return {
      channel: channel as CampaignChannel,
      accepted: totals.accepted,
      delivered: totals.delivered,
      read: totals.read,
      opened: rows.filter((r) => r.openedAt !== null).length,
      problems: totals.problems,
    };
  }).filter((c) => c.accepted > 0 || c.problems > 0);

  return {
    periodDays: days,
    from,
    to: now,
    totals: {
      admitted: { current: admitted, previous: prevCheckIns._sum.admittedCount ?? 0 } satisfies Delta,
      newCustomers: { current: newCustomers.length, previous: prevNewCustomerCount } satisfies Delta,
      registrations: { current: registrations.length, previous: prevRegistrationCount } satisfies Delta,
      redemptions: { current: redemptions.length, previous: prevRedemptionCount } satisfies Delta,
      invitedPeople,
      registrationsAdmitted,
      showRate: invitedPeople > 0 ? registrationsAdmitted / invitedPeople : 0,
      uniqueVisitors,
      returningVisits: returning,
      revokedConsents: revoked,
    },
    series: { visits: visitSeries, customers: customerSeries, registrations: registrationSeries },
    hourly,
    weekly,
    events,
    sources,
    guestMix,
    promoters,
    perks,
    consents: granted,
    campaigns,
  };
}
