import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { formatDateTime, formatRange } from "@/lib/datetime";
import { ROLE_LABELS } from "@/lib/domain";
import { homePathForRole } from "@/lib/routes";
import { listPromoterEvents, type PromoterEvent } from "@/modules/guests/service";
import { listMyPrTasks } from "@/modules/pr/service";
import { CheckInRing } from "@/components/guests/checkin-ring";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { PrTaskList, type PortalTask } from "./pr-task-list";

export const metadata: Metadata = { title: "PR portalı" };

function EventRow({ event }: { event: PromoterEvent }) {
  const { stats } = event;
  return (
    <li className="border-line [&+li]:border-t">
      <Link href={`/events/${event.id}/guests`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-raised/50">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{event.name}</p>
          <p className="truncate text-[13px] text-muted">
            {event.venueName} · {formatRange(event.startsAt, event.endsAt)}
          </p>
          <p className="mt-1.5 text-[13px] text-muted" data-numeric>
            <span className="text-fg">{stats.registrations}</span> davetli ({stats.people} kişi) ·{" "}
            <span className="text-fg">{stats.admitted}</span> kişi içeride · {stats.pending} {event.entryOpen ? "bekleyen" : "gelmeyen"}
          </p>
        </div>
        <CheckInRing id={event.id} ratio={stats.checkInRate} size={64} label={`${stats.people} davetli kişinin ${stats.admitted} kişisi giriş yaptı`} />
      </Link>
    </li>
  );
}

/** PR portalı: yönetimin talimatları, yayındaki etkinlikler ve yalnızca kullanıcının kendi misafirlerinin sayıları. */
export default async function WorkspacePage() {
  const ctx = await requireAppContext();
  const role = ctx.membership.role;
  // Kapı ve garson rollerinin kendi doğrulama ekranları var.
  if (role !== "PR") redirect(homePathForRole(role));

  const [events, myTasks] = await Promise.all([listPromoterEvents(ctx.service), listMyPrTasks(ctx.service)]);
  const upcoming = events.filter((e) => e.open);
  const past = events.filter((e) => !e.open);
  const totals = upcoming.reduce((sum, e) => ({ people: sum.people + e.stats.people, admitted: sum.admitted + e.stats.admitted }), { people: 0, admitted: 0 });
  const now = new Date();
  const tasks: PortalTask[] = myTasks.map((t) => ({
    taskId: t.taskId,
    kind: t.kind,
    title: t.title,
    body: t.body,
    state: t.state,
    eventId: t.event?.id ?? null,
    eventLabel: t.event ? `${t.event.name} · ${formatDateTime(t.event.startsAt)}` : null,
    dueLabel: t.dueAt ? formatDateTime(t.dueAt) : null,
    overdue: t.dueAt !== null && t.dueAt < now,
    guestTarget: t.guestTarget,
    progress: t.progress,
  }));
  const unread = tasks.filter((t) => t.state === "UNREAD").length;

  return (
    <>
      <PageHeader
        eyebrow={`${ctx.tenant.name} · ${ROLE_LABELS[role]}`}
        title={`Merhaba, ${ctx.user.name.split(" ")[0]}`}
        description="Yönetimin talimatlarını görün; etkinliğe dokunarak misafir ekleyin ya da kişisel davet linkinizi ve QR'ınızı paylaşın, kapıdaki gerçek girişleri takip edin."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Talimatlar" description={tasks.length ? `${tasks.length} açık talimat${unread ? ` · ${unread} yeni` : ""}` : "Yönetimden gelen talimatlar"} />
            {tasks.length === 0 ? (
              <EmptyState compact title="Açık talimat yok" description="Yönetim size talimat verdiğinde burada görünür." />
            ) : (
              <PrTaskList tasks={tasks} />
            )}
          </Card>
          <Card>
            <CardHeader title="Yaklaşan etkinlikler" description={`${upcoming.length} etkinlik · ${totals.people} davetli kişi · ${totals.admitted} kişi içeride`} />
            {upcoming.length === 0 ? (
              <EmptyState compact title="Yayında etkinlik yok" description="İşletme bir etkinliği yayına aldığında burada görünür." />
            ) : (
              <ul>
                {upcoming.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ul>
            )}
          </Card>
          {past.length > 0 && (
            <Card>
              <CardHeader title="Son 7 gün" description="Geçmiş etkinliklerdeki misafirleriniz ve gerçek girişler" />
              <ul>
                {past.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Bu hesap neleri görür?" />
          <ul className="space-y-3 p-5 text-[13px] leading-relaxed text-muted">
            <li>Yönetimin size verdiği talimatlar burada görünür; SMS veya WhatsApp ile ayrıca bildirim gelmez.</li>
            <li>Yalnızca sizin eklediğiniz misafirleri ve onların sayılarını görürsünüz.</li>
            <li>Misafir adı ve telefonu maskeli görünür; numara işletmede zaten kayıtlıysa kişinin adı gösterilmez.</li>
            <li>“İçeride” sayısı ve misafir hedefi ilerlemesi gerçek kayıtlardan gelir.</li>
            <li>Müşteri listesi, müşteri profilleri ve etkinlik yönetimi bu hesapta kapalıdır; kısıt sunucu tarafında uygulanır.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
