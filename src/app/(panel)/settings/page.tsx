import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { formatDate } from "@/lib/datetime";
import { VENUE_TYPE_LABELS, labelOf } from "@/lib/domain";
import { brand } from "@/config/brand";
import { getTenantSettings } from "@/modules/settings/service";
import { getTeam } from "@/modules/team/service";
import { getTenantLegal } from "@/modules/legal/tenant-legal";
import { legalDocuments } from "@/modules/legal/documents";
import { TeamManager } from "./team-manager";
import { LegalForm } from "./legal-form";
import { BrandMark } from "@/components/ui/brand-mark";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Ayarlar" };

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.view");
  const { tenant, venues } = await getTenantSettings(ctx.service);
  const [team, legal] = await Promise.all([getTeam(ctx.service), getTenantLegal(ctx.service)]);
  const documents = legalDocuments();

  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title="Ayarlar"
        description="İşletme ve mekan bilgileri salt okunurdur. Ekip üyelerini buradan davet eder, rollerini ve mekan erişimini yönetirsiniz."
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

        <TeamManager members={team.members} invites={team.invites} venues={team.venues} />

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

        {/* Yasal bölüm en altta: önce işletmenin kendi bilgileri, sonra Circular'ın metinleri. */}
        <div className="border-t border-line pt-6">
          <h2 className="eyebrow">Yasal</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
            Panele giren kişilerin verisinde veri sorumlusu {brand.name}, mekanın müşterilerinin verisinde ise işletmenizdir;{" "}
            {brand.name} bu veride veri işleyendir.
          </p>
        </div>

        <LegalForm legal={legal} />

        <Card>
          <CardHeader title={`${brand.name} yasal metinleri`} description="Herkese açık; müşterilerinizle de paylaşabilirsiniz." />
          <ul className="p-2">
            {documents.map((doc) => (
              <li key={doc.slug}>
                <Link href={`/yasal/${doc.slug}`} className="flex flex-col gap-1 rounded-field px-3 py-3 transition-colors hover:bg-raised sm:flex-row sm:items-center sm:gap-4">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-fg">{doc.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{doc.summary}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tracking-wide text-muted">
                    v{doc.version} · {doc.updatedAt}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
