import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, venueScope, type ServiceContext } from "@/lib/authz";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { localDayKey } from "@/lib/datetime";
import { formatPhone, fullName } from "@/lib/normalize";
import { customerSearchWhere } from "@/modules/customers/service";
import {
  CAMPAIGN_CHANNELS,
  CONSENTED_SEGMENT,
  MAX_CAMPAIGN_RECIPIENTS,
  MAX_SELECTED_CUSTOMERS,
  SEGMENT_COPY,
  SEGMENT_KEYS,
  SUGGESTED_SEGMENTS,
  type CampaignChannel,
  type ExclusionReason,
  type SegmentKey,
} from "./rules";

/**
 * Kampanya kitlesi: önerilen kitleler, toplu seçim (etiket, etkinliğe gelenler) ve tek tek seçim.
 * Sayılar veritabanında hesaplanır; gönderime uygunluk kanala göredir:
 * WhatsApp/SMS = telefon + o kanalın izni, e-posta = e-posta adresi + e-posta izni.
 * İYS kontrolü gönderim anında (WhatsApp: entegratör, SMS: Netgsm) ayrıca yapılır.
 */

const DAY_MS = 24 * 3600 * 1000;

export type AudienceSpec =
  | { kind: "SEGMENT"; key: SegmentKey }
  | { kind: "TAG"; tagId: string }
  | { kind: "EVENT"; eventId: string }
  | { kind: "SELECTED"; customerIds: string[] };

const id = z.string().trim().min(1).max(40);
const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SEGMENT"), key: z.enum(SEGMENT_KEYS) }),
  z.object({ kind: z.literal("TAG"), tagId: id }),
  z.object({ kind: z.literal("EVENT"), eventId: id }),
  z.object({ kind: z.literal("SELECTED"), customerIds: z.array(id).max(MAX_SELECTED_CUSTOMERS) }),
]);

export function parseAudience(raw: unknown): AudienceSpec {
  const parsed = audienceSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError({ audience: ["Geçerli bir kitle seçin."] });
  const spec = parsed.data;
  if (spec.kind === "SELECTED") {
    const ids = [...new Set(spec.customerIds)];
    if (ids.length === 0) throw new ValidationError({ audience: ["En az bir kişi seçin."] });
    return { kind: "SELECTED", customerIds: ids };
  }
  return spec;
}

/** Kanala göre gönderime uygun: iletişim bilgisi ve o kanalın verilmiş izni olan. */
export function reachableWhere(channel: CampaignChannel): Prisma.CustomerWhereInput {
  return {
    ...(channel === "EMAIL" ? { email: { not: null } } : { phone: { not: null } }),
    consents: { some: { channel, status: "GRANTED" } },
  };
}

/** Kanalın iletişim bilgisi eksik olanlar (telefon veya e-posta yok). */
function missingContactWhere(channel: CampaignChannel): Prisma.CustomerWhereInput {
  return channel === "EMAIL" ? { email: null } : { phone: null };
}

export const WHATSAPP_REACHABLE: Prisma.CustomerWhereInput = reachableWhere("WHATSAPP");

const visitedSince = (since: Date): Prisma.CustomerWhereInput => ({
  OR: [{ checkIns: { some: { checkedInAt: { gte: since } } } }, { perkRedemptions: { some: { redeemedAt: { gte: since } } } }],
});
const everVisited: Prisma.CustomerWhereInput = { OR: [{ checkIns: { some: {} } }, { perkRedemptions: { some: {} } }] };
const neverVisited: Prisma.CustomerWhereInput = { checkIns: { none: {} }, perkRedemptions: { none: {} } };

export function segmentWhere(key: SegmentKey, now: Date): Prisma.CustomerWhereInput {
  const daysAgo = (d: number) => new Date(now.getTime() - d * DAY_MS);
  switch (key) {
    case "WHATSAPP_CONSENTED":
      return { consents: { some: { channel: "WHATSAPP", status: "GRANTED" } } };
    case "SMS_CONSENTED":
      return { consents: { some: { channel: "SMS", status: "GRANTED" } } };
    case "EMAIL_CONSENTED":
      return { consents: { some: { channel: "EMAIL", status: "GRANTED" } } };
    case "LAPSED_30":
    case "LAPSED_60":
    case "LAPSED_90": {
      const since = daysAgo(Number(key.slice(7)));
      return { AND: [everVisited, { NOT: visitedSince(since) }] };
    }
    case "NO_SHOW_RECENT":
      return {
        registrations: {
          some: {
            accessStatus: "ACTIVE",
            checkIns: { none: {} },
            event: { status: "PUBLISHED", endsAt: { gte: daysAgo(30), lte: now } },
          },
        },
      };
    case "NEW_NOT_VISITED":
      return { createdAt: { gte: daysAgo(30) }, ...neverVisited };
    case "BIRTHDAY_THIS_MONTH":
      // birthDate "YYYY-MM-DD": "-09-" yalnızca ay kısmıyla eşleşir
      return { birthDate: { contains: `-${localDayKey(now).slice(5, 7)}-` } };
    case "NOT_MESSAGED_60":
      return { campaignMessages: { none: { campaign: { mode: "LIVE" }, acceptedAt: { gte: daysAgo(60) } } } };
  }
}

async function resolveAudience(ctx: ServiceContext, spec: AudienceSpec, now: Date) {
  const base: Prisma.CustomerWhereInput = { tenantId: ctx.tenantId, archivedAt: null };
  switch (spec.kind) {
    case "SEGMENT":
      return { where: { ...base, AND: [segmentWhere(spec.key, now)] }, label: SEGMENT_COPY[spec.key].label, key: spec.key as string };
    case "TAG": {
      const tag = await db.tag.findFirst({ where: { id: spec.tagId, tenantId: ctx.tenantId }, select: { id: true, name: true } });
      if (!tag) throw new NotFoundError("Etiket bulunamadı.");
      return { where: { ...base, tags: { some: { tagId: tag.id } } }, label: `Etiket: ${tag.name}`, key: tag.id };
    }
    case "EVENT": {
      const event = await db.event.findFirst({ where: { id: spec.eventId, tenantId: ctx.tenantId, ...venueScope(ctx) }, select: { id: true, name: true } });
      if (!event) throw new NotFoundError("Etkinlik bulunamadı.");
      return { where: { ...base, checkIns: { some: { eventId: event.id } } }, label: `${event.name} etkinliğine gelenler`, key: event.id };
    }
    case "SELECTED":
      return { where: { ...base, id: { in: spec.customerIds } }, label: `${spec.customerIds.length} seçili kişi`, key: null };
  }
}

export type AudienceSummary = {
  channel: CampaignChannel;
  label: string;
  key: string | null;
  total: number;
  /** İletişim bilgisi + kanal izni olan (İYS kontrolü öncesi) */
  reachable: number;
  /** Kampanya sınırından sonra kuyruğa alınabilecek */
  sendable: number;
  /** Tahmini ücret için Türkiye (+90) numaraları */
  sendableTr: number;
  exclusions: Partial<Record<ExclusionReason, number>>;
};

export async function summarizeAudience(ctx: ServiceContext, spec: AudienceSpec, now = new Date(), channel: CampaignChannel = "WHATSAPP"): Promise<AudienceSummary> {
  assertCan(ctx, "campaigns.manage");
  const { where, label, key } = await resolveAudience(ctx, spec, now);
  const reachableFilter = reachableWhere(channel);
  const [total, noContact, reachable, reachableTr] = await Promise.all([
    db.customer.count({ where }),
    db.customer.count({ where: { AND: [where, missingContactWhere(channel)] } }),
    db.customer.count({ where: { AND: [where, reachableFilter] } }),
    channel === "EMAIL" ? Promise.resolve(0) : db.customer.count({ where: { AND: [where, reachableFilter, { phone: { startsWith: "+90" } }] } }),
  ]);
  const exclusions: Partial<Record<ExclusionReason, number>> = {};
  if (noContact) exclusions[channel === "EMAIL" ? "NO_EMAIL" : "NO_PHONE"] = noContact;
  if (total - noContact - reachable > 0) exclusions.NO_CONSENT = total - noContact - reachable;
  // SMS yalnızca Türkiye numaralarına gider
  const eligible = channel === "SMS" ? reachableTr : reachable;
  if (channel === "SMS" && reachable > reachableTr) exclusions.FOREIGN_NUMBER = reachable - reachableTr;
  const sendable = Math.min(eligible, MAX_CAMPAIGN_RECIPIENTS);
  if (eligible > sendable) exclusions.LIMIT = eligible - sendable;
  return { channel, label, key, total, reachable, sendable, sendableTr: Math.min(reachableTr, sendable), exclusions };
}

export type SendableCustomer = { id: string; phone: string | null; email: string | null };

/** Gönderim listesi: kanala uygun müşteriler (en fazla kampanya sınırı kadar). */
export async function loadSendableCustomers(ctx: ServiceContext, spec: AudienceSpec, now = new Date(), channel: CampaignChannel = "WHATSAPP") {
  const { where, label, key } = await resolveAudience(ctx, spec, now);
  const customers: SendableCustomer[] = await db.customer.findMany({
    where: { AND: [where, reachableWhere(channel), ...(channel === "SMS" ? [{ phone: { startsWith: "+90" } }] : [])] },
    select: { id: true, phone: true, email: true },
    orderBy: { createdAt: "asc" },
    take: MAX_CAMPAIGN_RECIPIENTS,
  });
  return { label, key, customers };
}

export type SegmentOption = {
  key: SegmentKey;
  label: string;
  description: string;
  total: number;
  /** WhatsApp'ta gönderime uygun (geriye dönük uyumluluk) */
  reachable: number;
  /** Kanal bazında gönderime uygun kişi */
  reachableBy: Record<CampaignChannel, number>;
  note: string | null;
};

/** Kitle seçimi ekranı: önerilen kitleler, etiketler ve yakın zamandaki etkinlikler (gerçek sayılarla). */
export async function getAudienceOptions(ctx: ServiceContext, now = new Date()) {
  assertCan(ctx, "campaigns.manage");
  const base: Prisma.CustomerWhereInput = { tenantId: ctx.tenantId, archivedAt: null };

  const segmentCounts = async (key: SegmentKey): Promise<SegmentOption> => {
    const where = { ...base, AND: [segmentWhere(key, now)] };
    const [total, ...perChannel] = await Promise.all([
      db.customer.count({ where }),
      ...CAMPAIGN_CHANNELS.map((ch) =>
        db.customer.count({ where: { AND: [where, reachableWhere(ch), ...(ch === "SMS" ? [{ phone: { startsWith: "+90" } }] : [])] } }),
      ),
    ]);
    const reachableBy = Object.fromEntries(CAMPAIGN_CHANNELS.map((ch, i) => [ch, perChannel[i]])) as Record<CampaignChannel, number>;
    return { key, ...SEGMENT_COPY[key], total, reachable: reachableBy.WHATSAPP, reachableBy, note: null };
  };

  const [suggested, bulk, liveHistory, tags, events] = await Promise.all([
    Promise.all(SUGGESTED_SEGMENTS.map(segmentCounts)),
    Promise.all(CAMPAIGN_CHANNELS.map((ch) => segmentCounts(CONSENTED_SEGMENT[ch]))),
    db.campaignMessage.count({ where: { tenantId: ctx.tenantId, campaign: { mode: "LIVE" }, acceptedAt: { not: null } } }),
    db.tag.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, name: true, _count: { select: { customers: { where: { customer: { archivedAt: null } } } } } },
      orderBy: { name: "asc" },
    }),
    db.event.findMany({
      where: { tenantId: ctx.tenantId, ...venueScope(ctx), checkIns: { some: {} } },
      select: { id: true, name: true, startsAt: true, venue: { select: { name: true } }, _count: { select: { checkIns: true } } },
      orderBy: { startsAt: "desc" },
      take: 30,
    }),
  ]);

  for (const s of suggested) {
    if (s.key === "NOT_MESSAGED_60" && liveHistory === 0) s.note = "Henüz canlı gönderim yok; şimdilik tüm müşterileri kapsar.";
    if (s.key === "BIRTHDAY_THIS_MONTH") s.note = "Yalnızca doğum tarihi kayıtlı müşteriler.";
  }

  return {
    suggested,
    bulk,
    tags: tags.map((t) => ({ id: t.id, name: t.name, customerCount: t._count.customers })),
    events: events.map((e) => ({ id: e.id, name: e.name, startsAt: e.startsAt, venueName: e.venue.name, checkInCount: e._count.checkIns })),
  };
}

export type AudienceSearchRow = { id: string; name: string; phoneLabel: string; reachable: boolean; reason: ExclusionReason | null };

/** Tek tek seçim için arama (en fazla 20 sonuç). */
export async function searchAudienceCustomers(ctx: ServiceContext, q: string, channel: CampaignChannel = "WHATSAPP"): Promise<AudienceSearchRow[]> {
  assertCan(ctx, "campaigns.manage");
  const search = customerSearchWhere(q);
  if (!search) return [];
  const rows = await db.customer.findMany({
    where: { tenantId: ctx.tenantId, archivedAt: null, ...search },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, consents: { where: { channel, status: "GRANTED" }, select: { id: true } } },
    orderBy: { searchName: "asc" },
    take: 20,
  });
  return rows.map((c) => {
    const reason: ExclusionReason | null =
      channel === "EMAIL"
        ? !c.email
          ? "NO_EMAIL"
          : c.consents.length === 0
            ? "NO_CONSENT"
            : null
        : !c.phone
          ? "NO_PHONE"
          : c.consents.length === 0
            ? "NO_CONSENT"
            : channel === "SMS" && !c.phone.startsWith("+90")
              ? "FOREIGN_NUMBER"
              : null;
    const contact = channel === "EMAIL" ? (c.email ?? "") : formatPhone(c.phone);
    return { id: c.id, name: fullName(c), phoneLabel: contact, reachable: reason === null, reason };
  });
}
