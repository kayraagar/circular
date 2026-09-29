import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanText } from "@/lib/normalize";
import { labelOf } from "@/lib/domain";
import { logActivity } from "@/modules/activity/service";
import {
  REQUEST_CHANNELS,
  REQUEST_CHANNEL_LABELS,
  REQUEST_KINDS,
  REQUEST_KIND_LABELS,
  RESPONSE_DAYS,
  type RequestChannel,
  type RequestKind,
} from "./rules";

export { REQUEST_CHANNELS, REQUEST_CHANNEL_LABELS, REQUEST_KINDS, REQUEST_KIND_LABELS, RESPONSE_DAYS };
export type { RequestChannel, RequestKind };

/**
 * KVKK m.13 ilgili kişi başvuru defteri.
 *
 * Kanun, başvuruya **en geç otuz gün** içinde cevap verilmesini ister. İşletme gelen talebi
 * buraya kaydeder; ekran kalan süreyi ve gecikmiş başvuruları gösterir. Panel başvuru
 * *almaz* — başvurular işletmenin ilan ettiği adrese (KEP, e-posta, yazılı) gelir; burası
 * o talebin kaydı, takibi ve sonucudur.
 */

const createSchema = z.object({
  applicantName: z.string().trim().min(2, "Başvuranın adı gerekli.").max(120),
  contact: z.string().trim().max(200).optional(),
  kind: z.enum(REQUEST_KINDS, { message: "Talep türü seçin." }),
  channel: z.enum(REQUEST_CHANNELS, { message: "Başvurunun geliş yolunu seçin." }),
  note: z.string().trim().max(2000).optional(),
  customerId: z.string().trim().max(40).optional(),
  /** "YYYY-MM-DD" — boş bırakılırsa bugün. */
  receivedOn: z.string().trim().max(20).optional(),
});

function parseReceivedAt(value: string | undefined, now: Date): Date {
  if (!value) return now;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new ValidationError({ receivedOn: ["Geçerli bir tarih girin."] });
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0));
  if (Number.isNaN(at.getTime())) throw new ValidationError({ receivedOn: ["Geçerli bir tarih girin."] });
  if (at.getTime() > now.getTime() + 864e5) throw new ValidationError({ receivedOn: ["Başvuru tarihi ileri olamaz."] });
  return at;
}

export type DataRequestView = {
  id: string;
  applicantName: string;
  contact: string | null;
  kind: RequestKind;
  kindLabel: string;
  channel: RequestChannel;
  channelLabel: string;
  note: string | null;
  status: "OPEN" | "DONE" | "REJECTED";
  resolution: string | null;
  receivedAt: Date;
  dueAt: Date;
  resolvedAt: Date | null;
  /** Cevap süresinin bitmesine kalan gün (geçmişse negatif). Sonuçlanmışsa null. */
  daysLeft: number | null;
  overdue: boolean;
  customerId: string | null;
  customerName: string | null;
};

function toView(
  row: {
    id: string;
    applicantName: string;
    contact: string | null;
    kind: string;
    channel: string;
    note: string | null;
    status: string;
    resolution: string | null;
    receivedAt: Date;
    dueAt: Date;
    resolvedAt: Date | null;
    customerId: string | null;
    customer: { firstName: string; lastName: string } | null;
  },
  now: Date,
): DataRequestView {
  const kind = (REQUEST_KINDS as readonly string[]).includes(row.kind) ? (row.kind as RequestKind) : "OTHER";
  const channel = (REQUEST_CHANNELS as readonly string[]).includes(row.channel) ? (row.channel as RequestChannel) : "OTHER";
  const open = row.status === "OPEN";
  const daysLeft = open ? Math.ceil((row.dueAt.getTime() - now.getTime()) / 864e5) : null;
  return {
    id: row.id,
    applicantName: row.applicantName,
    contact: row.contact,
    kind,
    kindLabel: labelOf(REQUEST_KIND_LABELS, kind),
    channel,
    channelLabel: labelOf(REQUEST_CHANNEL_LABELS, channel),
    note: row.note,
    status: row.status as "OPEN" | "DONE" | "REJECTED",
    resolution: row.resolution,
    receivedAt: row.receivedAt,
    dueAt: row.dueAt,
    resolvedAt: row.resolvedAt,
    daysLeft,
    overdue: open && row.dueAt.getTime() < now.getTime(),
    customerId: row.customerId,
    customerName: row.customer ? `${row.customer.firstName} ${row.customer.lastName}`.trim() : null,
  };
}

export async function listDataRequests(ctx: ServiceContext, now = new Date()) {
  assertCan(ctx, "privacy.manage");
  const rows = await db.dataSubjectRequest.findMany({
    where: { tenantId: ctx.tenantId },
    include: { customer: { select: { firstName: true, lastName: true } } },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 200,
  });
  const items = rows.map((r) => toView(r, now));
  return {
    items,
    openCount: items.filter((i) => i.status === "OPEN").length,
    overdueCount: items.filter((i) => i.overdue).length,
  };
}

export async function createDataRequest(ctx: ServiceContext, raw: Record<string, unknown>, now = new Date()) {
  assertCan(ctx, "privacy.manage");
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const input = parsed.data;

  // Müşteri bağı verildiyse aynı işletmede olmalı.
  let customerId: string | null = null;
  if (input.customerId) {
    const customer = await db.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!customer) throw new ValidationError({ customerId: ["Müşteri bulunamadı."] });
    customerId = customer.id;
  }

  const receivedAt = parseReceivedAt(input.receivedOn, now);
  const dueAt = new Date(receivedAt.getTime() + RESPONSE_DAYS * 864e5);

  return db.$transaction(async (tx) => {
    const request = await tx.dataSubjectRequest.create({
      data: {
        tenantId: ctx.tenantId,
        customerId,
        applicantName: input.applicantName,
        contact: cleanText(input.contact) ?? null,
        kind: input.kind,
        channel: input.channel,
        note: cleanText(input.note) ?? null,
        receivedAt,
        dueAt,
        createdByUserId: ctx.userId,
      },
    });
    await logActivity(tx, ctx, {
      action: "privacy.request_logged",
      entityType: "data_request",
      entityId: request.id,
      customerId,
      // Başvuranın adı denetim kaydına yazılmaz: kayıt zaten başvuru satırında.
      metadata: { kind: input.kind, kindLabel: labelOf(REQUEST_KIND_LABELS, input.kind), dueAt: dueAt.toISOString() },
    });
    return request.id;
  });
}

const resolveSchema = z.object({
  status: z.enum(["DONE", "REJECTED"], { message: "Sonuç seçin." }),
  resolution: z.string().trim().min(3, "Ne yapıldığını yazın (başvurana verilen cevap).").max(2000),
});

/** Başvuruyu sonuçlandırır. Sonuç metni zorunludur: cevap verildiğinin kaydıdır. */
export async function resolveDataRequest(ctx: ServiceContext, requestId: string, raw: Record<string, unknown>, now = new Date()) {
  assertCan(ctx, "privacy.manage");
  const parsed = resolveSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);

  const request = await db.dataSubjectRequest.findFirst({ where: { id: requestId, tenantId: ctx.tenantId } });
  if (!request) throw new NotFoundError("Başvuru bulunamadı.");
  if (request.status !== "OPEN") throw new ConflictError("Bu başvuru zaten sonuçlandırılmış.", "ALREADY_RESOLVED");

  return db.$transaction(async (tx) => {
    await tx.dataSubjectRequest.update({
      where: { id: requestId },
      data: { status: parsed.data.status, resolution: parsed.data.resolution, resolvedAt: now, resolvedByUserId: ctx.userId },
    });
    const kind = (REQUEST_KINDS as readonly string[]).includes(request.kind) ? (request.kind as RequestKind) : "OTHER";
    await logActivity(tx, ctx, {
      action: "privacy.request_resolved",
      entityType: "data_request",
      entityId: requestId,
      customerId: request.customerId,
      metadata: {
        kind,
        kindLabel: labelOf(REQUEST_KIND_LABELS, kind),
        status: parsed.data.status,
        lateDays: Math.max(0, Math.ceil((now.getTime() - request.dueAt.getTime()) / 864e5)),
      },
    });
    return requestId;
  });
}
