import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { formatDateTime } from "@/lib/datetime";
import { firstParam, type SearchParams } from "@/lib/page";
import { closePrTaskAction } from "@/modules/pr/actions";
import { getPrOverview, listPrTasks, type PrTaskView } from "@/modules/pr/service";
import { PR_TASK_KIND_LABELS, RECIPIENT_STATE_LABELS, type RecipientState } from "@/modules/pr/tasks";
import { CheckInRing } from "@/components/guests/checkin-ring";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { NewTaskForm } from "./new-task-form";

export const metadata: Metadata = { title: "PR Yönetimi" };

const STATE_TONE: Record<RecipientState, "muted" | "neutral" | "positive"> = { UNREAD: "muted", READ: "neutral", DONE: "positive" };

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

function ProgressBar({ ratio, label }: { ratio: number; label: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={label}>
      <span className="block h-full rounded-full bg-[#2E8B57] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.round(ratio * 100)}%` }} />
    </span>
  );
}

function TaskCard({ task, now }: { task: PrTaskView; now: Date }) {
  const overdue = task.status === "OPEN" && task.dueAt !== null && task.dueAt < now;
  const { summary } = task;
  return (
    <li className="border-line px-5 py-4 [&+li]:border-t">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{PR_TASK_KIND_LABELS[task.kind]}</Badge>
            {overdue && <Badge tone="caution">Süresi geçti</Badge>}
            {task.status === "CLOSED" && <Badge tone="muted">Kapalı</Badge>}
          </div>
          <p className="mt-2 font-display text-[17px] leading-snug font-medium text-fg">{task.title}</p>
          {task.body && <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-line text-muted">{task.body}</p>}
          <p className="mt-2 text-[12px] text-muted">
            {task.event ? `${task.event.name} · ${formatDateTime(task.event.startsAt)} · ` : ""}
            {task.dueAt ? `Son tarih ${formatDateTime(task.dueAt)} · ` : ""}
            {task.createdByName ? `${task.createdByName}, ` : ""}
            {formatDateTime(task.createdAt)}
          </p>
        </div>
        {task.status === "OPEN" && (
          <ConfirmDialog
            trigger="Kapat"
            triggerVariant="ghost"
            title="Talimatı kapat"
            description={`"${task.title}" PR portalından kaldırılır. Okundu/tamamlandı bilgileri ve ilerleme geçmiş için korunur.`}
            confirmLabel="Talimatı kapat"
            action={closePrTaskAction}
            fields={{ taskId: task.id }}
          />
        )}
      </div>

      <p className="mt-3 text-[12px] text-muted" data-numeric>
        Okundu {summary.read}/{summary.total}
        {task.kind === "TODO" ? ` · Tamamlandı ${summary.done}/${summary.total}` : ""}
        {summary.reachedTarget !== null ? ` · Hedefe ulaşan ${summary.reachedTarget}/${summary.total}` : ""}
      </p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {task.recipients.map((r) => (
          <li key={r.membershipId} className="rounded-field border border-line px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] text-fg">{r.name}</span>
              <Badge tone={STATE_TONE[r.state]}>{RECIPIENT_STATE_LABELS[r.state]}</Badge>
            </div>
            {r.progress && task.guestTarget !== null && (
              <div className="mt-2 space-y-1">
                <ProgressBar ratio={r.progress.ratio} label={`${r.progress.people} / ${task.guestTarget} kişi`} />
                <p className="text-[12px] text-muted" data-numeric>
                  {r.progress.people} / {task.guestTarget} kişi · {r.progress.admitted} içeride
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** PR Yönetimi: ekibin gerçek performansı ve PR'lara talimat verme. */
export default async function PrManagementPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("pr.manage");
  const showClosed = firstParam((await searchParams).durum) === "kapali";
  const [overview, tasks] = await Promise.all([
    getPrOverview(ctx.service),
    listPrTasks(ctx.service, { status: showClosed ? "CLOSED" : "OPEN" }),
  ]);
  const { totals, team, events, windowDays } = overview;
  const activePrs = team.filter((t) => t.active);
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title="PR Yönetimi"
        description="PR ekibinize talimat verin; misafir hedeflerini ve kapıdaki gerçek girişleri takip edin."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Aktif PR" value={totals.activePrs} detail={`${team.length} PR üyeliği`} />
        <Metric label="Açık talimat" value={totals.openTasks} detail={`${totals.unreadRecipients} okunmamış`} />
        <Metric label={`PR misafiri · ${windowDays} gün`} value={totals.people} detail={`${totals.registrations} kayıt · yaklaşanlar dahil`} />
        <div className="card flex items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="font-display text-[13px] font-medium tracking-tight text-muted">Giriş oranı</p>
            <p className="mt-3 text-[13px] text-muted" data-numeric>
              {totals.people > 0 ? `${totals.admitted} / ${totals.people} kişi içeride` : "Henüz PR misafiri yok"}
            </p>
          </div>
          <CheckInRing id="pr-overview" ratio={totals.checkInRate} size={96} label={`PR misafirlerinden ${totals.admitted} kişi giriş yaptı`} caption="içeride" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Talimatlar"
            description={showClosed ? "Kapatılmış talimatlar" : "PR portalında görünen açık talimatlar"}
            action={
              <div className="flex gap-1 rounded-field border border-line p-0.5 text-[13px]">
                <Link href="/pr" className={`rounded-[8px] px-2.5 py-1 ${showClosed ? "text-muted hover:text-fg" : "bg-raised text-fg"}`}>
                  Açık
                </Link>
                <Link href="/pr?durum=kapali" className={`rounded-[8px] px-2.5 py-1 ${showClosed ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>
                  Kapalı
                </Link>
              </div>
            }
          />
          {tasks.length === 0 ? (
            <EmptyState
              compact
              title={showClosed ? "Kapatılmış talimat yok" : "Açık talimat yok"}
              description={showClosed ? undefined : "Yandaki formdan ilk talimatı gönderin."}
            />
          ) : (
            <ul>
              {tasks.map((task) => (
                <TaskCard key={task.id} task={task} now={now} />
              ))}
            </ul>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader title="Yeni talimat" description="Duyuru, görev veya etkinlik için misafir hedefi." />
          {activePrs.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] leading-relaxed text-muted">
              Bu işletmede aktif PR üyesi yok. PR hesabı ekleme, Ayarlar&apos;daki ekip yönetimi hazır olduğunda yapılabilecek.
            </p>
          ) : (
            <NewTaskForm
              prs={activePrs.map((p) => ({ id: p.membershipId, label: p.venues.length ? `${p.name} · ${p.venues.join(", ")}` : p.name }))}
              events={events.map((e) => ({ id: e.id, label: `${e.name} · ${e.venueName} · ${formatDateTime(e.startsAt)}` }))}
            />
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="PR ekibi" description={`Son ${windowDays} gün ve yaklaşan etkinliklerde getirdikleri misafirler; giriş sayıları kapıdaki gerçek kayıtlardır.`} />
        {team.length === 0 ? (
          <EmptyState compact title="PR üyesi yok" description="PR rolündeki üyeler burada listelenir." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-medium">PR</th>
                  <th className="px-3 py-2.5 font-medium">Talimat</th>
                  <th className="px-3 py-2.5 text-right font-medium">Kayıt</th>
                  <th className="px-3 py-2.5 text-right font-medium">Kişi</th>
                  <th className="px-3 py-2.5 text-right font-medium">İçeride</th>
                  <th className="px-5 py-2.5 text-right font-medium">Giriş oranı</th>
                </tr>
              </thead>
              <tbody>
                {team.map((member) => (
                  <tr key={member.membershipId} className="border-line [&+tr]:border-t">
                    <td className="px-5 py-3">
                      <p className="flex items-center gap-2 text-fg">
                        {member.name}
                        {!member.active && <Badge tone="muted">Pasif</Badge>}
                      </p>
                      <p className="text-[12px] text-muted">
                        {member.email}
                        {member.venues.length ? ` · ${member.venues.join(", ")}` : " · tüm mekanlar"}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-muted" data-numeric>
                      {member.openTasks > 0 ? `${member.openTasks} açık${member.unreadTasks ? ` · ${member.unreadTasks} okunmadı` : ""}` : "—"}
                    </td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {member.stats.registrations}
                    </td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {member.stats.people}
                    </td>
                    <td className="px-3 py-3 text-right" data-numeric>
                      {member.stats.admitted}
                    </td>
                    <td className="px-5 py-3 text-right text-muted" data-numeric>
                      {member.stats.people > 0 ? `%${Math.round(member.stats.checkInRate * 100)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
