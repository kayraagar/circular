import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CircleMotif } from "@/components/menu/menu-preview";
import { menuFontVariables } from "@/components/menu/fonts";
import { publicMenuPath } from "@/modules/menu/campaign";
import { getPublicMenu } from "@/modules/menu/public";
import { readTenantLegal } from "@/modules/legal/tenant-legal";
import { readableForeground, withAlpha } from "@/modules/menu/theme";
import { SignupForm } from "./signup-form";

type Params = { params: Promise<{ slug: string }> };

const load = cache((slug: string) => getPublicMenu(slug));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).slug);
  return { title: { absolute: data ? `${data.tenant.name} — Üyelik` : "Üyelik" } };
}

/** Menüden kayıt: kişi kendi bilgisini girer, kayıt işletmenin CRM'ine düşer. */
export default async function SignupPage({ params }: Params) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { tenant, menu, campaign } = data;
  const legal = await readTenantLegal(tenant.id);
  const { config } = menu;
  const fg = config.textColor ?? readableForeground(config.backgroundColor);
  const muted = withAlpha(fg, 0.64);
  const line = withAlpha(fg, 0.14);

  return (
    <div className={`${menuFontVariables} min-h-dvh px-4 py-6 sm:py-10`} style={{ background: config.backgroundColor, color: fg }}>
      <div className="mx-auto w-full max-w-md">
        <Link href={publicMenuPath(tenant.slug)} className="text-[13px]" style={{ color: muted }}>
          ← Menüye dön
        </Link>

        <header className="mt-6 flex items-center gap-3">
          {config.logoSrc ? (
            <div role="img" aria-label={`${tenant.name} logosu`} className="size-12 shrink-0 rounded-full bg-cover bg-center" style={{ backgroundImage: `url("${config.logoSrc}")` }} />
          ) : (
            <CircleMotif color={fg} size={48} />
          )}
          <div className="min-w-0">
            <h1 className="text-[24px] leading-tight font-medium" style={{ fontFamily: "var(--font-display)" }}>
              {tenant.name} üyeliği
            </h1>
            <p className="mt-0.5 text-[13px]" style={{ color: muted }}>
              Kısa formu doldurun; kaydınız doğrudan işletmeye iletilir.
            </p>
          </div>
        </header>

        {campaign && (
          <section className="mt-6 overflow-hidden rounded-2xl" style={{ border: `1px solid ${line}` }}>
            {campaign.imageSrc && (
              <div role="img" aria-label="Kampanya görseli" className="aspect-[4/3] w-full bg-cover bg-center" style={{ backgroundImage: `url("${campaign.imageSrc}")` }} />
            )}
            <div className="p-4">
              {campaign.perkName && (
                <span
                  className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: config.accentColor, color: readableForeground(config.accentColor) }}
                >
                  Yeni üyeye ikram · {campaign.perkName}
                </span>
              )}
              <p className="mt-2 text-[17px] leading-snug font-medium">{campaign.title}</p>
              {campaign.description && (
                <p className="mt-1 text-[13px] leading-relaxed" style={{ color: muted }}>
                  {campaign.description}
                </p>
              )}
              {campaign.perkTerms && (
                <p className="mt-2 text-[12px] leading-relaxed" style={{ color: muted }}>
                  Koşullar: {campaign.perkTerms}
                </p>
              )}
            </div>
          </section>
        )}

        <SignupForm
          slug={tenant.slug}
          tenantName={tenant.name}
          perkName={campaign?.perkName ?? null}
          privacyUrl={legal.privacyUrl ?? campaign?.privacyUrl ?? null}
          legal={{ name: legal.legalName, email: legal.legalEmail, address: legal.legalAddress, ready: legal.ready }}
          colors={{ fg, accent: config.accentColor, background: config.backgroundColor }}
        />
      </div>
    </div>
  );
}
