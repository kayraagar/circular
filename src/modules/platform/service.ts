import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { logActivity } from "@/modules/activity/service";

/**
 * Platform yöneticisi konsolu.
 *
 * Yetki tenant rollerinden değil, `User.isPlatformAdmin` bayrağından gelir; bu yüzden
 * kontroller burada ayrıca yapılır (`assertPlatformAdmin`). Platform yöneticisi varsayılan
 * olarak **hiçbir işletmenin müşteri verisini göremez**.
 *
 * Destek erişimi istisnadır ve üç kuralla sınırlıdır:
 *  1. Gerekçe zorunludur.
 *  2. Süreli verilir (en fazla 24 saat) ve süre dolunca arka plan işçisi kapatır.
 *  3. Erişim gerçek bir üyelik açılarak verilir — yetki kontrolleri değişmez — ve hem
 *     platform kaydına hem işletmenin kendi aktivite geçmişine yazılır, yani işletme
 *     kimin ne zaman baktığını görür.
 */

export const MAX_SUPPORT_HOURS = 24;

export type PlatformUser = { id: string; isPlatformAdmin: boolean };

export function assertPlatformAdmin(user: PlatformUser) {
  if (!user.isPlatformAdmin) throw new ForbiddenError();
}

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
  venues: number;
  members: number;
  customers: number;
  events: number;
  /** Son 30 günde kuyruğa alınan kampanya mesajı (kullanım göstergesi). */
  messages30d: number;
  supportAccess: { userName: string; expiresAt: Date; reason: string } | null;
};

export async function listTenants(user: PlatformUser, now = new Date()): Promise<TenantRow[]> {
  assertPlatformAdmin(user);
  const since = new Date(now.getTime() - 30 * 864e5);
  const tenants = await db.tenant.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { venues: true, memberships: true, customers: true, events: true } },
    },
  });
  const [messages, grants] = await Promise.all([
    db.campaignMessage.groupBy({ by: ["tenantId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.supportAccessGrant.findMany({ where: { endedAt: null, expiresAt: { gt: now } } }),
  ]);
  const grantUsers = await db.user.findMany({
    where: { id: { in: [...new Set(grants.map((g) => g.userId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(grantUsers.map((u) => [u.id, u.name]));
  const messageByTenant = new Map(messages.map((m) => [m.tenantId, m._count._all]));

  return tenants.map((t) => {
    const grant = grants.find((g) => g.tenantId === t.id);
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      createdAt: t.createdAt,
      venues: t._count.venues,
      members: t._count.memberships,
      customers: t._count.customers,
      events: t._count.events,
      messages30d: messageByTenant.get(t.id) ?? 0,
      supportAccess: grant ? { userName: nameById.get(grant.userId) ?? "Platform", expiresAt: grant.expiresAt, reason: grant.reason } : null,
    };
  });
}

export type PlatformSummary = { tenants: number; suspended: number; users: number; customers: number; messages30d: number };

export async function getPlatformSummary(user: PlatformUser, now = new Date()): Promise<PlatformSummary> {
  assertPlatformAdmin(user);
  const since = new Date(now.getTime() - 30 * 864e5);
  const [tenants, suspended, users, customers, messages30d] = await Promise.all([
    db.tenant.count(),
    db.tenant.count({ where: { status: "SUSPENDED" } }),
    db.user.count({ where: { isActive: true } }),
    db.customer.count({ where: { archivedAt: null } }),
    db.campaignMessage.count({ where: { createdAt: { gte: since } } }),
  ]);
  return { tenants, suspended, users, customers, messages30d };
}

const suspendSchema = z.object({
  tenantId: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(5, "Gerekçe yazın.").max(300),
});

/**
 * İşletmeyi askıya alır veya yeniden açar. Askıya alınan işletmede kimse panele giremez ve
 * müşteriye açık sayfalar kapanır; veri **silinmez**.
 */
export async function setTenantStatus(user: PlatformUser, raw: Record<string, unknown>, suspend: boolean) {
  assertPlatformAdmin(user);
  const parsed = suspendSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const tenant = await db.tenant.findUnique({ where: { id: parsed.data.tenantId } });
  if (!tenant) throw new NotFoundError("İşletme bulunamadı.");

  const status = suspend ? "SUSPENDED" : "ACTIVE";
  if (tenant.status === status) return tenant;

  return db.$transaction(async (tx) => {
    const updated = await tx.tenant.update({ where: { id: tenant.id }, data: { status } });
    // Askıya alınınca açık oturumlar da düşer.
    if (suspend) {
      const members = await tx.membership.findMany({ where: { tenantId: tenant.id }, select: { userId: true } });
      await tx.session.deleteMany({ where: { userId: { in: members.map((m) => m.userId) } } });
    }
    await logActivity(tx, { tenantId: tenant.id, userId: user.id }, {
      action: suspend ? "platform.tenant_suspended" : "platform.tenant_restored",
      entityType: "tenant",
      entityId: tenant.id,
      metadata: { name: tenant.name, reason: parsed.data.reason },
    });
    return updated;
  });
}

const grantSchema = z.object({
  tenantId: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(5, "Destek erişiminin gerekçesini yazın.").max(300),
  hours: z.coerce.number().int().min(1).max(MAX_SUPPORT_HOURS),
});

/** Süreli destek erişimi verir: gerçek bir OWNER_ADMIN üyeliği açılır ve süre sonunda kapatılır. */
export async function grantSupportAccess(user: PlatformUser, raw: Record<string, unknown>, now = new Date()) {
  assertPlatformAdmin(user);
  const parsed = grantSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const { tenantId, reason, hours } = parsed.data;

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError("İşletme bulunamadı.");
  const open = await db.supportAccessGrant.findFirst({ where: { tenantId, userId: user.id, endedAt: null, expiresAt: { gt: now } } });
  if (open) throw new ConflictError("Bu işletmede zaten açık bir destek erişiminiz var.", "ALREADY_GRANTED");

  const expiresAt = new Date(now.getTime() + hours * 3600_000);
  return db.$transaction(async (tx) => {
    const membership = await tx.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      create: { userId: user.id, tenantId, role: "OWNER_ADMIN", status: "ACTIVE" },
      update: { role: "OWNER_ADMIN", status: "ACTIVE" },
    });
    const grant = await tx.supportAccessGrant.create({
      data: { tenantId, userId: user.id, membershipId: membership.id, reason, expiresAt },
    });
    // İşletme kimin ne zaman baktığını kendi aktivite akışında görür.
    await logActivity(tx, { tenantId, userId: user.id }, {
      action: "platform.support_access_granted",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { reason, expiresAt: expiresAt.toISOString(), hours },
    });
    return grant;
  });
}

/** Destek erişimini kapatır (elle veya süre dolunca). */
export async function endSupportAccess(grantId: string, actorUserId: string | null, now = new Date()) {
  const grant = await db.supportAccessGrant.findUnique({ where: { id: grantId } });
  if (!grant || grant.endedAt) return null;

  return db.$transaction(async (tx) => {
    await tx.supportAccessGrant.update({ where: { id: grant.id }, data: { endedAt: now } });
    if (grant.membershipId) {
      await tx.membership.updateMany({ where: { id: grant.membershipId }, data: { status: "DISABLED" } });
    }
    // Erişim biterse açık oturumdaki kapsam da düşsün.
    await tx.session.updateMany({ where: { userId: grant.userId, activeTenantId: grant.tenantId }, data: { activeTenantId: null } });
    await logActivity(tx, { tenantId: grant.tenantId, userId: actorUserId }, {
      action: "platform.support_access_ended",
      entityType: "tenant",
      entityId: grant.tenantId,
      metadata: { reason: grant.reason, automatic: actorUserId === null },
    });
    return grant;
  });
}

export async function endSupportAccessByAdmin(user: PlatformUser, grantId: string, now = new Date()) {
  assertPlatformAdmin(user);
  const grant = await db.supportAccessGrant.findUnique({ where: { id: grantId } });
  if (!grant) throw new NotFoundError("Destek erişimi bulunamadı.");
  return endSupportAccess(grantId, user.id, now);
}

/** Süresi dolan destek erişimlerini kapatır (kampanya işçisi turunda çağrılır). */
export async function expireSupportAccess(now = new Date()): Promise<number> {
  const due = await db.supportAccessGrant.findMany({ where: { endedAt: null, expiresAt: { lte: now } }, select: { id: true } });
  for (const grant of due) await endSupportAccess(grant.id, null, now);
  return due.length;
}

export type SupportLogRow = {
  id: string;
  tenantName: string;
  userName: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
};

/** Destek erişimi geçmişi (platform denetim kaydı). */
export async function listSupportGrants(user: PlatformUser, limit = 50): Promise<SupportLogRow[]> {
  assertPlatformAdmin(user);
  const grants = await db.supportAccessGrant.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { tenant: { select: { name: true } } },
  });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(grants.map((g) => g.userId))] } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return grants.map((g) => ({
    id: g.id,
    tenantName: g.tenant.name,
    userName: nameById.get(g.userId) ?? "Platform",
    reason: g.reason,
    createdAt: g.createdAt,
    expiresAt: g.expiresAt,
    endedAt: g.endedAt,
  }));
}
