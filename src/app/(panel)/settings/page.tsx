import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { formatDate, formatRelative } from "@/lib/datetime";
import { ROLE_LABELS, VENUE_TYPE_LABELS, labelOf } from "@/lib/domain";
import { brand } from "@/config/brand";
import { getTenantSettings } from "@/modules/settings/service";
import { BrandMark } from "@/components/ui/brand-mark";
import { Avatar, Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Ayarlar" };

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.view");
  const { tenant, venues, members } = await getTenantSettings(ctx.service);
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title="Ayarlar"
        description="İşletme, mekan ve ekip bilgileri. Bu aşamada salt okunurdur; davet ve düzenleme sonraki fazda eklenecek."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="İşletme" />
          <dl className="grid gap-px overflow-hidden rounded-b-card bg-line sm:grid-cols-3">
            {[
              ["İşletme adı", tenant.name],
              ["Kısa ad", <span key="slug" className="font-mono">{tenant.slug}</span>],
              ["Oluşturulma", formatDate(tenant.createdAt)],
            ].map(([label, value]) => (
              <div key={label as string} className="bg-surface px-5 py-4">
                <dt className="eyebrow">{label}</dt>
                <dd className="mt-2 text-sm text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Mekanlar" description="Bir işletmenin birden fazla mekanı/şubesi olabilir. Müşteri kaydı işletme düzeyindedir." />
          <ul>
            {venues.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 border-line px-5 py-4 sm:flex-row sm:items-center [&+li]:border-t">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{v.name}</p>
                  <p className="text-[13px] text-muted">
                    {labelOf(VENUE_TYPE_LABELS, v.type)}
                    {v.city ? ` · ${v.city}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] text-muted">/v/{v.slug}</span>
                  <Badge tone="muted">Public sayfa henüz yok</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Ekip" description="Roller sunucu tarafında uygulanır." />
          <ul>
            {members.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 border-line px-5 py-3.5 sm:flex-row sm:items-center [&+li]:border-t">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={m.user.name} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg">{m.user.name}</p>
                    <p className="truncate text-xs text-muted">{m.user.email}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-11 sm:pl-0">
                  <Badge>{labelOf(ROLE_LABELS, m.role)}</Badge>
                  {m.venueAccess.length > 0 && <Badge tone="muted">{m.venueAccess.map((a) => a.venue.name).join(", ")}</Badge>}
                  {m.status !== "ACTIVE" && <Badge tone="negative">Devre dışı</Badge>}
                  <span className="text-xs text-muted">
                    {m.user.lastLoginAt ? `Son giriş ${formatRelative(m.user.lastLoginAt, now)}` : "Henüz giriş yapmadı"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Marka" />
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <span className="inline-flex rounded-card border border-line bg-bg px-5 py-4 text-fg">
              <BrandMark />
            </span>
            <p className="text-[13px] leading-relaxed text-muted">
              {brand.logoSrc
                ? "Sağlanan logo kullanılıyor."
                : `Geçici çember sembolü kullanılıyor; nihai ${brand.name} logosu değildir. Logo dosyası sağlandığında marka yapılandırmasına eklenecek.`}{" "}
              Müşteriye açık menü ve üyelik sayfalarında mekanın kendi logosu öne çıkacak.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
