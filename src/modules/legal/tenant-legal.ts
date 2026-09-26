import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ValidationError } from "@/lib/errors";
import { cleanText, normalizeEmail } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";

/**
 * İşletmenin veri sorumlusu bilgileri.
 *
 * Müşteriye açık formlarda (QR menü kaydı, PR davet linki) veri toplanmadan önce
 * veri sorumlusunun kimliği ve aydınlatma metni gösterilmelidir (KVKK m.10).
 * Bu bilgiler işletmeye aittir; uygulama uydurmaz, eksikse formda eksik olduğunu söyler.
 */

export type TenantLegal = {
  legalName: string | null;
  legalAddress: string | null;
  mersis: string | null;
  verbisId: string | null;
  legalEmail: string | null;
  legalPhone: string | null;
  privacyUrl: string | null;
};

export type TenantLegalView = TenantLegal & {
  /** Müşteriye açık formda gösterilecek asgari bilgi tamam mı? */
  ready: boolean;
  missing: string[];
};

const EMPTY: TenantLegal = {
  legalName: null,
  legalAddress: null,
  mersis: null,
  verbisId: null,
  legalEmail: null,
  legalPhone: null,
  privacyUrl: null,
};

/** Kayıt formunun yasal olarak gösterilebilmesi için gereken asgari alanlar. */
export function legalGaps(legal: TenantLegal): string[] {
  const missing: string[] = [];
  if (!legal.legalName) missing.push("Ticaret unvanı");
  if (!legal.legalEmail) missing.push("Başvuru e-postası");
  if (!legal.privacyUrl) missing.push("Aydınlatma metni adresi");
  return missing;
}

function toView(legal: TenantLegal): TenantLegalView {
  const missing = legalGaps(legal);
  return { ...legal, missing, ready: missing.length === 0 };
}

export async function getTenantLegal(ctx: ServiceContext): Promise<TenantLegalView> {
  assertCan(ctx, "settings.view");
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: selectLegal });
  return toView(tenant);
}

/** Herkese açık sayfalar için (oturum yok): yalnızca gösterilecek alanlar. */
export async function readTenantLegal(tenantId: string): Promise<TenantLegalView> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: selectLegal });
  return toView(tenant ?? EMPTY);
}

const selectLegal = {
  legalName: true,
  legalAddress: true,
  mersis: true,
  verbisId: true,
  legalEmail: true,
  legalPhone: true,
  privacyUrl: true,
} as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${max} karakter.`)
    .transform((v) => cleanText(v) || null)
    .nullable();

const schema = z.object({
  legalName: optionalText(200),
  legalAddress: optionalText(400),
  mersis: optionalText(40),
  verbisId: optionalText(40),
  legalEmail: z
    .string()
    .trim()
    .max(254)
    .transform((v) => v || null)
    .nullable(),
  legalPhone: optionalText(40),
  privacyUrl: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null)
    .nullable(),
});

export async function saveTenantLegal(ctx: ServiceContext, raw: unknown): Promise<TenantLegalView> {
  assertCan(ctx, "team.manage");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const data = parsed.data;

  const email = data.legalEmail ? normalizeEmail(data.legalEmail) : null;
  if (data.legalEmail && (!email || !email.includes("@"))) throw new ValidationError({ legalEmail: ["Geçerli bir e-posta adresi girin."] });

  // Aydınlatma metni herkese açık bir adres olmalı; müşteri tarayıcısından açılacak.
  let privacyUrl = data.privacyUrl;
  if (privacyUrl) {
    try {
      const url = new URL(privacyUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("şema");
      privacyUrl = url.toString();
    } catch {
      throw new ValidationError({ privacyUrl: ["Adres https:// ile başlamalı, ör. https://ornek.com/aydinlatma"] });
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: ctx.tenantId },
      data: { ...data, legalEmail: email, privacyUrl },
      select: selectLegal,
    });
    await logActivity(tx, ctx, {
      action: "tenant.legal_updated",
      entityType: "tenant",
      entityId: ctx.tenantId,
      metadata: { fields: Object.keys(data).filter((k) => data[k as keyof typeof data] !== null) },
    });
    return tenant;
  });
  return toView(updated);
}
