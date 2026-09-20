import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@/lib/authz";
import { requirePermission } from "@/lib/context";
import { formatDateTime, formatRange, formatTime } from "@/lib/datetime";
import { firstParam, orNotFound, type SearchParams } from "@/lib/page";
import { GUEST_SOURCE_LABELS, GUEST_STATUS_LABELS, type GuestStatus } from "@/modules/guests/status";
import { GUEST_LIST_LIMIT, getEventGuestList, getPromoterStats, listPromoterOptions, type GuestRow } from "@/modules/guests/service";
import { getMyInviteLink } from "@/modules/guests/invite";
import { InviteLinkCard } from "./invite-link-card";
import { CheckInRing } from "@/components/guests/checkin-ring";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { IconSearch } from "@/components/ui/icons";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AddGuestForm } from "./add-guest-form";
import { GuestPassButton } from "./guest-pass-button";

export const metadata: Metadata = { title: "Misafir listesi" };

const STATUS_TONE: Record<GuestStatus, "muted" | "positive" | "negative"> = {
  PENDING: "muted",
  CHECKED_IN: "positive",
  CANCELLED: "negative",
};

/** Giriş penceresi kapandıktan sonra hâlâ bekleyen misafir "Gelmedi" olarak gösterilir (etkinlik sayfasıyla aynı kural). */
function StatusBadge({ status, entryOpen }: { status: GuestStatus; entryOpen: boolean }) {
  if (status === "PENDING" && !entryOpen) return <Badge tone="caution">Gelmedi</Badge>;
  return <Badge tone={STATUS_TONE[status]}>{GUEST_STATUS_LABELS[status]}</Badge>;
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="card p-5">
      <p className="font-display text-[13px] font-medium tracking-tight text-muted">{label}</p>
      <p className="mt-3 font-display text-[34px] leading-none font-medium" data-numeric>
        {value}
      </p>
      <p className="mt-2 text-[13px] text-muted">{detail}</p>
    </div>
  );
}

function GuestActions({ guest, entryOpen }: { guest: GuestRow; entryOpen: boolean }) {
  if (guest.status !== "PENDING" || !entryOpen) return null;
  return <GuestPassButton registrationId={guest.id} guestName={guest.name} />;
}

/** PR ve yönetim için misafir listesi. PR yalnızca kendi getirdiği misafirleri görür. */
export default async function EventGuestsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requirePermission("promoter.guests");
  const { id } = await params;
  const q = firstParam((await searchParams).q).slice(0, 100);
  const promoterMode = ctx.membership.role === "PR";

  const [list, stats, promoters, inviteLink] = await Promise.all([
    orNotFound(getEventGuestList(ctx.service, id, { q })),
    orNotFound(getPromoterStats(ctx.service, id)),
    listPromoterOptions(ctx.service),
    promoterMode ? orNotFound(getMyInviteLink(ctx.service, id)) : Promise.resolve(null),
  ]);
  const { event, guests } = list;
  const ratioLabel = `Davetli ${stats.people} kişinin ${stats.admitted} kişisi giriş yaptı`;

  return (
    <>
      <PageHeader
        back={promoterMode ? { href: "/workspace", label: "PR portalı" } : { href: `/events/${event.id}`, label: event.name }}
        eyebrow={event.venueName}
        title="Misafir listesi"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-fg">{event.name}</span>
            <span>{formatRange(event.startsAt, event.endsAt)}</span>
            {event.status === "CANCELLED" && <Badge tone="negative">Etkinlik iptal</Badge>}
            {promoterMode && <Badge tone="muted">Yalnızca sizin getirdiğiniz misafirler</Badge>}
          </span>
        }
        actions={
          !promoterMode &&
          can(ctx.membership.role, "door.checkin") &&
          event.entryOpen && (
            <ButtonLink href={`/door/${event.id}`} variant="secondary">
              Kapı ekranı
            </ButtonLink>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={promoterMode ? "Davetlilerim" : "Toplam davetli"} value={stats.registrations} detail={`${stats.people} kişi`} />
        <Metric label="İçeride" value={stats.checkedIn} detail={`${stats.admitted} kişi giriş yaptı`} />
        <Metric
          label={event.entryOpen ? "Bekleyen" : "Gelmeyen"}
          value={stats.pending}
          detail={`${stats.pendingPeople} kişi · ${stats.cancelled} iptal`}
        />
        <div className="card flex items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="font-display text-[13px] font-medium tracking-tight text-muted">Giriş oranı</p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              {stats.people > 0 ? `${stats.admitted} / ${stats.people} kişi` : "Henüz davetli yok"}
            </p>
            {stats.capacity !== null && <p className="mt-1 text-[12px] text-muted">Kapasite {stats.capacity} kişi</p>}
          </div>
          <CheckInRing id={event.id} ratio={stats.checkInRate} size={96} label={ratioLabel} caption="içeride" />
        </div>
      </div>

      {stats.byPromoter && stats.byPromoter.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="PR performansı" description="Davetli ve gerçek giriş sayıları; giriş kapıda QR veya manuel olarak kaydedilir." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-medium">PR</th>
                  <th className="px-3 py-2.5 text-right font-medium">Davetli</th>
                  <th className="px-3 py-2.5 text-right font-medium">Kişi</th>
                  <th className="px-3 py-2.5 text-right font-medium">İçeride</th>
                  <th className="px-5 py-2.5 text-right font-medium">Giriş oranı</th>
                </tr>
              </thead>
              <tbody>
                {stats.byPromoter.map((p) => (
                  <tr key={p.membershipId ?? "none"} className="border-line [&+tr]:border-t">
                    <td className={`px-5 py-3 ${p.membershipId ? "text-fg" : "text-muted"}`}>{p.name}</td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {p.registrations}
                    </td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {p.people}
                    </td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {p.admitted}
                    </td>
                    <td className="px-5 py-3 text-right text-muted" data-numeric>
                      {p.people > 0 ? `%${Math.round((p.admitted / p.people) * 100)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Misafirler" description={`${guests.length} kayıt${list.filtered ? " · arama sonucu" : ""}`} />
          <form method="get" role="search" className="flex gap-2 border-b border-line p-3">
            <label htmlFor="guest-q" className="sr-only">
              Misafir ara
            </label>
            <div className="relative flex-1">
              <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input
                id="guest-q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder={promoterMode ? "Ad veya telefon" : "Ad veya telefonla ara"}
                className="input !pl-9"
                autoComplete="off"
              />
            </div>
            <button type="submit" className={buttonClass("secondary", "md")}>
              Ara
            </button>
            {list.filtered && (
              <Link href={`/events/${event.id}/guests`} className={buttonClass("ghost", "md")}>
                Temizle
              </Link>
            )}
          </form>

          {guests.length === 0 ? (
            <EmptyState
              compact
              title={list.filtered ? "Aramaya uyan misafir yok" : "Henüz misafir yok"}
              description={list.filtered ? "Farklı bir ad veya numara deneyin." : event.canAddGuests ? "Yandaki formdan ilk misafiri ekleyin." : undefined}
            />
          ) : (
            <>
              {/* Masaüstü: tablo */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[12px] text-muted">
                      <th className="px-5 py-2.5 font-medium">Misafir</th>
                      <th className="px-3 py-2.5 text-right font-medium">Kişi</th>
                      <th className="px-3 py-2.5 font-medium">Durum</th>
                      <th className="px-3 py-2.5 font-medium">Kaynak</th>
                      {!promoterMode && <th className="px-3 py-2.5 font-medium">PR</th>}
                      <th className="px-5 py-2.5 text-right font-medium">
                        <span className="sr-only">İşlem</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g) => (
                      <tr key={g.id} className="border-line align-top [&+tr]:border-t">
                        <td className="px-5 py-3">
                          <p className={g.status === "CANCELLED" ? "text-muted" : "text-fg"}>{g.name}</p>
                          <p className="font-mono text-[12px] text-muted">{g.phone ?? "—"}</p>
                          {g.note && <p className="mt-0.5 text-[12px] text-muted">{g.note}</p>}
                        </td>
                        <td className="px-3 py-3 text-right" data-numeric>
                          {g.partySize}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={g.status} entryOpen={event.entryOpen} />
                          {g.checkedInAt && (
                            <p className="mt-1 text-[12px] text-muted">
                              {formatTime(g.checkedInAt)} · {g.admittedCount} kişi
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted">{GUEST_SOURCE_LABELS[g.source]}</td>
                        {!promoterMode && <td className="px-3 py-3 text-muted">{g.promoterName ?? "—"}</td>}
                        <td className="px-5 py-3 text-right">
                          <GuestActions guest={g} entryOpen={event.entryOpen} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobil: liste */}
              <ul className="md:hidden">
                {guests.map((g) => (
                  <li key={g.id} className="flex items-start gap-3 border-line px-4 py-3.5 [&+li]:border-t">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${g.status === "CANCELLED" ? "text-muted" : "text-fg"}`}>{g.name}</p>
                      <p className="font-mono text-[12px] text-muted">{g.phone ?? "—"}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                        <StatusBadge status={g.status} entryOpen={event.entryOpen} />
                        <span>
                          {g.partySize} kişi · {GUEST_SOURCE_LABELS[g.source]}
                          {g.promoterName ? ` · ${g.promoterName}` : ""}
                          {g.checkedInAt ? ` · giriş ${formatTime(g.checkedInAt)}` : ""}
                        </span>
                      </p>
                    </div>
                    <GuestActions guest={g} entryOpen={event.entryOpen} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {list.truncated && (
            <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
              Liste ilk {GUEST_LIST_LIMIT} kayıtla sınırlı; aradığınız misafiri adıyla veya telefonuyla aratın.
            </p>
          )}
        </Card>

        <div className="space-y-6">
        {promoterMode && <InviteLinkCard eventId={event.id} eventName={event.name} initial={inviteLink} canCreate={event.canAddGuests} />}
        <Card className="h-fit">
          <CardHeader
            title="Misafir ekle"
            description={promoterMode ? "Eklediğiniz misafirler sizin adınıza sayılır." : "Kaynağı seçin; PR getirdiyse PR'ı atayın."}
          />
          {event.canAddGuests ? (
            <AddGuestForm eventId={event.id} promoterMode={promoterMode} promoters={promoters} />
          ) : (
            <p className="px-5 pb-5 text-[13px] leading-relaxed text-muted">
              {event.status === "CANCELLED"
                ? "Etkinlik iptal edildiği için misafir eklenemez."
                : `Etkinlik ${formatDateTime(event.endsAt)} tarihinde sona erdi; liste geçmiş kayıt olarak korunur.`}
            </p>
          )}
        </Card>
        </div>
      </div>
    </>
  );
}
