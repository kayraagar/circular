import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, venueScope, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText } from "@/lib/normalize";
import { isOneOf } from "@/lib/domain";
import { parseLocalDateTime } from "@/lib/datetime";
import { logActivity } from "@/modules/activity/service";
import { summarizeGuests, type GuestTotals } from "@/modules/guests/status";
import {
  PR_TASK_KINDS,
  PR_TASK_KIND_LABELS,
  PR_TASK_LIMITS,
  recipientState,
  targetProgress,
  type PrTaskKind,
  type RecipientState,
} from "./tasks";

/**
 * PR yönetimi: ekip performansı ve talimatlar.
 * - Yönetim (pr.manage): ekip performansını görür, talimat verir ve kapatır.
 * - PR (pr.portal): yalnızca kendisine verilen açık talimatları görür, okundu/tamamlandı işaretler.
 * Talimatlar panel içinde görünür; dışarıya bildirim gönderilmez.
 * Misafir hedefi ilerlemesi PR'ın beyanından değil, gerçek misafir kayıtlarından hesaplanır.
 */

const DAY_MS = 24 * 3600 * 1000;
export const PERFORMANCE_WINDOW_DAYS = 30;

type StatsRow = { accessStatus: string; partySize: number; checkIns: { admittedCount: number }[] };
const toGuestRow = (r: StatsRow) => ({ accessStatus: r.accessStatus, partySize: r.partySize, admittedCount: r.checkIns[0]?.admittedCount ?? null });

/** PR mekan kapsamı: erişim kısıtı yoksa tüm mekanlar. */
function prCanAccessVenue(venueIds: string[], venueId: string) {
  return venueIds.length === 0 || venueIds.includes(venueId);
}

/**
 * Yönetim kullanıcısının mekan kapsamı: kısıt yoksa filtre eklenmez; kısıtlıysa etkinliksiz talimatlar
 * ve erişebildiği mekanlardaki etkinliklere bağlı talimatlar görünür.
 * (Opsiyonel ilişkiye boş filtre verilmez; Prisma bunu etkinliği olan kayıtları eleyen bir koşula çevirir.)
 */
function taskVenueScope(ctx: ServiceContext): Prisma.PrTaskWhereInput {
  if (ctx.venueIds === null) return {};
  return { OR: [{ eventId: null }, { event: { is: { venueId: { in: ctx.venueIds } } } }] };
}

// ─────────────────────────────────────────────── Ekip ve performans

export type PrTeamMember = {
  membershipId: string;
  name: string;
  email: string;
  active: boolean;
  venues: string[];
  stats: GuestTotals & { checkInRate: number };
  openTasks: number;
  unreadTasks: number;
};

export async function getPrOverview(ctx: ServiceContext, now = new Date()) {
  assertCan(ctx, "pr.manage");
  const since = new Date(now.getTime() - PERFORMANCE_WINDOW_DAYS * DAY_MS);

  const [members, registrations, recipients, openTasks, events] = await Promise.all([
    db.membership.findMany({
      where: { tenantId: ctx.tenantId, role: "PR" },
      include: { user: { select: { name: true, email: true } }, venueAccess: { include: { venue: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    // Son 30 gün ve yaklaşan etkinliklerde PR'ların getirdiği kayıtlar
    db.eventRegistration.findMany({
      where: { tenantId: ctx.tenantId, prMembershipId: { not: null }, event: { ...venueScope(ctx), startsAt: { gte: since } } },
      select: { prMembershipId: true, accessStatus: true, partySize: true, checkIns: { select: { admittedCount: true } } },
    }),
    db.prTaskRecipient.findMany({
      where: { tenantId: ctx.tenantId, task: { status: "OPEN" } },
      select: { membershipId: true, readAt: true, completedAt: true },
    }),
    db.prTask.count({ where: { tenantId: ctx.tenantId, status: "OPEN" } }),
    db.event.findMany({
      where: { tenantId: ctx.tenantId, ...venueScope(ctx), status: "PUBLISHED", endsAt: { gte: now } },
      select: { id: true, name: true, startsAt: true, venueId: true, venue: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
      take: 50,
    }),
  ]);

  const team: PrTeamMember[] = members
    .map((m) => {
      const own = recipients.filter((r) => r.membershipId === m.id);
      return {
        membershipId: m.id,
        name: m.user.name,
        email: m.user.email,
        active: m.status === "ACTIVE",
        venues: m.venueAccess.map((v) => v.venue.name),
        stats: summarizeGuests(registrations.filter((r) => r.prMembershipId === m.id).map(toGuestRow)),
        openTasks: own.length,
        unreadTasks: own.filter((r) => !r.readAt && !r.completedAt).length,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.stats.admitted - a.stats.admitted || b.stats.people - a.stats.people);

  return {
    windowDays: PERFORMANCE_WINDOW_DAYS,
    team,
    totals: {
      activePrs: team.filter((t) => t.active).length,
      openTasks,
      unreadRecipients: recipients.filter((r) => !r.readAt && !r.completedAt).length,
      ...summarizeGuests(registrations.map(toGuestRow)),
    },
    events: events.map((e) => ({ id: e.id, name: e.name, startsAt: e.startsAt, venueName: e.venue.name })),
  };
}

// ─────────────────────────────────────────────── Talimat listesi (yönetim)

export type TaskRecipientView = {
  membershipId: string;
  name: string;
  state: RecipientState;
  readAt: Date | null;
  completedAt: Date | null;
  progress: { people: number; admitted: number; ratio: number } | null;
};

export type PrTaskView = {
  id: string;
  kind: PrTaskKind;
  title: string;
  body: string | null;
  status: "OPEN" | "CLOSED";
  dueAt: Date | null;
  createdAt: Date;
  closedAt: Date | null;
  createdByName: string | null;
  event: { id: string; name: string; startsAt: Date } | null;
  guestTarget: number | null;
  recipients: TaskRecipientView[];
  summary: { total: number; read: number; done: number; reachedTarget: number | null };
};

export async function listPrTasks(ctx: ServiceContext, opts: { status: "OPEN" | "CLOSED" }): Promise<PrTaskView[]> {
  assertCan(ctx, "pr.manage");
  const tasks = await db.prTask.findMany({
    where: { tenantId: ctx.tenantId, status: opts.status, ...taskVenueScope(ctx) },
    include: {
      event: { select: { id: true, name: true, startsAt: true } },
      recipients: { include: { membership: { select: { user: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const targetEventIds = [...new Set(tasks.filter((t) => t.kind === "GUEST_TARGET" && t.eventId).map((t) => t.eventId!))];
  const [registrations, creators] = await Promise.all([
    targetEventIds.length
      ? db.eventRegistration.findMany({
          where: { tenantId: ctx.tenantId, eventId: { in: targetEventIds }, prMembershipId: { not: null } },
          select: { eventId: true, prMembershipId: true, accessStatus: true, partySize: true, checkIns: { select: { admittedCount: true } } },
        })
      : [],
    db.user.findMany({
      where: { id: { in: [...new Set(tasks.map((t) => t.createdByUserId).filter((id): id is string => !!id))] } },
      select: { id: true, name: true },
    }),
  ]);
  const creatorNames = new Map(creators.map((u) => [u.id, u.name]));

  return tasks.map((task) => {
    const kind = isOneOf(PR_TASK_KINDS, task.kind) ? task.kind : "ANNOUNCEMENT";
    const recipients = task.recipients.map((r): TaskRecipientView => {
      let progress: TaskRecipientView["progress"] = null;
      if (kind === "GUEST_TARGET" && task.eventId) {
        const s = summarizeGuests(registrations.filter((g) => g.eventId === task.eventId && g.prMembershipId === r.membershipId).map(toGuestRow));
        progress = { people: s.people, admitted: s.admitted, ratio: targetProgress(s.people, task.guestTarget) };
      }
      return {
        membershipId: r.membershipId,
        name: r.membership.user.name,
        state: recipientState(r),
        readAt: r.readAt,
        completedAt: r.completedAt,
        progress,
      };
    });
    return {
      id: task.id,
      kind,
      title: task.title,
      body: task.body,
      status: task.status === "CLOSED" ? "CLOSED" : "OPEN",
      dueAt: task.dueAt,
      createdAt: task.createdAt,
      closedAt: task.closedAt,
      createdByName: task.createdByUserId ? (creatorNames.get(task.createdByUserId) ?? null) : null,
      event: task.event,
      guestTarget: task.guestTarget,
      recipients,
      summary: {
        total: recipients.length,
        read: recipients.filter((r) => r.state !== "UNREAD").length,
        done: recipients.filter((r) => r.state === "DONE").length,
        reachedTarget: kind === "GUEST_TARGET" ? recipients.filter((r) => (r.progress?.ratio ?? 0) >= 1).length : null,
      },
    };
  });
}

// ─────────────────────────────────────────────── Talimat verme ve kapatma

const taskSchema = z.object({
  kind: z.string().trim().default(""),
  title: z
    .string()
    .trim()
    .min(3, "Başlık en az 3 karakter olmalı.")
    .max(PR_TASK_LIMITS.title, `Başlık en fazla ${PR_TASK_LIMITS.title} karakter olabilir.`),
  body: z.string().trim().max(PR_TASK_LIMITS.body, `Açıklama en fazla ${PR_TASK_LIMITS.body} karakter olabilir.`).default(""),
  eventId: z.string().trim().max(64).default(""),
  guestTarget: z.string().trim().default(""),
  dueAt: z.string().trim().default(""),
  audience: z.string().trim().default("ALL"),
  membershipIds: z.array(z.string().trim().max(64)).max(200).default([]),
});

export async function createPrTask(ctx: ServiceContext, raw: unknown, now = new Date()) {
  assertCan(ctx, "pr.manage");
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  const errors: FieldErrors = {};
  const add = (key: string, message: string) => (errors[key] = [...(errors[key] ?? []), message]);

  if (!isOneOf(PR_TASK_KINDS, v.kind)) add("kind", "Talimat türünü seçin.");
  const kind = isOneOf(PR_TASK_KINDS, v.kind) ? v.kind : "ANNOUNCEMENT";

  let guestTarget: number | null = null;
  if (kind === "GUEST_TARGET") {
    const n = Number(v.guestTarget);
    if (!v.guestTarget || !Number.isInteger(n) || n < 1 || n > PR_TASK_LIMITS.maxTarget) {
      add("guestTarget", `PR başına kişi hedefi 1 ile ${PR_TASK_LIMITS.maxTarget} arasında tam sayı olmalı.`);
    } else guestTarget = n;
    if (!v.eventId) add("eventId", "Misafir hedefi için etkinlik seçin.");
  }

  const event = v.eventId
    ? await db.event.findFirst({
        where: { id: v.eventId, tenantId: ctx.tenantId, ...venueScope(ctx), status: "PUBLISHED", endsAt: { gte: now } },
        select: { id: true, name: true, venueId: true },
      })
    : null;
  if (v.eventId && !event) add("eventId", "Yayında ve bitmemiş bir etkinlik seçin.");

  let dueAt: Date | null = null;
  if (v.dueAt) {
    dueAt = parseLocalDateTime(v.dueAt);
    if (!dueAt) add("dueAt", "Geçerli bir tarih ve saat girin.");
    else if (dueAt <= now) add("dueAt", "Son tarih gelecekte olmalı.");
  }

  // Alıcılar: aktif PR üyelikleri. Etkinlik seçildiyse o mekana erişemeyen PR alıcı olamaz.
  const prs = await db.membership.findMany({
    where: { tenantId: ctx.tenantId, role: "PR", status: "ACTIVE" },
    include: { user: { select: { name: true } }, venueAccess: { select: { venueId: true } } },
  });
  const reachable = (m: (typeof prs)[number]) => !event || prCanAccessVenue(m.venueAccess.map((a) => a.venueId), event.venueId);
  let recipientIds: string[] = [];
  if (v.audience === "SELECTED") {
    const requested = [...new Set(v.membershipIds.filter(Boolean))];
    if (requested.length === 0) add("membershipIds", "En az bir PR seçin.");
    for (const id of requested) {
      const pr = prs.find((m) => m.id === id);
      if (!pr) add("membershipIds", "Seçilen PR'lardan biri bu işletmede aktif değil.");
      else if (!reachable(pr)) add("membershipIds", `${pr.user.name} bu etkinliğin mekanına erişemiyor.`);
    }
    recipientIds = requested;
  } else if (v.audience === "ALL") {
    recipientIds = prs.filter(reachable).map((m) => m.id);
    if (recipientIds.length === 0) add("membershipIds", "Talimat verilecek aktif PR yok.");
  } else {
    add("audience", "Alıcıları seçin.");
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  return db.$transaction(async (tx) => {
    const task = await tx.prTask.create({
      data: {
        tenantId: ctx.tenantId,
        kind,
        title: cleanText(v.title),
        body: v.body || null,
        eventId: event?.id ?? null,
        guestTarget,
        dueAt,
        createdByUserId: ctx.userId,
      },
    });
    await tx.prTaskRecipient.createMany({
      data: recipientIds.map((membershipId) => ({ tenantId: ctx.tenantId, taskId: task.id, membershipId })),
    });
    await logActivity(tx, ctx, {
      action: "pr_task.created",
      entityType: "pr_task",
      entityId: task.id,
      eventId: event?.id ?? null,
      metadata: { title: task.title, kindLabel: PR_TASK_KIND_LABELS[kind], recipientCount: recipientIds.length },
    });
    return { id: task.id, recipientCount: recipientIds.length };
  });
}

export async function closePrTask(ctx: ServiceContext, taskId: string, now = new Date()) {
  assertCan(ctx, "pr.manage");
  if (!taskId) throw new ValidationError({ taskId: ["Talimat seçin."] });
  const task = await db.prTask.findFirst({
    where: { id: taskId, tenantId: ctx.tenantId, ...taskVenueScope(ctx) },
  });
  if (!task) throw new NotFoundError("Talimat bulunamadı.");
  if (task.status === "CLOSED") return task;
  return db.$transaction(async (tx) => {
    const updated = await tx.prTask.update({ where: { id: task.id }, data: { status: "CLOSED", closedAt: now } });
    await logActivity(tx, ctx, {
      action: "pr_task.closed",
      entityType: "pr_task",
      entityId: task.id,
      eventId: task.eventId,
      metadata: { title: task.title },
    });
    return updated;
  });
}

// ─────────────────────────────────────────────── PR portalı: kendi talimatları

export type MyPrTask = {
  taskId: string;
  kind: PrTaskKind;
  title: string;
  body: string | null;
  dueAt: Date | null;
  createdAt: Date;
  event: { id: string; name: string; startsAt: Date } | null;
  guestTarget: number | null;
  state: RecipientState;
  progress: { people: number; admitted: number; ratio: number } | null;
};

export async function listMyPrTasks(ctx: ServiceContext): Promise<MyPrTask[]> {
  assertCan(ctx, "pr.portal");
  const rows = await db.prTaskRecipient.findMany({
    where: { tenantId: ctx.tenantId, membershipId: ctx.membershipId, task: { status: "OPEN" } },
    include: { task: { include: { event: { select: { id: true, name: true, startsAt: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const eventIds = [...new Set(rows.filter((r) => r.task.kind === "GUEST_TARGET" && r.task.eventId).map((r) => r.task.eventId!))];
  const own = eventIds.length
    ? await db.eventRegistration.findMany({
        where: { tenantId: ctx.tenantId, prMembershipId: ctx.membershipId, eventId: { in: eventIds } },
        select: { eventId: true, accessStatus: true, partySize: true, checkIns: { select: { admittedCount: true } } },
      })
    : [];

  return rows.map((r) => {
    const kind = isOneOf(PR_TASK_KINDS, r.task.kind) ? r.task.kind : "ANNOUNCEMENT";
    let progress: MyPrTask["progress"] = null;
    if (kind === "GUEST_TARGET" && r.task.eventId) {
      const s = summarizeGuests(own.filter((g) => g.eventId === r.task.eventId).map(toGuestRow));
      progress = { people: s.people, admitted: s.admitted, ratio: targetProgress(s.people, r.task.guestTarget) };
    }
    return {
      taskId: r.taskId,
      kind,
      title: r.task.title,
      body: r.task.body,
      dueAt: r.task.dueAt,
      createdAt: r.task.createdAt,
      event: r.task.event,
      guestTarget: r.task.guestTarget,
      state: recipientState(r),
      progress,
    };
  });
}

/**
 * PR talimatı işaretler. Duyuru ve misafir hedefi yalnızca "okundu" olur
 * (hedefin tamamlanması gerçek kayıtlardan hesaplanır); görev "tamamlandı" olarak işaretlenebilir.
 */
export async function markPrTask(ctx: ServiceContext, taskId: string, op: string, now = new Date()): Promise<RecipientState> {
  assertCan(ctx, "pr.portal");
  if (op !== "read" && op !== "done") throw new ValidationError({ op: ["Geçersiz işlem."] });
  if (!taskId) throw new ValidationError({ taskId: ["Talimat seçin."] });
  const recipient = await db.prTaskRecipient.findFirst({
    where: { tenantId: ctx.tenantId, taskId, membershipId: ctx.membershipId },
    include: { task: { select: { status: true, kind: true, title: true, eventId: true } } },
  });
  if (!recipient) throw new NotFoundError("Talimat bulunamadı.");
  if (recipient.task.status !== "OPEN") throw new ConflictError("Bu talimat yönetim tarafından kapatıldı.", "TASK_CLOSED");
  if (op === "done" && recipient.task.kind !== "TODO") {
    throw new ConflictError("Bu talimat türü tamamlandı olarak işaretlenmez.", "NOT_COMPLETABLE");
  }

  const firstCompletion = op === "done" && !recipient.completedAt;
  return db.$transaction(async (tx) => {
    const updated = await tx.prTaskRecipient.update({
      where: { id: recipient.id },
      data: {
        readAt: recipient.readAt ?? now,
        ...(op === "done" ? { completedAt: recipient.completedAt ?? now } : {}),
      },
    });
    if (firstCompletion) {
      await logActivity(tx, ctx, {
        action: "pr_task.completed",
        entityType: "pr_task",
        entityId: taskId,
        eventId: recipient.task.eventId,
        metadata: { title: recipient.task.title },
      });
    }
    return recipientState(updated);
  });
}
