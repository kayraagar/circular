import "server-only";
import { z } from "zod";
import { db, isUniqueViolation } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanText, foldText } from "@/lib/normalize";
import { VENUE_TYPES, VENUE_TYPE_LABELS, labelOf, type VenueType } from "@/lib/domain";
import { logActivity } from "@/modules/activity/service";

/**
 * Mekan yönetimi (Ayarlar › Mekanlar).
 *
 * Mekan, işletmenin şubesidir: etkinlik, kapı girişi, avantaj ve menü kampanyası mekana
 * bağlıdır. Müşteri kaydı işletme düzeyindedir, mekana bağlı değildir.
 *
 * **Kısa ad (slug) platform genelinde benzersizdir** ve müşteriye açık adreslerde görünür
 * (`/v/<slug>`). Bir kez yayınlandıktan sonra değiştirmek eski bağlantıları kırar, bu yüzden
 * yalnızca işletme sahibi değiştirebilir ve arayüz uyarır.
 *
 * Mekan **silinmez**: geçmiş etkinlik, giriş ve avantaj kayıtları ona bağlıdır. Kapatılan
 * mekan `isActive = false` olur; yeni kayıt açılmaz, geçmiş korunur.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Orbita Kulüp" → "orbita-kulup" */
export function slugify(value: string): string {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const venueSchema = z.object({
  name: z.string().trim().min(2, "Mekan adı en az 2 karakter olmalı.").max(80),
  type: z.enum(VENUE_TYPES, { message: "Mekan türü seçin." }),
  slug: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
  address: z.string().trim().max(300).optional(),
});

export type VenueView = {
  id: string;
  name: string;
  slug: string;
  type: VenueType;
  typeLabel: string;
  city: string | null;
  address: string | null;
  isActive: boolean;
  /** Kapatılamaması için sebep (tek aktif mekan gibi); null ise kapatılabilir. */
  eventCount: number;
};

function toView(v: { id: string; name: string; slug: string; type: string; city: string | null; address: string | null; isActive: boolean }, eventCount: number): VenueView {
  const type = (VENUE_TYPES as readonly string[]).includes(v.type) ? (v.type as VenueType) : "RESTAURANT";
  return {
    id: v.id,
    name: v.name,
    slug: v.slug,
    type,
    typeLabel: labelOf(VENUE_TYPE_LABELS, type),
    city: v.city,
    address: v.address,
    isActive: v.isActive,
    eventCount,
  };
}

export async function listVenues(ctx: ServiceContext): Promise<VenueView[]> {
  assertCan(ctx, "settings.view");
  const venues = await db.venue.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { _count: { select: { events: true } } },
  });
  return venues.map((v) => toView(v, v._count.events));
}

/** Kısa ad boş bırakılırsa addan türetilir; çakışırsa sonuna sayı eklenir. */
async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  const root = slugify(base) || "mekan";
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const existing = await db.venue.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === exceptId) return candidate;
  }
  throw new ValidationError({ slug: ["Bu adla benzersiz bir kısa ad üretilemedi; kendiniz yazın."] });
}

function parse(raw: Record<string, unknown>) {
  const parsed = venueSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const slug = parsed.data.slug?.trim().toLowerCase() ?? "";
  if (slug && !SLUG_RE.test(slug)) {
    throw new ValidationError({ slug: ["Kısa ad yalnızca küçük harf, rakam ve tire içerebilir (ör. orbita-kulup)."] });
  }
  return { ...parsed.data, slug };
}

export async function createVenue(ctx: ServiceContext, raw: Record<string, unknown>) {
  assertCan(ctx, "settings.view");
  const input = parse(raw);
  const slug = await uniqueSlug(input.slug || input.name);

  try {
    return await db.$transaction(async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          slug,
          type: input.type,
          city: cleanText(input.city) || null,
          address: cleanText(input.address) || null,
        },
      });
      await logActivity(tx, ctx, {
        action: "venue.created",
        entityType: "venue",
        entityId: venue.id,
        metadata: { name: venue.name, slug: venue.slug, type: venue.type },
      });
      return venue;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError({ slug: ["Bu kısa ad başka bir mekanda kullanılıyor."] });
    throw error;
  }
}

export async function updateVenue(ctx: ServiceContext, venueId: string, raw: Record<string, unknown>) {
  assertCan(ctx, "settings.view");
  const input = parse(raw);
  const venue = await db.venue.findFirst({ where: { id: venueId, tenantId: ctx.tenantId } });
  if (!venue) throw new NotFoundError("Mekan bulunamadı.");
  const slug = input.slug ? await uniqueSlug(input.slug, venue.id) : venue.slug;

  try {
    return await db.$transaction(async (tx) => {
      const updated = await tx.venue.update({
        where: { id: venue.id },
        data: {
          name: input.name,
          slug,
          type: input.type,
          city: cleanText(input.city) || null,
          address: cleanText(input.address) || null,
        },
      });
      await logActivity(tx, ctx, {
        action: "venue.updated",
        entityType: "venue",
        entityId: venue.id,
        metadata: { name: updated.name, slug: updated.slug, slugChanged: updated.slug !== venue.slug },
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError({ slug: ["Bu kısa ad başka bir mekanda kullanılıyor."] });
    throw error;
  }
}

/**
 * Mekanı kapatır veya yeniden açar. Silme yoktur: geçmiş kayıtlar mekana bağlıdır.
 * İşletmede her zaman en az bir açık mekan kalmalıdır.
 */
export async function setVenueActive(ctx: ServiceContext, venueId: string, active: boolean) {
  assertCan(ctx, "settings.view");
  const venue = await db.venue.findFirst({ where: { id: venueId, tenantId: ctx.tenantId } });
  if (!venue) throw new NotFoundError("Mekan bulunamadı.");
  if (venue.isActive === active) return venue;

  if (!active) {
    const others = await db.venue.count({ where: { tenantId: ctx.tenantId, isActive: true, id: { not: venue.id } } });
    if (others === 0) throw new ConflictError("İşletmede en az bir açık mekan kalmalı.", "LAST_VENUE");
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.venue.update({ where: { id: venue.id }, data: { isActive: active } });
    await logActivity(tx, ctx, {
      action: active ? "venue.activated" : "venue.closed",
      entityType: "venue",
      entityId: venue.id,
      metadata: { name: venue.name },
    });
    return updated;
  });
}
