import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, canAccessVenue, type ServiceContext } from "@/lib/authz";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText, fullName } from "@/lib/normalize";
import { isOneOf } from "@/lib/domain";
import { localDayKey, parseLocalDateTime } from "@/lib/datetime";
import { logActivity } from "@/modules/activity/service";
import { PASS_STATE_MESSAGES, evaluatePerkPass, maskedName, type PassState } from "@/modules/passes/rules";
import { SERIALIZABLE, createPass, evaluateLoadedPass, findPassByToken, sharePass, type PassShare } from "@/modules/passes/internal";

export const PERK_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const PERK_STATUS_LABELS: Record<(typeof PERK_STATUSES)[number], string> = { ACTIVE: "Aktif", ARCHIVED: "Arşivde" };

const perkSchema = z.object({
  name: z.string().trim().min(2, "Avantaj adı en az 2 karakter olmalı.").max(80, "Avantaj adı en fazla 80 karakter olabilir."),
  venueId: z.string().trim().default(""),
  description: z.string().trim().max(500, "Açıklama en fazla 500 karakter olabilir.").default(""),
  terms: z.string().trim().max(1000, "Kullanım koşulları en fazla 1000 karakter olabilir.").default(""),
  validFrom: z.string().default(""),
  validUntil: z.string().default(""),
  perCustomerLimit: z.string().trim().default("1"),
});

/** Kullanıcının erişebildiği avantajlar: tüm mekanlarda geçerli olanlar + erişilebilir mekanlarınki. */
function perkScope(ctx: ServiceContext): Prisma.PerkWhereInput {
  return ctx.venueIds === null ? {} : { OR: [{ venueId: null }, { venueId: { in: ctx.venueIds } }] };
}

async function parsePerk(ctx: ServiceContext, raw: unknown) {
  const parsed = perkSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  const errors: FieldErrors = {};
  const add = (k: string, m: string) => (errors[k] = [...(errors[k] ?? []), m]);

  if (v.venueId) {
    const venue = await db.venue.findFirst({ where: { id: v.venueId, tenantId: ctx.tenantId, isActive: true } });
    if (!venue || !canAccessVenue(ctx, venue.id)) add("venueId", "Geçerli bir mekan seçin.");
  } else if (ctx.venueIds !== null) {
    add("venueId", "Yalnızca erişiminiz olan bir mekan için avantaj tanımlayabilirsiniz.");
  }

  const date = (key: "validFrom" | "validUntil") => {
    if (!v[key]) return null;
    const d = parseLocalDateTime(v[key]);
    if (!d) add(key, "Geçerli bir tarih ve saat girin.");
    return d;
  };
  const validFrom = date("validFrom");
  const validUntil = date("validUntil");
  if (validUntil && validUntil.getTime() < Date.now()) add("validUntil", "Bitiş tarihi geçmişte olamaz.");
  if (validFrom && validUntil && validUntil <= validFrom) add("validUntil", "Bitiş, başlangıçtan sonra olmalı.");

  const limit = Number(v.perCustomerLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) add("perCustomerLimit", "Kişi başı limit 1 ile 100 arasında tam sayı olmalı.");

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return {
    name: cleanText(v.name),
    venueId: v.venueId || null,
    description: v.description || null,
    terms: v.terms || null,
    validFrom,
    validUntil,
    perCustomerLimit: limit,
  };
}

export async function createPerk(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx, "perks.manage");
  const data = await parsePerk(ctx, raw);
  return db.$transaction(async (tx) => {
    const perk = await tx.perk.create({ data: { ...data, tenantId: ctx.tenantId, createdByUserId: ctx.userId } });
    await logActivity(tx, ctx, {
      action: "perk.created",
      entityType: "perk",
      entityId: perk.id,
      metadata: { perkName: perk.name, limit: perk.perCustomerLimit },
    });
    return perk;
  });
}

export async function setPerkStatus(ctx: ServiceContext, perkId: string, status: string) {
  assertCan(ctx, "perks.manage");
  if (!isOneOf(PERK_STATUSES, status)) throw new ValidationError({ status: ["Geçersiz durum."] });
  const perk = await db.perk.findFirst({ where: { id: perkId, tenantId: ctx.tenantId, ...perkScope(ctx) } });
  if (!perk) throw new NotFoundError("Avantaj bulunamadı.");
  if (perk.status === status) return perk;
  return db.$transaction(async (tx) => {
    const updated = await tx.perk.update({ where: { id: perk.id }, data: { status } });
    await logActivity(tx, ctx, {
      action: status === "ARCHIVED" ? "perk.archived" : "perk.activated",
      entityType: "perk",
      entityId: perk.id,
      metadata: { perkName: perk.name },
    });
    return updated;
  });
}

export async function listPerks(ctx: ServiceContext) {
  assertCan(ctx, "perks.manage");
  const perks = await db.perk.findMany({
    where: { tenantId: ctx.tenantId, ...perkScope(ctx) },
    include: {
      venue: { select: { name: true } },
      _count: { select: { redemptions: true, passes: { where: { revokedAt: null } } } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const now = new Date();
  return perks.map((p) => ({
    ...p,
    venueName: p.venue?.name ?? null,
    redemptionCount: p._count.redemptions,
    issuedCount: p._count.passes,
    expired: p.validUntil !== null && p.validUntil < now,
  }));
}

export type CustomerPerk = {
  perkId: string;
  name: string;
  venueName: string | null;
  terms: string | null;
  validUntil: Date | null;
  limit: number;
  used: number;
  remaining: number;
  availability: "AVAILABLE" | "LIMIT_REACHED" | "NOT_YET_VALID" | "EXPIRED";
  activePass: (PassShare & { remaining: number }) | null;
};

/** Müşteri profili: verilebilecek aktif avantajlar ve müşterinin mevcut avantaj QR'ları. */
export async function listCustomerPerks(ctx: ServiceContext, customerId: string): Promise<CustomerPerk[]> {
  assertCan(ctx, "customers.view");
  assertCan(ctx, "perks.issue");
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!customer) throw new NotFoundError("Müşteri bulunamadı.");
  const now = new Date();
  const perks = await db.perk.findMany({
    where: { tenantId: ctx.tenantId, status: "ACTIVE", ...perkScope(ctx) },
    include: {
      venue: { select: { name: true } },
      passes: { where: { customerId: customer.id, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { redemptions: { where: { customerId: customer.id } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return perks.map((p) => {
    const used = p._count.redemptions;
    const remaining = Math.max(0, p.perCustomerLimit - used);
    const pass = p.passes[0];
    const passUsable = pass && pass.useCount < pass.maxUses && remaining > 0;
    const availability: CustomerPerk["availability"] =
      p.validUntil && p.validUntil < now
        ? "EXPIRED"
        : remaining === 0
          ? "LIMIT_REACHED"
          : p.validFrom && p.validFrom > now
            ? "NOT_YET_VALID"
            : "AVAILABLE";
    return {
      perkId: p.id,
      name: p.name,
      venueName: p.venue?.name ?? null,
      terms: p.terms,
      validUntil: p.validUntil,
      limit: p.perCustomerLimit,
      used,
      remaining,
      availability,
      activePass: passUsable
        ? { ...sharePass(pass), remaining: Math.min(remaining, pass.maxUses - pass.useCount) }
        : null,
    };
  });
}

/** Müşteriye avantaj QR'ı verir (idempotent). reissue: mevcut kodu iptal edip yenisini üretir. */
export async function getOrIssuePerkPass(
  ctx: ServiceContext,
  input: { customerId: string; perkId: string; reissue?: boolean },
): Promise<PassShare & { remaining: number; perkName: string }> {
  assertCan(ctx, "perks.issue");
  if (!input.customerId || !input.perkId) throw new ValidationError({ perkId: ["Müşteri ve avantaj seçin."] });
  const [customer, perk] = await Promise.all([
    db.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } }),
    db.perk.findFirst({ where: { id: input.perkId, tenantId: ctx.tenantId, ...perkScope(ctx) } }),
  ]);
  if (!customer) throw new NotFoundError("Müşteri bulunamadı.");
  if (!perk) throw new NotFoundError("Avantaj bulunamadı.");
  // Arşiv yalnızca listeleme/arama kuralıdır: arşivdeki müşteriye de QR verilebilir,
  // verilmiş QR'lar geçerliliğini korur.
  if (perk.status !== "ACTIVE") throw new ConflictError(PASS_STATE_MESSAGES.PERK_INACTIVE, "PERK_INACTIVE");
  if (perk.validUntil && perk.validUntil < new Date()) throw new ConflictError("Avantajın geçerlilik süresi dolmuş.", "EXPIRED");

  return db.$transaction(async (tx) => {
    const used = await tx.perkRedemption.count({ where: { tenantId: ctx.tenantId, perkId: perk.id, customerId: customer.id } });
    const remaining = perk.perCustomerLimit - used;
    if (remaining <= 0) throw new ConflictError(PASS_STATE_MESSAGES.LIMIT_REACHED, "LIMIT_REACHED");

    const existing = await tx.pass.findFirst({
      where: { tenantId: ctx.tenantId, purpose: "PERK_REDEMPTION", perkId: perk.id, customerId: customer.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (existing && existing.useCount < existing.maxUses && !input.reissue) {
      return { ...sharePass(existing), remaining: Math.min(remaining, existing.maxUses - existing.useCount), perkName: perk.name };
    }
    if (existing) await tx.pass.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    const pass = await createPass(tx, {
      tenantId: ctx.tenantId,
      purpose: "PERK_REDEMPTION",
      customerId: customer.id,
      perkId: perk.id,
      maxUses: remaining,
      issuedByUserId: ctx.userId,
    });
    await logActivity(tx, ctx, {
      action: existing ? "pass.reissued" : "pass.issued",
      entityType: "pass",
      entityId: pass.id,
      customerId: customer.id,
      metadata: { customerName: fullName(customer), perkName: perk.name, purpose: "PERK_REDEMPTION" },
    });
    return { ...sharePass(pass), remaining, perkName: perk.name };
  }, SERIALIZABLE);
}

/** Garson/yetkili personel: avantaj QR'ını kullanır. Çift kullanım compare-and-set ile engellenir. */
export async function redeemPerkPass(ctx: ServiceContext, token: string) {
  assertCan(ctx, "perks.redeem");
  const pass = await findPassByToken(token, ctx.tenantId);
  if (!pass || pass.purpose !== "PERK_REDEMPTION" || !pass.perk) throw new NotFoundError("QR bulunamadı.");
  const perk = pass.perk;
  if (perk.venueId && !canAccessVenue(ctx, perk.venueId)) throw new ForbiddenError("Bu mekanın avantajlarını doğrulama yetkiniz yok.");

  const now = new Date();
  const { state } = await evaluateLoadedPass(pass, now);
  if (state !== "VALID") throw new ConflictError(PASS_STATE_MESSAGES[state as Exclude<PassState, "VALID">], state);

  return db.$transaction(async (tx) => {
    const res = await tx.pass.updateMany({
      where: { id: pass.id, tenantId: ctx.tenantId, revokedAt: null, useCount: pass.useCount },
      data: { useCount: pass.useCount + 1, lastUsedAt: now },
    });
    if (res.count === 0) throw new ConflictError("Bu QR az önce başka bir cihazdan kullanıldı.", "USED");
    const used = await tx.perkRedemption.count({ where: { tenantId: ctx.tenantId, perkId: perk.id, customerId: pass.customerId } });
    if (evaluatePerkPass({ revokedAt: null, useCount: 0, maxUses: 1 }, perk, used, now) === "LIMIT_REACHED") {
      throw new ConflictError(PASS_STATE_MESSAGES.LIMIT_REACHED, "LIMIT_REACHED");
    }
    const redemption = await tx.perkRedemption.create({
      data: { tenantId: ctx.tenantId, perkId: perk.id, passId: pass.id, customerId: pass.customerId, redeemedByUserId: ctx.userId, redeemedAt: now },
    });
    await logActivity(tx, ctx, {
      action: "perk.redeemed",
      entityType: "redemption",
      entityId: redemption.id,
      customerId: pass.customerId,
      metadata: { customerName: fullName(pass.customer), perkName: perk.name },
    });
    return { redemption, remaining: Math.max(0, perk.perCustomerLimit - used - 1) };
  }, SERIALIZABLE);
}

/** Garson ekranı: bugün kendi onayladığı kullanımlar (maskeli ad). */
export async function listMyRedemptionsToday(ctx: ServiceContext) {
  assertCan(ctx, "perks.redeem");
  const start = parseLocalDateTime(`${localDayKey(new Date())}T00:00`)!;
  const rows = await db.perkRedemption.findMany({
    where: { tenantId: ctx.tenantId, redeemedByUserId: ctx.userId, redeemedAt: { gte: start } },
    include: { perk: { select: { name: true } }, customer: { select: { firstName: true, lastName: true } } },
    orderBy: { redeemedAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    perkName: r.perk.name,
    holder: maskedName(r.customer.firstName, r.customer.lastName),
    redeemedAt: r.redeemedAt,
  }));
}
