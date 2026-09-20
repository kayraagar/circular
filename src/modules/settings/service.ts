import "server-only";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";

export async function getTenantSettings(ctx: ServiceContext) {
  assertCan(ctx, "settings.view");
  const [tenant, venues, members] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    db.venue.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" } }),
    db.membership.findMany({
      where: { tenantId: ctx.tenantId },
      include: {
        user: { select: { name: true, email: true, lastLoginAt: true } },
        venueAccess: { include: { venue: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { tenant, venues, members };
}
