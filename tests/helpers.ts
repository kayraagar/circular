import { db } from "@/lib/db";
import type { ServiceContext } from "@/lib/authz";
import type { Role } from "@/lib/domain";
import { toLocalInputValue } from "@/lib/datetime";

export async function resetDb() {
  await db.$transaction([
    db.activityLog.deleteMany(),
    db.instagramReplyLog.deleteMany(),
    db.instagramAutoReply.deleteMany(),
    db.instagramAccount.deleteMany(),
    db.smsAccount.deleteMany(),
    db.emailSettings.deleteMany(),
    db.emailTestRecipient.deleteMany(),
    db.campaignMessage.deleteMany(),
    db.campaign.deleteMany(),
    db.messageTemplate.deleteMany(),
    db.whatsAppAccount.deleteMany(),
    db.messagingTestRecipient.deleteMany(),
    db.prTaskRecipient.deleteMany(),
    db.prTask.deleteMany(),
    db.prInviteLink.deleteMany(),
    db.menuCampaign.deleteMany(),
    db.menuItem.deleteMany(),
    db.menuCategory.deleteMany(),
    db.menuConfig.deleteMany(),
    db.menuAsset.deleteMany(),
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

async function member(tenantId: string, slug: string, role: Role): Promise<ServiceContext> {
  const user = await db.user.create({
    data: { email: `${role.toLowerCase()}@${slug}.test`, name: `${role} ${slug}`, passwordHash: "x" },
  });
  const m = await db.membership.create({ data: { userId: user.id, tenantId, role } });
  return { tenantId, userId: user.id, membershipId: m.id, role, venueIds: null };
}

export async function makeTenant(slug: string) {
  const tenant = await db.tenant.create({ data: { name: `Tenant ${slug}`, slug } });
  const venue = await db.venue.create({
    data: { tenantId: tenant.id, name: `Mekan ${slug}`, slug: `mekan-${slug}`, type: "PUB" },
  });
  return {
    tenant,
    venue,
    owner: await member(tenant.id, slug, "OWNER_ADMIN"),
    crm: await member(tenant.id, slug, "CRM_MANAGER"),
    door: await member(tenant.id, slug, "DOOR"),
    pr: await member(tenant.id, slug, "PR"),
    waiter: await member(tenant.id, slug, "WAITER"),
  };
}

export function localIn(hours: number) {
  return toLocalInputValue(new Date(Date.now() + hours * 3600 * 1000));
}

export function eventInput(venueId: string, extra: Record<string, string> = {}) {
  return {
    name: "Cuma Gecesi",
    venueId,
    startsAt: localIn(48),
    endsAt: localIn(54),
    status: "PUBLISHED",
    ...extra,
  };
}
