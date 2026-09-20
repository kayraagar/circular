import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { can } from "@/lib/authz";
import { orNotFound } from "@/lib/page";
import { formatBirthDate, formatDate, formatDateTime, formatRange } from "@/lib/datetime";
import { formatPhone, fullName } from "@/lib/normalize";
import {
  ACCESS_STATUS_LABELS,
  CHANNELS,
  CONSENT_SOURCE_LABELS,
  CUSTOMER_SOURCE_LABELS,
  labelOf,
  type Channel,
} from "@/lib/domain";
import { getCustomerProfile } from "@/modules/customers/service";
import { setArchivedAction } from "@/modules/customers/actions";
import { listActivity } from "@/modules/activity/service";
import { ATTENDANCE_LABELS, attendanceState } from "@/modules/events/attendance";
import { getCustomerVerifiedActivity } from "@/modules/passes/service";
import { listCustomerPerks } from "@/modules/perks/service";
import { ActivityFeed } from "@/components/activity-feed";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ConsentPanel, type ConsentRow } from "./consent-panel";
import { PerkPanel, type PerkPanelItem } from "./perk-panel";

export const metadata: Metadata = { title: "Müşteri profili" };

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("customers.view");
  const { id } = await params;
  const { customer, createdByName } = await orNotFound(getCustomerProfile(ctx.service, id));
  const activity = await listActivity(ctx.service, { customerId: customer.id, limit: 25 });
  const verified = await getCustomerVerifiedActivity(ctx.service, customer.id);
  const role = ctx.membership.role;
  const canIssuePerks = can(role, "perks.issue");
  const perkItems: PerkPanelItem[] = canIssuePerks
    ? (await listCustomerPerks(ctx.service, customer.id)).map((p) => ({
        perkId: p.perkId,
        name: p.name,
        meta: [p.venueName ?? "Tüm mekanlar", p.validUntil ? `Son geçerlilik ${formatDateTime(p.validUntil)}` : null]
          .filter(Boolean)
          .join(" · "),
        availability: p.availability,
        used: p.used,
        limit: p.limit,
        activePass: p.activePass,
      }))
    : [];
  const name = fullName(customer);
  const archived = customer.archivedAt !== null;
  const now = new Date();

  const consentRows: ConsentRow[] = CHANNELS.map((channel: Channel) => {
    const c = customer.consents.find((x) => x.channel === channel);
    const changed = c ? (c.status === "GRANTED" ? c.grantedAt : c.revokedAt) : null;
    return {
      channel,
      status: (c?.status as ConsentRow["status"]) ?? null,
      note: c?.note ?? null,
      changedAt: changed ? formatDateTime(changed) : null,
      sourceLabel: c ? labelOf(CONSENT_SOURCE_LABELS, c.source) : null,
    };
  });
  const activeRegs = customer.registrations.filter((r) => r.accessStatus === "ACTIVE");

  return (
    <>
      <PageHeader
        back={{ href: "/customers", label: "Müşteriler" }}
        eyebrow={labelOf(CUSTOMER_SOURCE_LABELS, customer.source)}
        title={
          <span className="flex items-center gap-4">
            <Avatar name={name} size={52} />
            <span className="min-w-0">
              <span className="block truncate">{name}</span>
            </span>
          </span>
        }
        actions={
          <>
            {can(role, "customers.archive") && (
              <ConfirmDialog
                trigger={archived ? "Arşivden çıkar" : "Arşivle"}
                triggerVariant={archived ? "secondary" : "ghost"}
                triggerSize="md"
                title={archived ? "Müşteriyi arşivden çıkar" : "Müşteriyi arşivle"}
                description={
                  archived
                    ? "Müşteri yeniden listelerde ve guest aramalarında görünür."
                    : "Müşteri listelerden ve guest aramalarından kaldırılır. Etkinlik geçmişi ve aktivite kayıtları korunur; istediğiniz zaman geri alabilirsiniz."
                }
                confirmLabel={archived ? "Arşivden çıkar" : "Arşivle"}
                confirmVariant={archived ? "primary" : "danger"}
                action={setArchivedAction}
                fields={{ customerId: customer.id, archive: archived ? "0" : "1" }}
              />
            )}
            {can(role, "customers.update") && (
              <ButtonLink href={`/customers/${customer.id}/edit`} variant="primary">
                Düzenle
              </ButtonLink>
            )}
          </>
        }
      />

      {(archived || customer.tags.length > 0) && (
        <div className="-mt-4 mb-8 flex flex-wrap items-center gap-1.5">
          {archived && <Badge tone="caution">Arşivde · {formatDate(customer.archivedAt!)}</Badge>}
          {customer.tags.map((t) => (
            <Link key={t.tag.id} href={`/customers?tag=${t.tag.id}`} className="rounded-full">
              <Badge>{t.tag.name}</Badge>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Etkinlik kayıtları"
              description={`${activeRegs.length} aktif kayıt · toplam ${activeRegs.reduce((s, r) => s + r.partySize, 0)} kişi`}
            />
            {customer.registrations.length === 0 ? (
              <EmptyState compact title="Etkinlik kaydı yok" description="Bir etkinliğin guest listesine eklendiğinde burada görünür." />
            ) : (
              <ul>
                {customer.registrations.map((r) => {
                  const att = attendanceState(
                    { accessStatus: r.accessStatus, checkInCount: verified.checkInByRegistration[r.id] ? 1 : 0 },
                    r.event,
                    now,
                  );
                  return (
                    <li key={r.id} className="flex flex-col gap-2 border-line px-5 py-3.5 sm:flex-row sm:items-center [&+li]:border-t">
                      <div className="min-w-0 flex-1">
                        <Link href={`/events/${r.event.id}`} className="text-sm font-medium text-fg hover:underline hover:underline-offset-4">
                          {r.event.name}
                        </Link>
                        <p className="text-[13px] text-muted">
                          {r.event.venue.name} · {formatRange(r.event.startsAt, r.event.endsAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.partySize > 1 && <Badge tone="muted" mono>{r.partySize} kişi</Badge>}
                        <Badge tone={r.accessStatus === "ACTIVE" ? "neutral" : "negative"}>
                          {labelOf(ACCESS_STATUS_LABELS, r.accessStatus)}
                        </Badge>
                        {r.accessStatus === "ACTIVE" && (
                          <Badge tone={att === "CHECKED_IN" ? "positive" : att === "NO_SHOW" ? "caution" : "muted"}>
                            {ATTENDANCE_LABELS[att]}
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Ziyaret ve etkileşim verileri" description="Personel doğrulamasıyla (QR veya manuel) kaydedilen gerçek kullanım" />
            <dl className="grid gap-px overflow-hidden rounded-b-card bg-line sm:grid-cols-3">
              <div className="bg-surface p-5">
                <dt className="text-sm text-fg">Doğrulanmış etkinlik girişi</dt>
                <dd className="mt-2 font-display text-[26px] leading-none font-medium" data-numeric>
                  {verified.checkIns.length}
                </dd>
                <dd className="mt-2 text-[13px] text-muted">
                  {verified.checkIns[0] ? `Son: ${formatDateTime(verified.checkIns[0].checkedInAt)}` : "Henüz giriş kaydı yok"}
                </dd>
              </div>
              <div className="bg-surface p-5">
                <dt className="text-sm text-fg">Avantaj kullanımı</dt>
                <dd className="mt-2 font-display text-[26px] leading-none font-medium" data-numeric>
                  {verified.redemptionCount}
                </dd>
                <dd className="mt-2 truncate text-[13px] text-muted">
                  {verified.redemptions[0]
                    ? `Son: ${verified.redemptions[0].perkName} · ${formatDateTime(verified.redemptions[0].redeemedAt)}`
                    : "Henüz kullanım yok"}
                </dd>
              </div>
              <div className="bg-surface p-5">
                <dt className="text-sm text-fg">Kampanya etkileşimi</dt>
                <dd className="mt-2 text-[13px] text-muted">Henüz ölçülmüyor · Gönderim sağlayıcıları</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Aktivite geçmişi" />
            <ActivityFeed items={activity.items} emptyText="Bu müşteriyle ilgili işlemler burada görünecek." />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Bilgiler" />
            <dl className="divide-y divide-line text-sm">
              {[
                ["Telefon", customer.phone ? <span className="font-mono whitespace-nowrap">{formatPhone(customer.phone)}</span> : null],
                ["E-posta", customer.email ? <span className="break-all">{customer.email}</span> : null],
                ["Doğum tarihi", customer.birthDate ? formatBirthDate(customer.birthDate) : null],
                ["Kayıt kaynağı", labelOf(CUSTOMER_SOURCE_LABELS, customer.source)],
                ["Eklenme", `${formatDateTime(customer.createdAt)}${createdByName ? ` · ${createdByName}` : ""}`],
              ].map(([label, value]) => (
                <div key={label as string} className="px-5 py-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-0.5 break-words text-fg">{value ?? <span className="text-muted">—</span>}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="İletişim tercihleri" description="Kanal bazında açık izin" />
            <ConsentPanel
              customerId={customer.id}
              rows={consentRows}
              canManage={can(role, "consents.manage")}
              hasPhone={!!customer.phone}
              hasEmail={!!customer.email}
              archived={archived}
            />
          </Card>

          {canIssuePerks && (
            <Card>
              <CardHeader title="Avantajlar" description="Kişiye özel avantaj QR'ı" />
              <PerkPanel customerId={customer.id} customerName={name} items={perkItems} />
            </Card>
          )}

          <Card>
            <CardHeader title="Mekan üyeliği" />
            {customer.venueMemberships.length === 0 ? (
              <p className="px-5 py-4 text-[13px] leading-relaxed text-muted">
                Üyelik kaydı yok. Üyelik, müşterinin mekanın kayıt sayfasından kendisinin katılmasıyla oluşur; CRM kaydı veya guest
                listesi üyelik sayılmaz.
              </p>
            ) : (
              <ul>
                {customer.venueMemberships.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 border-line px-5 py-3 text-sm [&+li]:border-t">
                    <span className="text-fg">{m.venue.name}</span>
                    <span className="text-xs text-muted">{formatDate(m.joinedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Notlar" />
            <p className="px-5 py-4 text-sm leading-relaxed whitespace-pre-line text-fg">
              {customer.notes || <span className="text-muted">Not eklenmemiş.</span>}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
