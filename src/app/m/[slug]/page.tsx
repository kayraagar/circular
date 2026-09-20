import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CampaignPopup } from "@/components/menu/campaign-popup";
import { menuFontVariables } from "@/components/menu/fonts";
import { MenuPreview } from "@/components/menu/menu-preview";
import { signupPath } from "@/modules/menu/campaign";
import { getPublicMenu } from "@/modules/menu/public";
import { readableForeground, withAlpha } from "@/modules/menu/theme";

type Params = { params: Promise<{ slug: string }> };

const load = cache((slug: string) => getPublicMenu(slug));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).slug);
  return { title: { absolute: data ? `${data.tenant.name} — Menü` : "Menü" } };
}

export async function generateViewport({ params }: Params): Promise<Viewport> {
  const data = await load((await params).slug);
  return { themeColor: data?.menu.config.backgroundColor ?? "#080808" };
}

/** Müşteriye açık menü: QR ile açılır, oturum gerektirmez. */
export default async function PublicMenuPage({ params }: Params) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { tenant, menu, campaign } = data;
  const fg = menu.config.textColor ?? readableForeground(menu.config.backgroundColor);

  return (
    <div className={`${menuFontVariables} min-h-dvh`} style={{ background: menu.config.backgroundColor }}>
      <main className="mx-auto w-full max-w-[520px]">
        <MenuPreview config={menu.config} categories={menu.categories} title={tenant.name} allowSample={false} />
      </main>
      <footer className="mx-auto w-full max-w-[520px] px-5 pb-10 text-center">
        <Link
          href={signupPath(tenant.slug)}
          className="inline-flex h-11 items-center justify-center rounded-full px-5 text-[13px] font-medium"
          style={{ border: `1px solid ${withAlpha(fg, 0.2)}`, color: fg }}
        >
          Üye ol, ayrıcalıklardan haberdar ol
        </Link>
      </footer>
      {campaign && (
        <CampaignPopup
          campaign={campaign}
          config={menu.config}
          href={signupPath(tenant.slug)}
          storageKey={`circular:menu-popup:${tenant.slug}:${campaign.title}`}
        />
      )}
    </div>
  );
}
