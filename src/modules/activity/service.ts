import "server-only";
import { db, type Tx } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";

export type ActivityAction =
  | "customer.created"
  | "customer.updated"
  | "customer.archived"
  | "customer.restored"
  | "consent.granted"
  | "consent.revoked"
  | "event.created"
  | "event.updated"
  | "event.published"
  | "event.unpublished"
  | "event.cancelled"
  | "event.entry_extended"
  | "registration.added"
  | "registration.reactivated"
  | "registration.cancelled"
  | "pass.issued"
  | "pass.reissued"
  | "checkin.recorded"
  | "checkin.undone"
  | "perk.created"
  | "perk.archived"
  | "perk.activated"
  | "perk.redeemed"
  | "menu.config_updated"
  | "menu.category_changed"
  | "menu.item_changed"
  | "menu.campaign_updated"
  | "customer.self_registered"
  | "pr_task.created"
  | "pr_task.closed"
  | "pr_task.completed"
  | "registration.self_registered"
  | "whatsapp.connected"
  | "whatsapp.disconnected"
  | "whatsapp.template_submitted"
  | "campaign.sent"
  | "campaign.test_sent"
  | "sms.connected"
  | "sms.disconnected"
  | "email.settings_updated"
  | "instagram.connected"
  | "instagram.disconnected"
  | "instagram.rule_changed";

export type ActivityInput = {
  action: ActivityAction;
  entityType:
    | "customer"
    | "consent"
    | "event"
    | "registration"
    | "pass"
    | "checkin"
    | "perk"
    | "redemption"
    | "menu"
    | "menu_category"
    | "menu_item"
    | "pr_task"
    | "whatsapp"
    | "campaign"
    | "sms"
    | "email"
    | "instagram";
  entityId: string;
  customerId?: string | null;
  eventId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
};

/** İşlemle aynı transaction içinde çağrılır; işlem geri alınırsa kayıt da düşer. */
/** userId null: kişinin kendi yaptığı herkese açık işlemler (ör. menüden kayıt); akışta "Sistem" olarak görünür. */
export async function logActivity(tx: Tx, ctx: { tenantId: string; userId: string | null }, input: ActivityInput) {
  await tx.activityLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      customerId: input.customerId ?? null,
      eventId: input.eventId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

export type ActivityItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  customerId: string | null;
  eventId: string | null;
  metadata: Record<string, unknown>;
  actorName: string | null;
  createdAt: Date;
};

export async function listActivity(
  ctx: ServiceContext,
  opts: { customerId?: string; eventId?: string; limit?: number; page?: number } = {},
): Promise<{ items: ActivityItem[]; hasMore: boolean }> {
  assertCan(ctx, "activity.view");
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const rows = await db.activityLog.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.eventId ? { eventId: opts.eventId } : {}),
    },
    include: { actor: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * limit,
    take: limit + 1,
  });
  return {
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      customerId: r.customerId,
      eventId: r.eventId,
      metadata: safeJson(r.metadata),
      actorName: r.actor?.name ?? null,
      createdAt: r.createdAt,
    })),
  };
}

function safeJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
