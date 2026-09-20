import "server-only";
import { db, isUniqueViolation } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { foldText, fullName } from "@/lib/normalize";
import { CHANNELS, isOneOf, type Channel } from "@/lib/domain";
import { createRateLimiter } from "@/lib/rate-limit";
import { logActivity } from "@/modules/activity/service";
import { findContactConflict, parseContactFields } from "@/modules/customers/service";
import { createPass } from "@/modules/passes/internal";
import { evaluatePerkPass } from "@/modules/passes/rules";
import { derivePassToken } from "@/modules/passes/token";
import { readPublicMenuAsset } from "./assets";
import { SIGNUP_CONSENT_TEXT_VERSION, publicAssetUrl, type MenuCampaignView } from "./campaign";
import { toCampaignView } from "./campaign-service";
import { toConfigView, toItemView } from "./service";
import type { MenuView } from "./theme";

/**
 * Herkese açık menü ve menüden kayıt. Oturum gerektirmez; tenant slug ile çözülür.
 *
 * Güvenlik kuralları:
 * - Yalnızca kaydedilmiş ve menüde görünen içerik döner; örnek içerik hiçbir zaman gösterilmez.
 * - İletişim bilgisi CRM'de zaten varsa hiçbir kayıt değiştirilmez ve avantaj verilmez
 *   (telefon doğrulaması olmadığından başkasının numarasıyla izin eklenemez, avantajı alınamaz).
 * - İletişim izinleri yalnızca kişinin işaretlediği kanallar için, form metni sürümüyle kaydedilir.
 */

const SLUG = /^[a-z0-9-]{2,60}$/;
const SIGNUP_NOTE = "Menü kayıt formu";

async function findTenant(slug: string) {
  if (!SLUG.test(slug)) return null;
  return db.tenant.findFirst({ where: { slug, status: "ACTIVE" }, select: { id: true, name: true, slug: true } });
}

export type PublicMenu = {
  tenant: { id: string; name: string; slug: string };
  menu: MenuView;
  campaign: MenuCampaignView | null;
  hasContent: boolean;
};

export async function getPublicMenu(slug: string, now = new Date()): Promise<PublicMenu | null> {
  const tenant = await findTenant(slug);
  if (!tenant) return null;
  const src = (assetId: string) => publicAssetUrl(tenant.slug, assetId);

  const [config, categories, campaign] = await Promise.all([
    db.menuConfig.findUnique({ where: { tenantId: tenant.id } }),
    db.menuCategory.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: { items: { where: { isAvailable: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
    }),
    db.menuCampaign.findUnique({ where: { tenantId: tenant.id }, include: { perk: true } }),
  ]);

  const visible = categories
    .filter((c) => c.items.length > 0)
    .map((c) => ({ id: c.id, name: c.name, description: c.description, order: c.order, items: c.items.map((i) => toItemView(i, src)) }));

  let campaignView: MenuCampaignView | null = null;
  if (campaign?.isActive) {
    campaignView = toCampaignView(campaign, src);
    // Süresi dolmuş/arşivlenmiş avantaj popup'ta vaat edilmez.
    const perkState = campaign.perk ? evaluatePerkPass({ revokedAt: null, useCount: 0, maxUses: 1 }, campaign.perk, 0, now) : null;
    if (perkState !== "VALID" && perkState !== "NOT_YET_VALID") {
      campaignView = { ...campaignView, perkId: null, perkName: null, perkTerms: null };
    }
  }

  return {
    tenant,
    menu: { config: toConfigView(config, src), categories: visible },
    campaign: campaignView,
    hasContent: visible.length > 0,
  };
}

/** Herkese açık görsel: slug'ın işletmesine ait ve kaydedilmiş menüde kullanılan görsel. */
export async function readPublicMenuAssetBySlug(slug: string, assetId: string) {
  const tenant = await findTenant(slug);
  return tenant ? readPublicMenuAsset(tenant.id, assetId) : null;
}

// ─────────────────────────────────────────────── Menüden kayıt

const signupLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

/** Yalnızca testler için. */
export function resetSignupRateLimit() {
  signupLimiter.reset();
}

export type SignupResult =
  | { status: "created"; passToken: string | null; perk: "ISSUED" | "NONE" | "UNAVAILABLE" }
  | { status: "existing" }
  | { status: "ignored" };

export type SignupInput = {
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  email?: unknown;
  /** Bal küpü alanı: insanlara gizlidir, otomatik doldurucular doldurur. */
  website?: unknown;
  consents?: unknown;
};

export async function publicSignup(slug: string, raw: SignupInput, meta: { ip: string; now?: Date }): Promise<SignupResult> {
  const tenant = await findTenant(slug);
  if (!tenant) throw new NotFoundError("İşletme bulunamadı.");

  const limit = signupLimiter.hit(`${meta.ip}|${tenant.id}`);
  if (!limit.allowed) {
    throw new ConflictError(`Kısa sürede çok fazla deneme yapıldı. ${Math.max(1, Math.ceil(limit.retryAfterSec / 60))} dakika sonra tekrar deneyin.`, "RATE_LIMITED");
  }
  if (typeof raw.website === "string" && raw.website.trim() !== "") return { status: "ignored" };

  const errors: FieldErrors = {};
  const add = (key: string, message: string) => (errors[key] = [...(errors[key] ?? []), message]);
  const contact = parseContactFields(
    { firstName: raw.firstName ?? "", lastName: raw.lastName ?? "", phone: raw.phone ?? "", email: raw.email ?? "" },
    errors,
  );
  const phoneEntered = typeof raw.phone === "string" && raw.phone.trim() !== "";
  if (contact && !phoneEntered && !errors.phone) add("phone", "Telefon numarası gerekli.");

  const requested = Array.isArray(raw.consents) ? raw.consents : [];
  const channels = [...new Set(requested.filter((c): c is Channel => isOneOf(CHANNELS, c)))];
  if (requested.some((c) => !isOneOf(CHANNELS, c))) add("consents", "Geçersiz iletişim tercihi.");
  if (contact && channels.includes("EMAIL") && !contact.email) add("email", "E-posta ile duyuru almak için e-posta adresinizi yazın.");
  if (Object.keys(errors).length > 0 || !contact) throw new ValidationError(errors);

  // Bilgi zaten kayıtlıysa hiçbir şey değiştirilmez.
  if (await findContactConflict(tenant.id, contact)) return { status: "existing" };

  const now = meta.now ?? new Date();
  const campaign = await db.menuCampaign.findUnique({ where: { tenantId: tenant.id }, include: { perk: true } });
  const active = campaign?.isActive ? campaign : null;

  let venueId = active?.venueId ?? null;
  if (!venueId) {
    const venues = await db.venue.findMany({ where: { tenantId: tenant.id, isActive: true }, select: { id: true }, take: 2 });
    if (venues.length === 1) venueId = venues[0].id;
  }

  const actor = { tenantId: tenant.id, userId: null };
  try {
    return await db.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId: tenant.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          searchName: foldText(`${contact.firstName} ${contact.lastName}`),
          phone: contact.phone,
          email: contact.email,
          source: "QR_MENU",
          sourceVenueId: venueId,
        },
      });
      const customerName = fullName(customer);
      await logActivity(tx, actor, {
        action: "customer.self_registered",
        entityType: "customer",
        entityId: customer.id,
        customerId: customer.id,
        metadata: { customerName, campaignTitle: active?.title },
      });

      for (const channel of channels) {
        const consent = await tx.contactConsent.create({
          data: {
            tenantId: tenant.id,
            customerId: customer.id,
            channel,
            status: "GRANTED",
            source: "PUBLIC_SIGNUP",
            note: SIGNUP_NOTE,
            consentTextVersion: SIGNUP_CONSENT_TEXT_VERSION,
            grantedAt: now,
          },
        });
        await logActivity(tx, actor, {
          action: "consent.granted",
          entityType: "consent",
          entityId: consent.id,
          customerId: customer.id,
          metadata: { customerName, channel, note: SIGNUP_NOTE },
        });
      }

      if (venueId) {
        await tx.venueMembership.create({
          data: { tenantId: tenant.id, venueId, customerId: customer.id, source: "QR_MENU", joinedAt: now },
        });
      }

      const perk = active?.perk ?? null;
      if (!perk) return { status: "created", passToken: null, perk: "NONE" } as const;

      const state = evaluatePerkPass({ revokedAt: null, useCount: 0, maxUses: 1 }, perk, 0, now);
      if (state !== "VALID" && state !== "NOT_YET_VALID") return { status: "created", passToken: null, perk: "UNAVAILABLE" } as const;

      const pass = await createPass(tx, {
        tenantId: tenant.id,
        purpose: "PERK_REDEMPTION",
        customerId: customer.id,
        perkId: perk.id,
        maxUses: perk.perCustomerLimit,
        issuedByUserId: null,
      });
      await logActivity(tx, actor, {
        action: "pass.issued",
        entityType: "pass",
        entityId: pass.id,
        customerId: customer.id,
        metadata: { customerName, perkName: perk.name, purpose: "PERK_REDEMPTION" },
      });
      return { status: "created", passToken: derivePassToken(pass.id), perk: "ISSUED" } as const;
    });
  } catch (error) {
    // Aynı bilgiyle eşzamanlı ikinci gönderim: ilk kayıt geçerlidir, ikinci hiçbir şey değiştirmez.
    if (isUniqueViolation(error)) return { status: "existing" };
    throw error;
  }
}
