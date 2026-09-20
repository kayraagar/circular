import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { can } from "@/lib/authz";
import { firstParam, orNotFound, type SearchParams } from "@/lib/page";
import { formatDateTime, formatRange, formatShortDate } from "@/lib/datetime";
import { formatPhone } from "@/lib/normalize";
import { ACCESS_STATUS_LABELS, COMPLETION_LABELS, REGISTRATION_CHANNEL_LABELS, labelOf } from "@/lib/domain";
import { changeEventStatusAction, cancelRegistrationAction } from "@/modules/events/actions";
import { getEventDetail } from "@/modules/events/service";
import { ATTENDANCE_LABELS, attendanceState } from "@/modules/events/attendance";
import { getEventCheckInStats } from "@/modules/passes/service";
import { entryWindow } from "@/modules/passes/rules";
import { EntryPassButton } from "./entry-pass-button";
import { EventStatusBadge } from "@/components/event-status-badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader, EmptyState, FormAlert, PageHeader, RingMeter } from "@/components/ui/primitives";
import { IconSearch } from "@/components/ui/icons";
import { GuestPanel } from "./guest-panel";

export const metadata: Metadata = { title: "Etkinlik" };

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const ctx = await requirePermission("events.view");
  const { id } = await params;
  const q = firstParam((await searchParams).q).slice(0, 100);
  const { event, stats, registrations, filtered } = await orNotFound(getEventDetail(ctx.service, id, { q }));
  const checkInStats = await getEventCheckInStats(ctx.service, event.id);
  const role = ctx.membership.role;
  const canManage = can(role, "events.manage");
  const canGuests = can(role, "guests.manage") && can(role, "customers.view");
  const canIssuePass = can(role, "passes.issue");
  const canDoor = can(role, "door.checkin");
  const now = new Date();
  const ended = event.endsAt < now;
  const cancelled = event.status === "CANCELLED";
  const entryOpen = !cancelled && entryWindow(event).closesAt > now;
  const guestsOpen = !cancelled && !ended;
  const remaining = event.capacity === null ? null : Math.max(0, event.capacity - stats.people);

  return (
    <>
      <PageHeader
        back={{ href: "/events", label: "Etkinlikler" }}
        eyebrow={event.venue.name}
        title={event.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EventStatusBadge status={event.status} ended={ended} />
            <span>{formatRange(event.startsAt, event.endsAt)}</span>
          </span>
        }
        actions={
          <>
            {can(role, "promoter.guests") && (
              <ButtonLink href={`/events/${event.id}/guests`} variant="secondary">
                Misafir listesi ve PR
              </ButtonLink>
            )}
            {canDoor && entryOpen && (
              <ButtonLink href={`/door/${event.id}`} variant="secondary">
                Kapı ekranı
              </ButtonLink>
            )}
            {canManage &&
          !cancelled && (
            <>
              <ConfirmDialog
                trigger="İptal et"
                triggerVariant="ghost"
                triggerSize="md"
                title="Etkinliği iptal et"
                description="İptal edilen etkinliğe guest eklenemez ve etkinlik düzenlenemez. Guest kayıtları geçmiş için korunur. Bu işlem geri alınamaz."
                confirmLabel="Etkinliği iptal et"
                action={changeEventStatusAction}
                fields={{ eventId: event.id, op: "cancel" }}
              />
              {event.status === "DRAFT" ? (
                <ConfirmDialog
                  trigger="Yayına al"
                  triggerSize="md"
                  title="Etkinliği yayına al"
                  description="Etkinlik aktif olarak işaretlenir. Herkese açık etkinlik sayfası henüz yok; bu işlem kimseye bildirim göndermez."
                  confirmLabel="Yayına al"
                  confirmVariant="primary"
                  action={changeEventStatusAction}
                  fields={{ eventId: event.id, op: "publish" }}
                />
              ) : (
                <ConfirmDialog
                  trigger="Taslağa al"
                  triggerSize="md"
                  title="Etkinliği taslağa al"
                  description="Etkinlik yayından kaldırılıp taslak olarak işaretlenir. Guest listesi korunur."
                  confirmLabel="Taslağa al"
                  confirmVariant="primary"
                  action={changeEventStatusAction}
                  fields={{ eventId: event.id, op: "unpublish" }}
                />
              )}
              <ButtonLink href={`/events/${event.id}/edit`} variant="primary">
                Düzenle
              </ButtonLink>
            </>
          )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card flex items-center justify-between gap-4 p-5">
          <div>
            <p className="eyebrow">Toplam kişi</p>
            <p className="mt-3 font-display text-[32px] leading-none font-medium" data-numeric>
              {stats.people}
              {event.capacity ? <span className="text-lg text-muted"> / {event.capacity}</span> : null}
            </p>
            <p className="mt-2 text-[13px] text-muted">{event.capacity ? `${remaining} kişilik yer kaldı` : "Kapasite sınırı yok"}</p>
          </div>
          <RingMeter value={stats.people} max={event.capacity} size={56} />
        </div>
        <div className="card p-5">
          <p className="eyebrow">Guest kaydı</p>
          <p className="mt-3 font-display text-[32px] leading-none font-medium" data-numeric>
            {stats.registrations}
          </p>
          <p className="mt-2 text-[13px] text-muted">Aktif giriş hakkı olan kayıt</p>
        </div>
        <div className="card p-5">
          <p className="eyebrow">İptal edilen</p>
          <p className="mt-3 font-display text-[32px] leading-none font-medium" data-numeric>
            {stats.cancelled}
          </p>
          <p className="mt-2 text-[13px] text-muted">Giriş hakkı kaldırılan kayıt</p>
        </div>
        <div className="card p-5">
          <p className="eyebrow">Gerçek giriş</p>
          <p className="mt-3 font-display text-[32px] leading-none font-medium" data-numeric>
            {checkInStats.checkIns}
            <span className="text-lg text-muted"> / {stats.registrations}</span>
          </p>
          <p className="mt-2 text-[13px] text-muted">
            {checkInStats.admitted} kişi · {checkInStats.viaQr} QR, {checkInStats.manual} manuel
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canGuests && guestsOpen && <GuestPanel eventId={event.id} remaining={remaining} />}
          {canGuests && !guestsOpen && (
            <FormAlert tone="info">
              {cancelled
                ? "Etkinlik iptal edildiği için guest eklenemez."
                : "Etkinlik sona erdiği için guest eklenemez. Liste geçmiş kayıt olarak korunur."}
            </FormAlert>
          )}

          <Card>
            <CardHeader
              title="Guest listesi"
              description={`${stats.registrations} aktif kayıt · ${stats.people} kişi`}
            />
            <form method="get" role="search" className="flex gap-2 border-b border-line p-3">
              <label htmlFor="gq" className="sr-only">
                Guest listesinde ara
              </label>
              <div className="relative flex-1">
                <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <input id="gq" name="q" type="search" defaultValue={q} placeholder="Listede ara" className="input !min-h-9 !pl-9" />
              </div>
              <button type="submit" className={buttonClass("secondary", "sm", "!h-9")}>
                Ara
              </button>
              {filtered && (
                <Link href={`/events/${event.id}`} className={buttonClass("ghost", "sm", "!h-9")}>
                  Temizle
                </Link>
              )}
            </form>

            {registrations.length === 0 ? (
              filtered ? (
                <EmptyState compact title="Aramaya uyan guest yok" description="Farklı bir isim, telefon veya e-posta deneyin." />
              ) : (
                <EmptyState
                  compact
                  title="Guest listesi boş"
                  description={guestsOpen ? "Yukarıdaki panelden kayıtlı müşteri veya yeni kişi ekleyin." : "Bu etkinliğe guest eklenmedi."}
                />
              )
            ) : (
              <ul>
                {registrations.map((r) => {
                  const att = attendanceState({ accessStatus: r.accessStatus, checkInCount: r.checkInCount }, event, now);
                  const isCancelled = r.accessStatus === "CANCELLED";
                  return (
                    <li key={r.id} className="flex flex-col gap-3 border-line px-5 py-3.5 sm:flex-row sm:items-center [&+li]:border-t">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/customers/${r.customerId}`}
                            className={`text-sm font-medium hover:underline hover:underline-offset-4 ${isCancelled ? "text-muted" : "text-fg"}`}
                          >
                            {r.customerName}
                          </Link>
                          {r.partySize > 1 && <Badge tone="muted" mono>{r.partySize} kişi</Badge>}
                        </div>
                        <p className="truncate font-mono text-[12px] text-muted">
                          {formatPhone(r.customer.phone) || r.customer.email}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {labelOf(REGISTRATION_CHANNEL_LABELS, r.channel)}
                          {r.addedByName ? ` · ${r.addedByName}` : ""} ·{" "}
                          <time dateTime={r.createdAt.toISOString()} title={formatDateTime(r.createdAt)}>
                            {formatShortDate(r.createdAt)}
                          </time>
                          {r.note ? ` · ${r.note}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="muted">{labelOf(COMPLETION_LABELS, r.completionStatus)}</Badge>
                        <Badge tone={isCancelled ? "negative" : "neutral"}>{labelOf(ACCESS_STATUS_LABELS, r.accessStatus)}</Badge>
                        {!isCancelled && (
                          <Badge tone={att === "CHECKED_IN" ? "positive" : att === "NO_SHOW" ? "caution" : "muted"}>
                            {ATTENDANCE_LABELS[att]}
                          </Badge>
                        )}
                        {canIssuePass && !isCancelled && entryOpen && r.checkInCount === 0 && (
                          <EntryPassButton registrationId={r.id} guestName={r.customerName} />
                        )}
                        {canGuests && !isCancelled && guestsOpen && (
                          <ConfirmDialog
                            trigger="İptal"
                            triggerVariant="ghost"
                            title="Guest kaydını iptal et"
                            description={`${r.customerName} için giriş hakkı kaldırılır. Müşteri kaydı ve geçmişi korunur; gerekirse yeniden ekleyebilirsiniz.`}
                            confirmLabel="Kaydı iptal et"
                            action={cancelRegistrationAction}
                            fields={{ registrationId: r.id, eventId: event.id }}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Etkinlik bilgileri" />
            <dl className="divide-y divide-line text-sm">
              {[
                ["Mekan", event.venue.name],
                ["Başlangıç", formatDateTime(event.startsAt)],
                ["Bitiş", formatDateTime(event.endsAt)],
                ["Giriş kapanışı", formatDateTime(event.entryClosesAt ?? event.endsAt)],
                [
                  "Kayıt penceresi",
                  event.registrationOpensAt || event.registrationClosesAt
                    ? `${event.registrationOpensAt ? formatDateTime(event.registrationOpensAt) : "—"} → ${
                        event.registrationClosesAt ? formatDateTime(event.registrationClosesAt) : "—"
                      }`
                    : "Tanımlı değil",
                ],
                ["Kapasite", event.capacity ? `${event.capacity} kişi` : "Sınırsız"],
              ].map(([label, value]) => (
                <div key={label} className="px-5 py-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-0.5 text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Açıklama" />
            <p className="px-5 py-4 text-sm leading-relaxed whitespace-pre-line text-fg">
              {event.description || <span className="text-muted">Açıklama eklenmemiş.</span>}
            </p>
          </Card>
          <Card>
            <CardHeader title="Kavramlar" />
            <dl className="space-y-3 px-5 py-4 text-[13px]">
              <div>
                <dt className="text-fg">Kayıt durumu</dt>
                <dd className="text-muted">Kaydı personel mi girdi, kişi kendisi mi tamamladı.</dd>
              </div>
              <div>
                <dt className="text-fg">Giriş hakkı</dt>
                <dd className="text-muted">Kaydın geçerli olup olmadığı. İptal edilen kayıt giriş hakkı taşımaz.</dd>
              </div>
              <div>
                <dt className="text-fg">Katılım</dt>
                <dd className="text-muted">
                  Gerçek giriş, kapıda QR okutularak veya manuel olarak personel tarafından kaydedilir. &quot;Gelmedi&quot; yalnızca giriş
                  kapanışından sonra ve giriş kaydı yoksa gösterilir.
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
