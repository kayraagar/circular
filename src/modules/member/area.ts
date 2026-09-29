import "server-only";
import { db } from "@/lib/db";
import { CHANNELS, CHANNEL_LABELS, type Channel } from "@/lib/domain";
import { fullName } from "@/lib/normalize";
import { entryWindow, evaluateEntryPass, evaluatePerkPass, PASS_STATE_LABELS, type PassState } from "@/modules/passes/rules";
import { derivePassToken } from "@/modules/passes/token";
import { preferenceUrl } from "@/modules/preferences/service";
import type { MemberContext } from "./service";

/**
 * Üyelik alanının içeriği: kişinin kendi kayıtları.
 * Yalnızca oturumdaki kişinin verisi okunur — sorgular `customerId` ile sınırlanır.
 */

export type MemberPass = {
  token: string;
  title: string;
  subtitle: string;
  state: PassState;
  stateLabel: string;
  when: Date | null;
};

export type MemberArea = {
  name: string;
  tenantName: string;
  phone: string | null;
  email: string | null;
  phoneVerified: boolean;
  venues: { name: string; joinedAt: Date }[];
  registrations: { eventName: string; venueName: string; startsAt: Date; endsAt: Date; partySize: number; cancelled: boolean }[];
  passes: MemberPass[];
  consents: { channel: Channel; label: string; granted: boolean }[];
  preferenceUrl: string;
};

export async function getMemberArea(ctx: MemberContext, now = new Date()): Promise<MemberArea | null> {
  const customer = await db.customer.findFirst({
    where: { id: ctx.customerId, tenantId: ctx.tenantId },
    include: {
      tenant: { select: { name: true } },
      consents: { select: { channel: true, status: true } },
      venueMemberships: { where: { status: "ACTIVE" }, include: { venue: { select: { name: true } } }, orderBy: { joinedAt: "desc" } },
      registrations: {
        where: { event: { endsAt: { gte: new Date(now.getTime() - 7 * 864e5) } } },
        include: { event: { select: { name: true, startsAt: true, endsAt: true, entryClosesAt: true, status: true, venue: { select: { name: true } } } } },
        orderBy: { event: { startsAt: "asc" } },
      },
      passes: {
        where: { revokedAt: null },
        include: {
          perk: true,
          registration: { include: { event: { select: { name: true, startsAt: true, endsAt: true, entryClosesAt: true, status: true } } } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer || customer.anonymizedAt) return null;

  const granted = new Set(customer.consents.filter((c) => c.status === "GRANTED").map((c) => c.channel));
  const redemptionCounts = new Map<string, number>();
  for (const pass of customer.passes) {
    if (!pass.perkId) continue;
    redemptionCounts.set(
      pass.perkId,
      await db.perkRedemption.count({ where: { tenantId: ctx.tenantId, perkId: pass.perkId, customerId: customer.id } }),
    );
  }

  const passes: MemberPass[] = [];
  for (const pass of customer.passes) {
    if (pass.purpose === "EVENT_ENTRY" && pass.registration) {
      const event = pass.registration.event;
      // Geçmiş etkinliklerin QR'ı listede yer kaplamasın.
      if (entryWindow(event).closesAt < now) continue;
      const state = evaluateEntryPass(pass, pass.registration, event, now);
      passes.push({
        token: derivePassToken(pass.id),
        title: event.name,
        subtitle: "Giriş QR'ı",
        state,
        stateLabel: PASS_STATE_LABELS[state],
        when: event.startsAt,
      });
    } else if (pass.purpose === "PERK_REDEMPTION" && pass.perk) {
      const state = evaluatePerkPass(pass, pass.perk, redemptionCounts.get(pass.perkId ?? "") ?? 0, now);
      if (state === "LIMIT_REACHED" || state === "PERK_INACTIVE" || state === "REVOKED") continue;
      passes.push({
        token: derivePassToken(pass.id),
        title: pass.perk.name,
        subtitle: "Avantaj QR'ı",
        state,
        stateLabel: PASS_STATE_LABELS[state],
        when: pass.perk.validUntil,
      });
    }
  }

  return {
    name: fullName(customer),
    tenantName: customer.tenant.name,
    phone: customer.phone,
    email: customer.email,
    phoneVerified: customer.phoneVerifiedAt !== null,
    venues: customer.venueMemberships.map((m) => ({ name: m.venue.name, joinedAt: m.joinedAt })),
    registrations: customer.registrations
      .filter((r) => r.event.status !== "DRAFT")
      .map((r) => ({
        eventName: r.event.name,
        venueName: r.event.venue.name,
        startsAt: r.event.startsAt,
        endsAt: r.event.endsAt,
        partySize: r.partySize,
        cancelled: r.accessStatus !== "ACTIVE" || r.event.status === "CANCELLED",
      })),
    passes,
    consents: CHANNELS.map((channel) => ({ channel, label: CHANNEL_LABELS[channel], granted: granted.has(channel) })),
    preferenceUrl: preferenceUrl(customer.id),
  };
}
