import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { formatDateTime, formatRange } from "@/lib/datetime";
import { listDoorEvents } from "@/modules/passes/service";
import { DateBlock } from "@/components/date-block";
import { Badge, Card, CardHeader, EmptyState, PageHeader, RingMeter } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Giriş doğrulama" };

type DoorEvent = Awaited<ReturnType<typeof listDoorEvents>>[number];

function EventRow({ e }: { e: DoorEvent }) {
  return (
    <li className="border-line [&+li]:border-t">
      <Link href={`/door/${e.id}`} className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-raised/50 sm:px-5">
        <DateBlock date={e.startsAt} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{e.name}</p>
          <p className="truncate text-[13px] text-muted">
            {e.venueName} · {formatRange(e.startsAt, e.endsAt)}
          </p>
          <p className="mt-1 font-mono text-[12px] text-muted" data-numeric>
            {e.checkIns} / {e.registrations} kayıt · {e.admitted} kişi giriş yaptı
          </p>
        </div>
        <RingMeter value={e.checkIns} max={e.registrations || null} size={44} />
      </Link>
    </li>
  );
}

export default async function DoorPage() {
  const ctx = await requirePermission("door.checkin");
  const events = await listDoorEvents(ctx.service);
  const open = events.filter((e) => e.windowState === "OPEN");
  const upcoming = events.filter((e) => e.windowState === "NOT_YET");
  const justClosed = events.filter((e) => e.windowState === "CLOSED");

  return (
    <>
      <PageHeader
        eyebrow={ctx.activeVenue?.name ?? ctx.tenant.name}
        title="Giriş doğrulama"
        description="Guest'in QR kodunu telefonunuzun kamerasıyla okutun; açılan sayfada girişi onaylayın. QR'ı olmayan guest için etkinliği açıp listeden manuel giriş kaydedebilirsiniz."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Girişi açık" description="Giriş penceresi şu an açık olan etkinlikler" />
            {open.length === 0 ? (
              <EmptyState compact title="Şu an girişi açık etkinlik yok" description="Giriş, etkinlik başlangıcından 6 saat önce açılır ve giriş kapanışında kapanır." />
            ) : (
              <ul>
                {open.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            )}
          </Card>
          {upcoming.length > 0 && (
            <Card>
              <CardHeader title="Önümüzdeki 24 saat" />
              <ul>
                {upcoming.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 border-line px-5 py-3.5 [&+li]:border-t">
                    <div className="min-w-0">
                      <Link href={`/door/${e.id}`} className="truncate text-sm font-medium text-fg hover:underline hover:underline-offset-4">
                        {e.name}
                      </Link>
                      <p className="text-[13px] text-muted">{e.venueName}</p>
                    </div>
                    <Badge tone="muted">Giriş {formatDateTime(e.window.opensAt)}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {justClosed.length > 0 && (
            <Card>
              <CardHeader title="Girişi yeni kapandı" description="Geç gelen guest varsa etkinliği açıp giriş penceresini uzatabilirsiniz." />
              <ul>
                {justClosed.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 border-line px-5 py-3.5 [&+li]:border-t">
                    <div className="min-w-0">
                      <Link href={`/door/${e.id}`} className="truncate text-sm font-medium text-fg hover:underline hover:underline-offset-4">
                        {e.name}
                      </Link>
                      <p className="text-[13px] text-muted">
                        {e.venueName} · {e.checkIns} / {e.registrations} kayıt giriş yaptı
                      </p>
                    </div>
                    <Badge tone="muted">Kapandı {formatDateTime(e.window.closesAt)}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader title="Nasıl okutulur?" />
          <ol className="space-y-4 p-5 text-sm">
            {[
              ["Kamerayı açın", "Telefonun kamera uygulamasını QR koda doğrultun."],
              ["Bağlantıya dokunun", "Doğrulama sayfası açılır; bu hesapla giriş yapmış olmalısınız."],
              ["Kontrol edip onaylayın", "Adı ve kişi sayısını kontrol edin, girişi onaylayın."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[12px] text-accent">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-fg">{title}</span>
                  <span className="block text-[13px] text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
            Aynı QR ikinci kez onaylanamaz; iki cihaz aynı anda okutsa bile yalnızca bir giriş kaydedilir.
          </p>
        </Card>
      </div>
    </>
  );
}
