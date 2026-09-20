import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ValidationError, type FieldErrors } from "@/lib/errors";
import { cleanText } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";
import { deleteAssetsIfUnused, findUsableAsset } from "./assets";
import { CAMPAIGN_LIMITS, EMPTY_CAMPAIGN, type MenuCampaignView } from "./campaign";
import { assetUrl } from "./theme";

/**
 * Menü kampanya popup'ı — panel tarafı (tasarım ve yayın).
 * Kayıt akışının kendisi herkese açık servis modülündedir (./public.ts).
 */

const CAMPAIGN_INCLUDE = { perk: { select: { name: true, terms: true } } } satisfies Prisma.MenuCampaignInclude;
type CampaignRow = Prisma.MenuCampaignGetPayload<{ include: typeof CAMPAIGN_INCLUDE }>;

export function toCampaignView(row: CampaignRow | null, src: (assetId: string) => string = assetUrl): MenuCampaignView {
  if (!row) return EMPTY_CAMPAIGN;
  return {
    isActive: row.isActive,
    title: row.title,
    description: row.description,
    ctaLabel: row.ctaLabel,
    imageAssetId: row.imageAssetId,
    imageSrc: row.imageAssetId ? src(row.imageAssetId) : null,
    perkId: row.perkId,
    perkName: row.perk?.name ?? null,
    perkTerms: row.perk?.terms ?? null,
    venueId: row.venueId,
    delaySeconds: row.delaySeconds,
    privacyUrl: row.privacyUrl,
  };
}

export async function getMenuCampaign(ctx: ServiceContext): Promise<MenuCampaignView> {
  assertCan(ctx, "menu.manage");
  const row = await db.menuCampaign.findUnique({ where: { tenantId: ctx.tenantId }, include: CAMPAIGN_INCLUDE });
  return toCampaignView(row);
}

/** Popup formundaki seçimler: aktif avantajlar ve mekanlar. */
export async function getCampaignOptions(ctx: ServiceContext) {
  assertCan(ctx, "menu.manage");
  const [perks, venues] = await Promise.all([
    db.perk.findMany({
      where: { tenantId: ctx.tenantId, status: "ACTIVE" },
      select: { id: true, name: true, venueId: true, perCustomerLimit: true, validUntil: true },
      orderBy: { createdAt: "desc" },
    }),
    db.venue.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { perks, venues };
}

const campaignSchema = z.object({
  isActive: z.string().trim().default(""),
  title: z.string().trim().max(CAMPAIGN_LIMITS.title, `Başlık en fazla ${CAMPAIGN_LIMITS.title} karakter olabilir.`).default(""),
  description: z
    .string()
    .trim()
    .max(CAMPAIGN_LIMITS.description, `Açıklama en fazla ${CAMPAIGN_LIMITS.description} karakter olabilir.`)
    .default(""),
  ctaLabel: z.string().trim().max(CAMPAIGN_LIMITS.cta, `Düğme metni en fazla ${CAMPAIGN_LIMITS.cta} karakter olabilir.`).default(""),
  imageAssetId: z.string().trim().max(64).default(""),
  perkId: z.string().trim().max(64).default(""),
  venueId: z.string().trim().max(64).default(""),
  delaySeconds: z.string().trim().default("3"),
  privacyUrl: z.string().trim().max(500, "Adres en fazla 500 karakter olabilir.").default(""),
});

export async function saveMenuCampaign(ctx: ServiceContext, raw: unknown): Promise<MenuCampaignView> {
  assertCan(ctx, "menu.manage");
  const parsed = campaignSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const v = parsed.data;
  const errors: FieldErrors = {};
  const add = (key: string, message: string) => (errors[key] = [...(errors[key] ?? []), message]);

  const isActive = v.isActive === "1" || v.isActive === "true" || v.isActive === "on";
  const title = cleanText(v.title);
  if (title.length < 2) add("title", "Popup başlığı en az 2 karakter olmalı.");
  const ctaLabel = cleanText(v.ctaLabel) || EMPTY_CAMPAIGN.ctaLabel;
  if (ctaLabel.length < 2) add("ctaLabel", "Düğme metni en az 2 karakter olmalı.");

  const delay = Number(v.delaySeconds);
  if (!Number.isInteger(delay) || delay < 0 || delay > CAMPAIGN_LIMITS.maxDelaySeconds) {
    add("delaySeconds", `Gecikme 0 ile ${CAMPAIGN_LIMITS.maxDelaySeconds} saniye arasında olmalı.`);
  }
  if (v.privacyUrl && !/^https?:\/\/\S+$/.test(v.privacyUrl)) add("privacyUrl", "Adres http:// veya https:// ile başlamalı.");

  const image = await findUsableAsset(ctx, v.imageAssetId, ["CAMPAIGN"]);
  if (!image.valid) add("imageAssetId", "Popup görseli bulunamadı; yeniden yükleyin.");

  const [perk, venue, venueCount] = await Promise.all([
    v.perkId ? db.perk.findFirst({ where: { id: v.perkId, tenantId: ctx.tenantId } }) : null,
    v.venueId ? db.venue.findFirst({ where: { id: v.venueId, tenantId: ctx.tenantId, isActive: true } }) : null,
    db.venue.count({ where: { tenantId: ctx.tenantId, isActive: true } }),
  ]);
  if (v.perkId && !perk) add("perkId", "Geçerli bir avantaj seçin.");
  if (perk && isActive && perk.status !== "ACTIVE") add("perkId", "Bağlı avantaj aktif değil; yayına almadan önce başka bir avantaj seçin.");
  if (v.venueId && !venue) add("venueId", "Geçerli bir mekan seçin.");

  // Avantaj belirli bir mekanda geçerliyse üyelik de o mekanda açılır (tutarsız teklif önlenir).
  let venueId = venue?.id ?? null;
  if (perk?.venueId) {
    if (venueId && venueId !== perk.venueId) add("venueId", "Seçilen avantaj başka bir mekanda geçerli; üyelik mekanı aynı olmalı.");
    venueId = perk.venueId;
  }
  if (isActive && !venueId && venueCount > 1) {
    add("venueId", "Birden fazla mekanınız var: kayıt olanların hangi mekanın üyesi olacağını seçin.");
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const existing = await db.menuCampaign.findUnique({ where: { tenantId: ctx.tenantId } });
  const data = {
    isActive,
    title,
    description: v.description ? cleanText(v.description) : null,
    ctaLabel,
    imageAssetId: image.id,
    perkId: perk?.id ?? null,
    venueId,
    delaySeconds: delay,
    privacyUrl: v.privacyUrl || null,
  };

  const saved = await db.$transaction(async (tx) => {
    const row = await tx.menuCampaign.upsert({
      where: { tenantId: ctx.tenantId },
      create: { tenantId: ctx.tenantId, ...data },
      update: data,
      include: CAMPAIGN_INCLUDE,
    });
    if (existing?.imageAssetId && existing.imageAssetId !== row.imageAssetId) {
      await deleteAssetsIfUnused(tx, ctx.tenantId, [existing.imageAssetId]);
    }
    await logActivity(tx, ctx, {
      action: "menu.campaign_updated",
      entityType: "menu",
      entityId: row.id,
      metadata: { title: row.title, isActive: row.isActive, perkName: row.perk?.name },
    });
    return row;
  });
  return toCampaignView(saved);
}
