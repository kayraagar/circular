import "server-only";
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import { can, type Permission, type ServiceContext } from "@/lib/authz";
import { ForbiddenError } from "@/lib/errors";
import { isOneOf, ROLES, type Role } from "@/lib/domain";

/** İstek başına tek okuma. */
export const getSession = cache(readSession);

export type VenueSummary = { id: string; name: string; slug: string; type: string; city: string | null };

export type AppContext = {
  sessionId: string;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  tenant: { id: string; name: string; slug: string };
  membership: { id: string; role: Role };
  memberships: { tenantId: string; tenantName: string; role: Role }[];
  venues: VenueSummary[];
  activeVenue: VenueSummary | null;
  service: ServiceContext;
};

/**
 * Oturum → aktif tenant → rol → erişilebilir mekanlar.
 * Aktif tenant her istekte üyelik tablosundan yeniden doğrulanır; cookie'deki
 * değere güvenilmez (üyelik kaldırılırsa erişim anında biter).
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const session = await getSession();
  if (!session) return null;

  const memberships = await db.membership.findMany({
    where: { userId: session.userId, status: "ACTIVE", tenant: { status: "ACTIVE" } },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      venueAccess: { select: { venueId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const valid = memberships.filter((m) => isOneOf(ROLES, m.role));
  const active = valid.find((m) => m.tenantId === session.activeTenantId) ?? valid[0];
  if (!active) return null;

  const role = active.role as Role;
  const venueIds = active.venueAccess.length > 0 ? active.venueAccess.map((v) => v.venueId) : null;
  const venues = await db.venue.findMany({
    where: { tenantId: active.tenantId, isActive: true, ...(venueIds ? { id: { in: venueIds } } : {}) },
    select: { id: true, name: true, slug: true, type: true, city: true },
    orderBy: { name: "asc" },
  });
  const activeVenue = venues.find((v) => v.id === session.activeVenueId) ?? null;

  return {
    sessionId: session.id,
    user: session.user,
    tenant: active.tenant,
    membership: { id: active.id, role },
    memberships: valid.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenant.name, role: m.role as Role })),
    venues,
    activeVenue,
    service: {
      tenantId: active.tenantId,
      userId: session.userId,
      membershipId: active.id,
      role,
      venueIds,
    },
  };
});

/** Sayfalar için: oturum yoksa girişe, üyelik yoksa bilgilendirme sayfasına yönlendirir. */
export async function requireAppContext(): Promise<AppContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  const ctx = await getAppContext();
  if (!ctx) redirect("/no-access");
  return ctx;
}

/** Sayfalar için: rol yetkisi yoksa 403. */
export async function requirePermission(permission: Permission): Promise<AppContext> {
  const ctx = await requireAppContext();
  if (!can(ctx.membership.role, permission)) forbidden();
  return ctx;
}

/** Server Action'lar için: yönlendirme yerine hata fırlatır. */
export async function requireServiceContext(): Promise<ServiceContext> {
  const ctx = await getAppContext();
  if (!ctx) throw new ForbiddenError("Oturumunuz sona erdi. Lütfen yeniden giriş yapın.");
  return ctx.service;
}
