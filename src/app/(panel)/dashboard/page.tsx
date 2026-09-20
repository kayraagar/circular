import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { can } from "@/lib/authz";
import { firstParam, type SearchParams } from "@/lib/page";
import { formatRange } from "@/lib/datetime";
import { CHANNELS, CHANNEL_LABELS, CUSTOMER_SOURCE_LABELS, labelOf } from "@/lib/domain";
import { getDashboard, parsePeriod, PERIODS } from "@/modules/dashboard/service";
import { getVerifiedSummary } from "@/modules/passes/service";
import { ActivityFeed } from "@/components/activity-feed";
import { DateBlock } from "@/components/date-block";
import { EventStatusBadge } from "@/components/event-status-badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader, RingMeter, Stat } from "@/components/ui/primitives";
import { IconPlus } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Genel Bakış" };

const nf = new Intl.NumberFormat("tr-TR");

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("dashboard.view");
  const period = parsePeriod(firstParam((await searchParams).period));
  const d = await getDashboard(ctx.service, { periodDays: period, venueId: ctx.activeVenue?.id ?? null });
  const verified = await getVerifiedSummary(ctx.service, { periodDays: period, venueId: ctx.activeVenue?.id ?? null });
  const venueLabel = ctx.activeVenue?.name ?? (ctx.venues.length > 1 ? "Tüm mekanlar" : (ctx.venues[0]?.name ?? ""));
  const canCreateEvent = can(ctx.membership.role, "events.manage");
  const sourceMax = Math.max(1, ...d.sources.map((s) => s.count));

  return (
    <>
      <PageHeader
        eyebrow={`${ctx.tenant.name} · ${venueLabel}`}
        title="Genel Bakış"
        description="Tüm sayılar kayıtlardan anlık hesaplanır. Müşteri sayıları işletme geneli; etkinlik verileri seçili mekana göre."
        actions={
          <nav aria-label="Dönem" className="inline-flex rounded-field border border-line p-0.5">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/dashboard?period=${p}`}
                aria-current={p === period ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 font-mono text-[12px] transition-colors ${
                  p === period ? "bg-raised text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {p} gün
              </Link>
            ))}
          </nav>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Toplam müşteri" value={nf.format(d.totalCustomers)} sub="İşletme geneli, arşiv hariç" href="/customers" />
        <Stat
          label={`Yeni müşteri · ${period} gün`}
          value={nf.format(d.newCustomers)}
          sub={`Önceki ${period} gün: ${nf.format(d.prevNewCustomers)}`}
        />
        <Stat label="Yaklaşan etkinlik" value={nf.format(d.upcomingCount)} sub={venueLabel} href="/events" />
        <Stat
          label={`Etkinlik kaydı · ${period} gün`}
          value={nf.format(d.periodRegistrations.count)}
          sub={`${nf.format(d.periodRegistrations.people)} kişi (grup kayıtları dahil)`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Yaklaşan etkinlikler"
            description="Kayıtlı kişi / kapasite"
            action={
              <Link href="/events" className="text-[13px] text-muted hover:text-fg">
                Tümü
              </Link>
            }
          />
          {d.upcoming.length === 0 ? (
            <EmptyState
              compact
              title="Yaklaşan etkinlik yok"
              description="Oluşturduğunuz etkinlikler ve guest sayıları burada görünür."
              action={
                canCreateEvent ? (
                  <ButtonLink href="/events/new" size="sm">
                    <IconPlus size={14} /> Etkinlik oluştur
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <ul>
              {d.upcoming.map((e) => (
                <li key={e.id} className="border-line [&+li]:border-t">
                  <Link href={`/events/${e.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-raised/50">
                    <DateBlock date={e.startsAt} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{e.name}</p>
                      <p className="truncate text-[13px] text-muted">
                        {e.venue.name} · {formatRange(e.startsAt, e.endsAt)}
                      </p>
                      {e.status === "DRAFT" && (
                        <div className="mt-1.5">
                          <EventStatusBadge status={e.status} />
                        </div>
                      )}
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="font-mono text-[13px] text-fg" data-numeric>
                        {e.people}
                        {e.capacity ? ` / ${e.capacity}` : ""}
                      </p>
                      <p className="text-xs text-muted">{e.registrations} kayıt</p>
                    </div>
                    <RingMeter value={e.people} max={e.capacity} size={40} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Son aktiviteler"
            action={
              <Link href="/activity" className="text-[13px] text-muted hover:text-fg">
                Tümü
              </Link>
            }
          />
          <ActivityFeed items={d.activity} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Kayıt kaynakları" description="Müşterinin CRM'e ilk girdiği kanal" />
          {d.sources.length === 0 ? (
            <EmptyState compact title="Veri yok" description="Müşteri eklendikçe kaynak dağılımı oluşur." />
          ) : (
            <ul className="space-y-3.5 p-5">
              {d.sources.map((s) => (
                <li key={s.source}>
                  <Link href={`/customers?source=${s.source}`} className="group block">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-fg group-hover:underline group-hover:underline-offset-4">
                        {labelOf(CUSTOMER_SOURCE_LABELS, s.source)}
                      </span>
                      <span className="font-mono text-[12px] text-muted" data-numeric>
                        {nf.format(s.count)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-raised">
                      <div className="h-1 rounded-full bg-accent" style={{ width: `${(s.count / sourceMax) * 100}%` }} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="İletişim izinleri" description="Kanal bazında açık izin verilmiş müşteri sayısı" />
          <ul className="space-y-3.5 p-5">
            {CHANNELS.map((ch) => {
              const n = d.consents[ch];
              const pct = d.totalCustomers ? Math.round((n / d.totalCustomers) * 100) : 0;
              return (
                <li key={ch}>
                  <Link href={`/customers?consent=${ch}`} className="group block">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-fg group-hover:underline group-hover:underline-offset-4">{CHANNEL_LABELS[ch]}</span>
                      <span className="font-mono text-[12px] text-muted" data-numeric>
                        {nf.format(n)} · %{pct}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-raised">
                      <div className="h-1 rounded-full bg-fg/80" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
            Guest listesine eklemek veya CRM kaydı açmak iletişim izni oluşturmaz.
          </p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Doğrulanmış kullanım"
            description={`Son ${period} gün · kapıda ve masada personel doğrulaması`}
            action={
              can(ctx.membership.role, "door.checkin") && (
                <Link href="/door" className="text-[13px] text-muted hover:text-fg">
                  Kapı ekranı
                </Link>
              )
            }
          />
          <dl className="grid gap-px overflow-hidden rounded-b-card bg-line sm:grid-cols-3">
            {[
              ["Etkinlik girişi", verified.checkIns, "Onaylanan guest kaydı"],
              ["Giriş yapan kişi", verified.admitted, "Grup kayıtları dahil"],
              ["Avantaj kullanımı", verified.redemptions, "Onaylanan kullanım"],
            ].map(([label, value, sub]) => (
              <div key={label as string} className="bg-surface p-5">
                <dt className="eyebrow">{label}</dt>
                <dd className="mt-3 font-display text-[28px] leading-none font-medium" data-numeric>
                  {nf.format(value as number)}
                </dd>
                <dd className="mt-2 text-[13px] text-muted">{sub}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Henüz ölçülmeyenler" description="İlgili modüller devreye girdiğinde gerçek verilerle görünecek." />
          <ul className="grid gap-px overflow-hidden rounded-b-card bg-line sm:grid-cols-2">
            {[
              ["Kampanya dönüşümü", "Gönderim sağlayıcıları"],
              ["Gelir", "Harici satış verisi gerekir"],
            ].map(([title, how]) => (
              <li key={title} className="bg-surface p-5">
                <p className="text-sm text-fg">{title}</p>
                <p className="mt-1 text-[13px] text-muted">{how}</p>
                <p className="eyebrow mt-3">Hazırlanıyor</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
