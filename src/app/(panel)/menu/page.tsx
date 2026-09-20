import type { Metadata } from "next";
import { menuFontVariables } from "@/components/menu/fonts";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/primitives";
import { can } from "@/lib/authz";
import { requirePermission } from "@/lib/context";
import { publicMenuPath } from "@/modules/menu/campaign";
import { absoluteUrl } from "@/modules/passes/token";
import { MenuQrCard } from "@/components/menu/menu-qr-card";
import { getCampaignOptions, getMenuCampaign } from "@/modules/menu/campaign-service";
import { getMenu } from "@/modules/menu/service";
import { MenuBuilder } from "./builder/builder";

export const metadata: Metadata = { title: "QR Menü" };

/**
 * QR Menü: menü oluşturucu (şablon, tasarım, içerik, kampanya) ve canlı önizleme.
 * Veri tenant'a göre servis katmanında filtrelenir (menu.manage yetkisi).
 */
export default async function MenuPage() {
  const ctx = await requirePermission("menu.manage");
  const [menu, campaign, campaignOptions] = await Promise.all([
    getMenu(ctx.service),
    getMenuCampaign(ctx.service),
    getCampaignOptions(ctx.service),
  ]);
  const hasPublicContent = menu.categories.some((c) => c.items.some((i) => i.isAvailable));

  return (
    <div className={menuFontVariables}>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title="QR Menü"
        description="Şablon seçin, markanıza göre kişiselleştirin, kategori ve ürünleri fotoğraflarıyla ekleyin; kampanya popup'ı ile menüden üye toplayın. Önizleme, müşterinin göreceği ekranı gösterir."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(ctx.membership.role, "perks.manage") && (
              <ButtonLink href="/menu/perks" variant="secondary">
                Avantajlar
              </ButtonLink>
            )}
            {hasPublicContent && (
              <ButtonLink href={publicMenuPath(ctx.tenant.slug)} target="_blank" rel="noopener" variant="ghost">
                Açık menüyü gör
              </ButtonLink>
            )}
          </div>
        }
      />
      <MenuBuilder
        menu={menu}
        title={ctx.activeVenue?.name ?? ctx.tenant.name}
        campaign={campaign}
        campaignOptions={campaignOptions}
        slug={ctx.tenant.slug}
      />
      <div className="mt-6 max-w-sm">
        <MenuQrCard url={absoluteUrl(publicMenuPath(ctx.tenant.slug))} />
      </div>
    </div>
  );
}
