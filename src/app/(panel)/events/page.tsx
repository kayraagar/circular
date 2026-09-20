import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { can } from "@/lib/authz";
import { firstParam, type SearchParams } from "@/lib/page";
import { formatRange } from "@/lib/datetime";
import { listEvents, type EventScope } from "@/modules/events/service";
import { DateBlock } from "@/components/date-block";
import { EventStatusBadge } from "@/components/event-status-badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, RingMeter } from "@/components/ui/primitives";
import { IconPlus } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Etkinlikler ve Guest" };

const SCOPES: { value: EventScope; label: string }[] = [
  { value: "upcoming", label: "Yaklaşan" },
  { value: "past", label: "Geçmiş" },
  { value: "all", label: "Tümü" },
];

export default async function EventsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("events.view");
  const raw = firstParam((await searchParams).scope);
  const scope: EventScope = raw === "past" || raw === "all" ? raw : "upcoming";
  const events = await listEvents(ctx.service, { scope, venueId: ctx.activeVenue?.id ?? null });
  const canManage = can(ctx.membership.role, "events.manage");
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow={`${ctx.tenant.name} · ${ctx.activeVenue?.name ?? "Tüm mekanlar"}`}
        title="Etkinlikler ve Guest"
        description="Etkinlik oluşturun, guest listesini yönetin. Kayıt, giriş hakkı ve gerçek giriş ayrı takip edilir."
        actions={
          canManage && (
            <ButtonLink href="/events/new" variant="primary">
              <IconPlus size={15} /> Etkinlik oluştur
            </ButtonLink>
          )
        }
      />

      <nav aria-label="Etkinlik zamanı" className="mb-4 flex gap-1 border-b border-line">
        {SCOPES.map((s) => (
          <Link
            key={s.value}
            href={s.value === "upcoming" ? "/events" : `/events?scope=${s.value}`}
            aria-current={scope === s.value ? "page" : undefined}
            className={`-mb-px border-b px-3 pb-3 text-sm transition-colors ${
              scope === s.value ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <Card>
        {events.length === 0 ? (
          <EmptyState
            title={scope === "past" ? "Geçmiş etkinlik yok" : scope === "upcoming" ? "Yaklaşan etkinlik yok" : "Henüz etkinlik yok"}
            description={
              ctx.activeVenue
                ? `${ctx.activeVenue.name} için gösterilecek etkinlik yok. Üst bardan mekan filtresini değiştirebilirsiniz.`
                : "Etkinlik oluşturduğunuzda guest listesi ve kayıt sayıları burada görünür."
            }
            action={
              canManage && scope !== "past" ? (
                <ButtonLink href="/events/new" variant="primary">
                  <IconPlus size={15} /> Etkinlik oluştur
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <ul>
            {events.map((e) => {
              const ended = e.endsAt < now;
              return (
                <li key={e.id} className="border-line [&+li]:border-t">
                  <Link href={`/events/${e.id}`} className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-raised/50 sm:px-5">
                    <DateBlock date={e.startsAt} muted={e.status === "CANCELLED"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`truncate font-medium ${e.status === "CANCELLED" ? "text-muted line-through" : "text-fg"}`}>{e.name}</p>
                        {(e.status !== "PUBLISHED" || ended) && <EventStatusBadge status={e.status} ended={ended} />}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-muted">
                        {e.venue.name} · {formatRange(e.startsAt, e.endsAt)}
                      </p>
                      <p className="mt-1 font-mono text-[12px] text-muted sm:hidden" data-numeric>
                        {e.registrations} kayıt · {e.people}
                        {e.capacity ? `/${e.capacity}` : ""} kişi
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="font-mono text-[13px] text-fg" data-numeric>
                        {e.people}
                        {e.capacity ? ` / ${e.capacity}` : ""} kişi
                      </p>
                      <p className="text-xs text-muted">{e.registrations} guest kaydı</p>
                    </div>
                    <RingMeter value={e.people} max={e.capacity} size={42} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
