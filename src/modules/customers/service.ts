import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, isUniqueViolation, type Tx } from "@/lib/db";
import { assertCan, venueScope, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText, foldText, fullName, normalizeEmail, normalizePhone, phoneSearchDigits } from "@/lib/normalize";
import {
  CHANNELS,
  CHANNEL_LABELS,
  CUSTOMER_SOURCES,
  CUSTOMER_SOURCE_LABELS,
  STAFF_SELECTABLE_SOURCES,
  isOneOf,
  type Channel,
  type CustomerSource,
} from "@/lib/domain";
import { isValidCalendarDate, localDayKey } from "@/lib/datetime";
import { logActivity } from "@/modules/activity/service";

// ─────────────────────────────────────────────── Doğrulama

const MAX_TAGS = 15;

const nameSchema = z.object({
  firstName: z.string().trim().min(1, "Ad zorunludur.").max(80, "Ad en fazla 80 karakter olabilir."),
  lastName: z.string().trim().min(1, "Soyad zorunludur.").max(80, "Soyad en fazla 80 karakter olabilir."),
  phone: z.string().trim().max(32, "Telefon numarası çok uzun.").default(""),
  email: z.string().trim().max(254, "E-posta adresi çok uzun.").default(""),
});

const profileSchema = nameSchema.extend({
  birthDate: z.string().trim().default(""),
  notes: z.string().trim().max(4000, "Not en fazla 4000 karakter olabilir.").default(""),
  tags: z.array(z.string()).default([]),
});

function mergeErrors(target: FieldErrors, key: string, message: string) {
  target[key] = [...(target[key] ?? []), message];
}

export type ContactFields = { firstName: string; lastName: string; phone: string | null; email: string | null };

/** Ad, soyad ve iletişim bilgisini doğrular ve normalize eder. En az bir iletişim kanalı zorunludur. */
export function parseContactFields(raw: unknown, errors: FieldErrors): ContactFields | null {
  const parsed = nameSchema.safeParse(raw);
  if (!parsed.success) {
    for (const [k, v] of Object.entries(z.flattenError(parsed.error).fieldErrors)) {
      for (const msg of v ?? []) mergeErrors(errors, k, msg);
    }
    return null;
  }
  const { firstName, lastName } = parsed.data;
  const phoneResult = normalizePhone(parsed.data.phone);
  if (phoneResult && !phoneResult.ok) mergeErrors(errors, "phone", "Geçerli bir telefon numarası girin (ör. 0532 123 45 67).");
  const email = normalizeEmail(parsed.data.email);
  if (email && !z.email().safeParse(email).success) mergeErrors(errors, "email", "Geçerli bir e-posta adresi girin.");
  const phone = phoneResult?.ok ? phoneResult.e164 : null;
  if (!parsed.data.phone && !email) {
    mergeErrors(errors, "phone", "Telefon veya e-postadan en az biri gereklidir.");
  }
  return { firstName: cleanText(firstName), lastName: cleanText(lastName), phone, email };
}

export function normalizeTags(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const name = cleanText(n).slice(0, 40);
    const key = foldText(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

type ProfileInput = ContactFields & { birthDate: string | null; notes: string | null; tags: string[] };

function parseProfile(raw: unknown): ProfileInput {
  const errors: FieldErrors = {};
  const contact = parseContactFields(raw, errors);
  const parsed = profileSchema.safeParse(raw);
  let rest = { birthDate: null as string | null, notes: null as string | null, tags: [] as string[] };
  if (parsed.success) {
    const bd = parsed.data.birthDate;
    if (bd) {
      if (!isValidCalendarDate(bd) || bd < "1900-01-01" || bd > localDayKey(new Date())) {
        mergeErrors(errors, "birthDate", "Geçerli bir doğum tarihi girin.");
      }
    }
    const tags = normalizeTags(parsed.data.tags);
    if (tags.length > MAX_TAGS) mergeErrors(errors, "tags", `En fazla ${MAX_TAGS} etiket eklenebilir.`);
    rest = { birthDate: bd || null, notes: parsed.data.notes || null, tags };
  } else {
    for (const [k, v] of Object.entries(z.flattenError(parsed.error).fieldErrors)) {
      if (!errors[k]) for (const msg of v ?? []) mergeErrors(errors, k, msg);
    }
  }
  if (Object.keys(errors).length > 0 || !contact) throw new ValidationError(errors);
  return { ...contact, ...rest };
}

// ─────────────────────────────────────────────── Mükerrer kontrolü

export type DuplicateContactDetail = {
  customerId: string;
  name: string;
  field: "phone" | "email";
  archived: boolean;
};

export async function findContactConflict(
  tenantId: string,
  contact: { phone: string | null; email: string | null },
  excludeId?: string,
) {
  const or: Prisma.CustomerWhereInput[] = [];
  if (contact.phone) or.push({ phone: contact.phone });
  if (contact.email) or.push({ email: contact.email });
  if (or.length === 0) return null;
  const match = await db.customer.findFirst({
    where: { tenantId, OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, archivedAt: true },
  });
  if (!match) return null;
  const detail: DuplicateContactDetail = {
    customerId: match.id,
    name: fullName(match),
    field: contact.phone && match.phone === contact.phone ? "phone" : "email",
    archived: match.archivedAt !== null,
  };
  return detail;
}

function duplicateContactError(detail: DuplicateContactDetail) {
  const what = detail.field === "phone" ? "Bu telefon numarası" : "Bu e-posta adresi";
  const suffix = detail.archived ? " (arşivde)" : "";
  return new ConflictError(`${what} zaten ${detail.name}${suffix} kaydında kayıtlı.`, "DUPLICATE_CONTACT", detail);
}

export type PossibleDuplicateDetail = { matches: { customerId: string; name: string }[] };

// ─────────────────────────────────────────────── Etiketler

async function resolveTagIds(tx: Tx, tenantId: string, names: string[]) {
  const ids: string[] = [];
  for (const name of names) {
    const nameKey = foldText(name);
    const tag = await tx.tag.upsert({
      where: { tenantId_nameKey: { tenantId, nameKey } },
      create: { tenantId, name, nameKey },
      update: {},
      select: { id: true },
    });
    ids.push(tag.id);
  }
  return ids;
}

export async function listTags(ctx: ServiceContext) {
  assertCan(ctx, "customers.view");
  const tags = await db.tag.findMany({
    where: { tenantId: ctx.tenantId },
    select: { id: true, name: true, _count: { select: { customers: true } } },
    orderBy: { nameKey: "asc" },
  });
  return tags.map((t) => ({ id: t.id, name: t.name, count: t._count.customers }));
}

// ─────────────────────────────────────────────── Oluştur / güncelle

export type CreateCustomerInput = Record<string, unknown> & {
  source?: string;
  consentChannels?: string[];
  consentNote?: string;
};

export async function createCustomer(
  ctx: ServiceContext,
  raw: CreateCustomerInput,
  opts: { confirmPossibleDuplicate?: boolean } = {},
) {
  assertCan(ctx, "customers.create");
  const errors: FieldErrors = {};
  let input: ProfileInput | null = null;
  try {
    input = parseProfile(raw);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    Object.assign(errors, e.fieldErrors);
  }

  const source = raw.source ?? "MANUAL";
  if (!isOneOf(CUSTOMER_SOURCES, source) || !STAFF_SELECTABLE_SOURCES.includes(source)) {
    mergeErrors(errors, "source", "Geçerli bir kayıt kaynağı seçin.");
  }

  const consentChannels = (raw.consentChannels ?? []).filter((c): c is Channel => isOneOf(CHANNELS, c));
  const consentNote = cleanText(typeof raw.consentNote === "string" ? raw.consentNote : "").slice(0, 300);
  if (consentChannels.length > 0 && consentNote.length < 3) {
    mergeErrors(errors, "consentNote", "İznin nasıl alındığını kısaca yazın (ör. kasa formu, 12 Eylül).");
  }
  if (input) {
    for (const ch of consentChannels) {
      if (ch === "EMAIL" && !input.email) mergeErrors(errors, "consentChannels", "E-posta izni için e-posta adresi gerekli.");
      if (ch !== "EMAIL" && !input.phone)
        mergeErrors(errors, "consentChannels", `${CHANNEL_LABELS[ch]} izni için telefon numarası gerekli.`);
    }
  }
  if (Object.keys(errors).length > 0 || !input) throw new ValidationError(errors);

  const conflict = await findContactConflict(ctx.tenantId, input);
  if (conflict) throw duplicateContactError(conflict);

  const searchName = foldText(`${input.firstName} ${input.lastName}`);
  if (!opts.confirmPossibleDuplicate) {
    const similar = await db.customer.findMany({
      where: { tenantId: ctx.tenantId, searchName, archivedAt: null },
      select: { id: true, firstName: true, lastName: true },
      take: 5,
    });
    if (similar.length > 0) {
      throw new ConflictError<PossibleDuplicateDetail>(
        "Aynı isimde kayıtlı müşteri var. Aynı kişi olmadığından emin misiniz?",
        "POSSIBLE_DUPLICATE",
        { matches: similar.map((s) => ({ customerId: s.id, name: fullName(s) })) },
      );
    }
  }

  const data = input;
  try {
    return await db.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId: ctx.tenantId,
          firstName: data.firstName,
          lastName: data.lastName,
          searchName,
          phone: data.phone,
          email: data.email,
          birthDate: data.birthDate,
          notes: data.notes,
          source: source as CustomerSource,
          createdByUserId: ctx.userId,
        },
      });
      const tagIds = await resolveTagIds(tx, ctx.tenantId, data.tags);
      if (tagIds.length) {
        await tx.customerTag.createMany({
          data: tagIds.map((tagId) => ({ tenantId: ctx.tenantId, customerId: customer.id, tagId })),
        });
      }
      const customerName = fullName(customer);
      await logActivity(tx, ctx, {
        action: "customer.created",
        entityType: "customer",
        entityId: customer.id,
        customerId: customer.id,
        metadata: { customerName, sourceLabel: CUSTOMER_SOURCE_LABELS[source as CustomerSource] },
      });
      const now = new Date();
      for (const channel of consentChannels) {
        const consent = await tx.contactConsent.create({
          data: {
            tenantId: ctx.tenantId,
            customerId: customer.id,
            channel,
            status: "GRANTED",
            source: "STAFF_RECORDED",
            note: consentNote,
            recordedByUserId: ctx.userId,
            grantedAt: now,
          },
        });
        await logActivity(tx, ctx, {
          action: "consent.granted",
          entityType: "consent",
          entityId: consent.id,
          customerId: customer.id,
          metadata: { customerName, channel, note: consentNote },
        });
      }
      return customer;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await findContactConflict(ctx.tenantId, data);
      if (again) throw duplicateContactError(again);
    }
    throw e;
  }
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "ad",
  lastName: "soyad",
  phone: "telefon",
  email: "e-posta",
  birthDate: "doğum tarihi",
  notes: "not",
  tags: "etiketler",
};

export async function updateCustomer(ctx: ServiceContext, id: string, raw: Record<string, unknown>) {
  assertCan(ctx, "customers.update");
  const existing = await db.customer.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: { tags: { include: { tag: { select: { name: true } } } } },
  });
  if (!existing) throw new NotFoundError("Müşteri bulunamadı.");

  const input = parseProfile(raw);
  const conflict = await findContactConflict(ctx.tenantId, input, id);
  if (conflict) throw duplicateContactError(conflict);

  const previousTags = existing.tags.map((t) => foldText(t.tag.name)).sort().join("|");
  const nextTags = input.tags.map(foldText).sort().join("|");
  const changed = (["firstName", "lastName", "phone", "email", "birthDate", "notes"] as const)
    .filter((k) => (existing[k] ?? null) !== (input[k] ?? null))
    .map((k) => FIELD_LABELS[k]);
  if (previousTags !== nextTags) changed.push(FIELD_LABELS.tags);

  try {
    return await db.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: existing.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          searchName: foldText(`${input.firstName} ${input.lastName}`),
          phone: input.phone,
          email: input.email,
          birthDate: input.birthDate,
          notes: input.notes,
        },
      });
      if (previousTags !== nextTags) {
        await tx.customerTag.deleteMany({ where: { customerId: existing.id } });
        const tagIds = await resolveTagIds(tx, ctx.tenantId, input.tags);
        if (tagIds.length) {
          await tx.customerTag.createMany({
            data: tagIds.map((tagId) => ({ tenantId: ctx.tenantId, customerId: existing.id, tagId })),
          });
        }
      }
      if (changed.length > 0) {
        await logActivity(tx, ctx, {
          action: "customer.updated",
          entityType: "customer",
          entityId: existing.id,
          customerId: existing.id,
          metadata: { customerName: fullName(customer), fields: changed },
        });
      }
      return customer;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await findContactConflict(ctx.tenantId, input, id);
      if (again) throw duplicateContactError(again);
    }
    throw e;
  }
}

export async function setCustomerArchived(ctx: ServiceContext, id: string, archived: boolean) {
  assertCan(ctx, "customers.archive");
  const existing = await db.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!existing) throw new NotFoundError("Müşteri bulunamadı.");
  if ((existing.archivedAt !== null) === archived) return existing;
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.update({
      where: { id: existing.id },
      data: { archivedAt: archived ? new Date() : null },
    });
    await logActivity(tx, ctx, {
      action: archived ? "customer.archived" : "customer.restored",
      entityType: "customer",
      entityId: id,
      customerId: id,
      metadata: { customerName: fullName(existing) },
    });
    return customer;
  });
}

// ─────────────────────────────────────────────── İletişim izni

export async function setConsent(
  ctx: ServiceContext,
  input: { customerId: string; channel: string; grant: boolean; note?: string },
) {
  assertCan(ctx, "consents.manage");
  if (!isOneOf(CHANNELS, input.channel)) throw new ValidationError({ channel: ["Geçersiz kanal."] });
  const channel = input.channel;
  const customer = await db.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } });
  if (!customer) throw new NotFoundError("Müşteri bulunamadı.");

  const note = cleanText(input.note).slice(0, 300);
  if (input.grant) {
    const errors: FieldErrors = {};
    if (note.length < 3) errors.note = ["İznin nasıl alındığını kısaca yazın."];
    if (channel === "EMAIL" && !customer.email) errors.note = ["Bu müşterinin e-posta adresi yok."];
    if (channel !== "EMAIL" && !customer.phone) errors.note = ["Bu müşterinin telefon numarası yok."];
    if (customer.archivedAt) errors.note = ["Arşivdeki müşteri için izin kaydedilemez."];
    if (Object.keys(errors).length) throw new ValidationError(errors);
  }

  const now = new Date();
  return db.$transaction(async (tx) => {
    const consent = await tx.contactConsent.upsert({
      where: { customerId_channel: { customerId: customer.id, channel } },
      create: {
        tenantId: ctx.tenantId,
        customerId: customer.id,
        channel,
        status: input.grant ? "GRANTED" : "REVOKED",
        source: "STAFF_RECORDED",
        note: note || null,
        recordedByUserId: ctx.userId,
        grantedAt: input.grant ? now : null,
        revokedAt: input.grant ? null : now,
      },
      update: input.grant
        ? { status: "GRANTED", source: "STAFF_RECORDED", note, recordedByUserId: ctx.userId, grantedAt: now, revokedAt: null }
        : { status: "REVOKED", recordedByUserId: ctx.userId, revokedAt: now, note: note || undefined },
    });
    await logActivity(tx, ctx, {
      action: input.grant ? "consent.granted" : "consent.revoked",
      entityType: "consent",
      entityId: consent.id,
      customerId: customer.id,
      metadata: { customerName: fullName(customer), channel, note: note || undefined },
    });
    return consent;
  });
}

// ─────────────────────────────────────────────── Listeleme & arama

export type CustomerFilters = {
  q: string;
  tagId: string;
  source: CustomerSource | "";
  consent: Channel | "";
  status: "active" | "archived";
  sort: "newest" | "name";
  page: number;
};

export const PAGE_SIZE = 20;

export function parseCustomerFilters(params: Record<string, string | string[] | undefined>): CustomerFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const source = one("source");
  const consent = one("consent");
  const page = Number.parseInt(one("page"), 10);
  return {
    q: one("q").slice(0, 100),
    tagId: one("tag").slice(0, 40),
    source: isOneOf(CUSTOMER_SOURCES, source) ? source : "",
    consent: isOneOf(CHANNELS, consent) ? consent : "",
    status: one("status") === "archived" ? "archived" : "active",
    sort: one("sort") === "name" ? "name" : "newest",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Ad (Türkçe katlanmış), e-posta ve telefon rakamlarında arama koşulu. */
export function customerSearchWhere(q: string): Prisma.CustomerWhereInput | undefined {
  const query = cleanText(q);
  if (!query) return undefined;
  const or: Prisma.CustomerWhereInput[] = [{ searchName: { contains: foldText(query) } }];
  if (/[@.]/.test(query) || /[a-z]/i.test(query)) or.push({ email: { contains: query.toLowerCase() } });
  const digits = phoneSearchDigits(query);
  if (digits) or.push({ phone: { contains: digits } });
  return { OR: or };
}

export async function listCustomers(ctx: ServiceContext, filters: CustomerFilters) {
  assertCan(ctx, "customers.view");
  const where: Prisma.CustomerWhereInput = {
    tenantId: ctx.tenantId,
    archivedAt: filters.status === "archived" ? { not: null } : null,
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.tagId ? { tags: { some: { tagId: filters.tagId } } } : {}),
    ...(filters.consent ? { consents: { some: { channel: filters.consent, status: "GRANTED" } } } : {}),
    ...customerSearchWhere(filters.q),
  };
  const [total, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      include: {
        tags: { include: { tag: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
        consents: { where: { status: "GRANTED" }, select: { channel: true } },
        _count: { select: { registrations: { where: { accessStatus: "ACTIVE" } } } },
      },
      orderBy: filters.sort === "name" ? [{ searchName: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return {
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    items: rows.map((c) => ({
      id: c.id,
      name: fullName(c),
      phone: c.phone,
      email: c.email,
      source: c.source,
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
      tags: c.tags.map((t) => t.tag),
      grantedChannels: c.consents.map((x) => x.channel as Channel),
      registrationCount: c._count.registrations,
    })),
  };
}

export async function getCustomerForEdit(ctx: ServiceContext, id: string) {
  assertCan(ctx, "customers.update");
  const c = await db.customer.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: { tags: { include: { tag: { select: { name: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!c) throw new NotFoundError("Müşteri bulunamadı.");
  return { ...c, tagNames: c.tags.map((t) => t.tag.name) };
}

export async function getCustomerProfile(ctx: ServiceContext, id: string) {
  assertCan(ctx, "customers.view");
  const customer = await db.customer.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: {
      tags: { include: { tag: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      consents: true,
      venueMemberships: { include: { venue: { select: { id: true, name: true } } }, orderBy: { joinedAt: "desc" } },
      registrations: {
        where: { event: venueScope(ctx) },
        include: {
          event: {
            select: {
              id: true,
              name: true,
              startsAt: true,
              endsAt: true,
              entryClosesAt: true,
              status: true,
              venue: { select: { name: true } },
            },
          },
        },
        orderBy: { event: { startsAt: "desc" } },
      },
    },
  });
  if (!customer) throw new NotFoundError("Müşteri bulunamadı.");
  const createdBy = customer.createdByUserId
    ? await db.user.findUnique({ where: { id: customer.createdByUserId }, select: { name: true } })
    : null;
  return { customer, createdByName: createdBy?.name ?? null };
}
