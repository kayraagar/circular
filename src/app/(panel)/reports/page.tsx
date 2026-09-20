import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { formatDate } from "@/lib/datetime";
import { firstParam, type SearchParams } from "@/lib/page";
import { CHANNELS, CHANNEL_LABELS } from "@/lib/domain";
import { CAMPAIGN_CHANNEL_LABELS } from "@/modules/campaigns/rules";
import { getReports, parseReportPeriod, REPORT_PERIODS } from "@/modules/reports/service";
import { CheckInRing } from "@/components/guests/checkin-ring";
import { AreaChart, BarChart, CHART_COLORS, Donut, KpiTile, RatioRows, formatNumber, formatPercent } from "@/components/reports/charts";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Raporlar" };

/** Raporlar: gerçek girişler, kayıtlar, müşteri kazanımı, PR katkısı ve kampanya sonuçları. */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("reports.view");
  const period = parseReportPeriod(firstParam((await searchParams).period));
  const r = await getReports(ctx.service, { periodDays: period, venueId: ctx.activeVenue?.id ?? null });
  const venueLabel = ctx.activeVenue?.name ?? (ctx.venues.length > 1 ? "Tüm mekanlar" : (ctx.venues[0]?.name ?? ""));
  const t = r.totals;

  return (
    <>
      <PageHeader
        eyebrow={`${ctx.tenant.name} · ${venueLabel}`}
        title="Raporlar"
        description={`${formatDate(r.from)} – ${formatDate(r.to)} · sayılar kayıtlardan anlık hesaplanır`}
        actions={
          <nav aria-label="Dönem" className="inline-flex rounded-field border border-line p-0.5">
            {REPORT_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/reports?period=${p}`}
                aria-current={p === period ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 font-mono text-[12px] transition-colors ${p === period ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
              >
                {p} gün
              </Link>
            ))}
          </nav>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Kapıdan giren kişi"
          value={t.admitted.current}
          previous={t.admitted.previous}
          points={r.series.visits}
          detail={`${formatNumber(t.uniqueVisitors)} farklı kişi`}
        />
        <KpiTile
          label="Yeni müşteri"
          value={t.newCustomers.current}
          previous={t.newCustomers.previous}
          points={r.series.customers}
          color={CHART_COLORS[2]}
          detail={t.revokedConsents > 0 ? `${formatNumber(t.revokedConsents)} izin kaldırıldı` : undefined}
        />
        <KpiTile
          label="Etkinlik kaydı"
          value={t.registrations.current}
          previous={t.registrations.previous}
          points={r.series.registrations}
          color={CHART_COLORS[1]}
          detail={`${formatNumber(t.invitedPeople)} kişilik davet`}
        />
        <KpiTile
          label="Avantaj kullanımı"
          value={t.redemptions.current}
          previous={t.redemptions.previous}
          color={CHART_COLORS[3]}
          detail={t.returningVisits > 0 ? `${formatNumber(t.returningVisits)} tekrar ziyaret` : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Günlük giriş" description="Kapıda doğrulanan kişi sayısı" />
          <div className="px-5 pt-2 pb-5">
            <AreaChart id="visits" points={r.series.visits} ariaLabel={`Son ${period} günde günlük giriş sayısı`} />
          </div>
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Geliş oranı" description="Davetlinin kapıdan girme oranı" />
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-5">
            <CheckInRing
              id="report-show-rate"
              ratio={t.showRate}
              size={132}
              label={`${formatNumber(t.invitedPeople)} davetli kişinin ${formatNumber(t.registrationsAdmitted)} kişisi geldi`}
              caption="geldi"
            />
            <p className="text-center text-[13px] text-muted" data-numeric>
              {formatNumber(t.registrationsAdmitted)} / {formatNumber(t.invitedPeople)} kişi
            </p>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Saate göre giriş" description="En yoğun saatler" />
          <div className="px-5 pt-2 pb-5">
            <BarChart points={r.hourly} labelEvery={3} unit="kişi" ariaLabel="Saate göre giriş dağılımı" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Güne göre giriş" description="Haftanın günleri" />
          <div className="px-5 pt-2 pb-5">
            <BarChart points={r.weekly} color={CHART_COLORS[2]} unit="kişi" ariaLabel="Haftanın günlerine göre giriş dağılımı" />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Etkinlikler" description="Biten etkinliklerde davetli ve gerçek giriş" />
          <div className="p-5">
            <RatioRows
              emptyText="Bu dönemde biten etkinlik yok"
              rows={r.events.map((e) => ({
                label: e.name,
                sub: `${formatDate(e.startsAt)} · ${e.venueName}${e.capacity ? ` · kapasite ${formatNumber(e.capacity)}` : ""}`,
                value: e.admitted,
                valueLabel: `${formatNumber(e.admitted)} / ${formatNumber(e.people)} kişi · ${formatPercent(e.rate)}`,
                ratio: e.rate,
              }))}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="PR katkısı" description="Getirdiği ve içeri giren kişi" />
          <div className="p-5">
            <RatioRows
              color={CHART_COLORS[1]}
              emptyText="Bu dönemde PR kaydı yok"
              rows={r.promoters.map((p) => ({
                label: p.name,
                value: p.admitted,
                valueLabel: `${formatNumber(p.admitted)} / ${formatNumber(p.people)} kişi`,
                ratio: p.people > 0 ? p.admitted / p.people : 0,
              }))}
            />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Yeni müşteri kaynağı" description={`${period} günde eklenenler`} />
          <div className="p-5">
            <Donut slices={r.sources} centerValue={formatNumber(t.newCustomers.current)} centerLabel="yeni kişi" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Guest kanalı" description="Kayıtları kim getirdi" />
          <div className="p-5">
            <Donut slices={r.guestMix} centerValue={formatNumber(t.invitedPeople)} centerLabel="davetli kişi" />
          </div>
        </Card>
        <Card>
          <CardHeader title="İletişim izni" description="Arşiv hariç, güncel durum" />
          <div className="p-5">
            <RatioRows
              color={CHART_COLORS[2]}
              rows={CHANNELS.map((c) => ({ label: CHANNEL_LABELS[c], value: r.consents[c], valueLabel: `${formatNumber(r.consents[c])} kişi` }))}
            />
            {r.perks.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-3 text-[13px] font-medium text-muted">Avantajlar</p>
                <RatioRows color={CHART_COLORS[3]} rows={r.perks.map((p) => ({ label: p.label, value: p.value, valueLabel: `${formatNumber(p.value)} kullanım` }))} />
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Kampanya sonuçları" description="Sağlayıcıların bildirdiği gerçek durumlar" />
        {r.campaigns.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted">Bu dönemde kampanya gönderilmedi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-medium">Kanal</th>
                  <th className="px-3 py-2.5 text-right font-medium">İletildi</th>
                  <th className="px-3 py-2.5 text-right font-medium">Teslim</th>
                  <th className="px-3 py-2.5 text-right font-medium">Okundu / açıldı</th>
                  <th className="px-5 py-2.5 text-right font-medium">Sorunlu</th>
                </tr>
              </thead>
              <tbody>
                {r.campaigns.map((c) => (
                  <tr key={c.channel} className="border-line [&+tr]:border-t">
                    <td className="px-5 py-3 text-fg">{CAMPAIGN_CHANNEL_LABELS[c.channel]}</td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {formatNumber(c.accepted)}
                    </td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {formatNumber(c.delivered)}
                    </td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {formatNumber(c.channel === "EMAIL" ? c.opened : c.read)}
                    </td>
                    <td className={`px-5 py-3 text-right ${c.problems ? "text-caution" : "text-muted"}`} data-numeric>
                      {formatNumber(c.problems)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        Ölçülmeyenler: menü görüntüleme, ciro ve kampanya dönüşümü. Bu veriler toplanmadığı için raporlarda tahmin edilmez.
      </p>
    </>
  );
}
