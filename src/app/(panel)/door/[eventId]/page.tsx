import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { can } from "@/lib/authz";
import { firstParam, orNotFound, type SearchParams } from "@/lib/page";
import { formatDateTime, formatRange, formatTime } from "@/lib/datetime";
import { extendEntryAction, manualCheckInAction, undoCheckInAction } from "@/modules/passes/actions";
import { getDoorEvent, type WindowState } from "@/modules/passes/service";
import { buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader, EmptyState, PageHeader, RingMeter } from "@/components/ui/primitives";
import { IconSearch } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Kapı ekranı" };

const WINDOW_LABELS: Record<WindowState, { label: string; tone: "positive" | "caution" | "muted" | "negative" }> = {
  OPEN: { label: "Giriş açık", tone: "positive" },
  NOT_YET: { label: "Giriş henüz açılmadı", tone: "caution" },
  CLOSED: { label: "Giriş kapandı", tone: "muted" },
  CANCELLED: { label: "Etkinlik iptal", tone: "negative" },
};

export default async function DoorEventPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: SearchParams }) {
  const ctx = await requirePermission("door.checkin");
  const { eventId } = await params;
  const q = firstParam((await searchParams).q).slice(0, 100);
  const data = await orNotFound(getDoorEvent(ctx.service, eventId, q));
  const { event, stats, window } = data;
  const open = data.windowState === "OPEN";
  const status = WINDOW_LABELS[data.windowState];
  const role = ctx.membership.role;
  const canUndo = can(role, "checkin.undo");
  const canExtend = can(role, "entry.extend") && data.windowState !== "CANCELLED";

  return (
    <>
      <PageHeader
        back={{ href: "/door", label: "Giriş doğrulama" }}
        eyebrow={event.venueName}
        title={event.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{formatRange(event.startsAt, event.endsAt)}</span>
            <span className="text-muted">Giriş kapanışı: {formatDateTime(window.closesAt)}</span>
          </span>
        }
        actions={
          canExtend && (
            <ConfirmDialog
              trigger={open ? "Girişi uzat" : "Girişi yeniden aç"}
              triggerVariant="secondary"
              triggerSize="md"
              title="Giriş penceresini uzat"
              description={`${event.name} için giriş 1 saat daha açık kalır. Yeni kapanış saati etkinlik kaydına yazılır ve aktivite geçmişinde görünür.`}
              confirmLabel="1 saat uzat"
              confirmVariant="primary"
              action={extendEntryAction}
              fields={{ eventId: event.id, minutes: "60" }}
            />
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card flex items-center justify-between gap-4 p-5">
          <div>
            <p className="eyebrow">Giriş yapan kayıt</p>
            <p className="mt-3 font-display text-[32px] leading-none font-medium" data-numeric>
              {stats.checkIns}
              <span className="text-lg text-muted"> / {stats.registrations}</span>
            </p>
          </div>
          <RingMeter value={stats.checkIns} max={stats.registrations || null} size={56} />
        </div>
        <div className="card p-5">
          <p className="eyebrow">Giriş yapan kişi</p>
          <p className="mt-3 font-display text-[32px] leading-none font-medium" data-numeric>
            {stats.admitted}
            <span className="text-lg text-muted"> / {stats.people}</span>
          </p>
          <p className="mt-2 text-[13px] text-muted">Grup kayıtlarında onaylanan kişi sayısı</p>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Guest listesi" description="QR'ı olmayan guest için kimlik kontrolünden sonra manuel giriş kaydedin." />
        <form method="get" role="search" className="flex gap-2 border-b border-line p-3">
          <label htmlFor="dq" className="sr-only">
            İsimle ara
          </label>
          <div className="relative flex-1">
            <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input id="dq" name="q" type="search" defaultValue={q} placeholder="İsimle ara" className="input !pl-9" autoComplete="off" />
          </div>
          <button type="submit" className={buttonClass("secondary", "md")}>
            Ara
          </button>
          {data.filtered && (
            <Link href={`/door/${event.id}`} className={buttonClass("ghost", "md")}>
              Temizle
            </Link>
          )}
        </form>

        {data.guests.length === 0 ? (
          <EmptyState compact title={data.filtered ? "Aramaya uyan guest yok" : "Guest listesi boş"} />
        ) : (
          <ul>
            {data.guests.map((g) => (
              <li key={g.id} className="flex flex-col gap-3 border-line px-5 py-4 sm:flex-row sm:items-center [&+li]:border-t">
                <div className="min-w-0 flex-1">
                  <p className={`text-base font-medium ${g.checkIn ? "text-muted" : "text-fg"}`}>{g.name}</p>
                  <p className="text-[13px] text-muted">
                    {g.partySize} kişi{g.note ? ` · ${g.note}` : ""}
                  </p>
                </div>
                {g.checkIn ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="positive">
                      Giriş {formatTime(g.checkIn.checkedInAt)} · {g.checkIn.admittedCount} kişi ·{" "}
                      {g.checkIn.method === "MANUAL" ? "Manuel" : "QR"}
                    </Badge>
                    {canUndo && (
                      <ConfirmDialog
                        trigger="Geri al"
                        triggerVariant="ghost"
                        title="Girişi geri al"
                        description={`${g.name} için kaydedilen giriş silinir. QR ile giriş yapıldıysa kod yeniden geçerli olur. İşlem aktivite geçmişine yazılır.`}
                        confirmLabel="Girişi geri al"
                        action={undoCheckInAction}
                        fields={{ registrationId: g.id, eventId: event.id }}
                      />
                    )}
                  </div>
                ) : open ? (
                  <ConfirmDialog
                    trigger="Manuel giriş"
                    triggerVariant="secondary"
                    triggerSize="md"
                    title="Manuel giriş"
                    description={`${g.name} için QR okutmadan giriş kaydedilir. Kimlik kontrolünü yaptığınızdan emin olun. Kişiye verilmiş kullanılmamış bir QR varsa geçersiz olur.`}
                    confirmLabel="Girişi kaydet"
                    confirmVariant="primary"
                    action={manualCheckInAction}
                    fields={{ registrationId: g.id, eventId: event.id }}
                  >
                    {g.partySize > 1 ? (
                      <>
                        <label htmlFor={`admitted-${g.id}`} className="mb-1.5 block text-[13px] font-medium">
                          Giriş yapan kişi sayısı
                        </label>
                        <input
                          id={`admitted-${g.id}`}
                          name="admittedCount"
                          type="number"
                          min={1}
                          max={g.partySize}
                          defaultValue={g.partySize}
                          inputMode="numeric"
                          className="input"
                        />
                      </>
                    ) : (
                      <input type="hidden" name="admittedCount" value="1" />
                    )}
                  </ConfirmDialog>
                ) : (
                  <Badge tone="muted">Bekleniyor</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.truncated && (
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
            Liste ilk {data.limit} kayıtla sınırlı. Aradığınız guest görünmüyorsa isimle aratın.
          </p>
        )}
      </Card>
    </>
  );
}
