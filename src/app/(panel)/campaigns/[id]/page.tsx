import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { formatDateTime } from "@/lib/datetime";
import { orNotFound } from "@/lib/page";
import { resumeCampaignAction } from "@/modules/campaigns/actions";
import { refreshSmsStatusesAction } from "@/modules/campaigns/channel-actions";
import { getCampaignDetail } from "@/modules/campaigns/campaign-service";
import { getEmailOverview } from "@/modules/campaigns/email-service";
import { CAMPAIGN_CHANNEL_LABELS, EXCLUSION_LABELS, MESSAGE_STATUS_LABELS, deliveryTotals, formatUsd, type ExclusionReason, type MessageStatus } from "@/modules/campaigns/rules";
import { getSmsAccount } from "@/modules/campaigns/sms-service";
import { ActionButton } from "@/components/campaigns/action-button";
import { EmailPreview } from "@/components/campaigns/email-preview";
import { SmsBubble } from "@/components/campaigns/sms-bubble";
import { WhatsAppBubble } from "@/components/campaigns/whatsapp-bubble";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Kampanya" };

const TONE: Record<MessageStatus, "neutral" | "muted" | "positive" | "caution" | "negative"> = {
  QUEUED: "muted",
  SENDING: "muted",
  ACCEPTED: "neutral",
  SENT: "neutral",
  DELIVERED: "positive",
  READ: "positive",
  FAILED: "negative",
  SKIPPED: "caution",
};

function Metric({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-2 font-display text-[28px] leading-none font-medium" data-numeric>
        {value}
      </p>
      {detail && <p className="mt-1.5 text-[12px] text-muted">{detail}</p>}
    </div>
  );
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("campaigns.manage");
  const { id } = await params;
  const c = await orNotFound(getCampaignDetail(ctx.service, id));
  const [sms, email] = await Promise.all([
    c.channel === "SMS" ? getSmsAccount(ctx.service) : Promise.resolve(null),
    c.channel === "EMAIL" ? getEmailOverview(ctx.service) : Promise.resolve(null),
  ]);
  const t = deliveryTotals(c.counts);
  const channelLabel = CAMPAIGN_CHANNEL_LABELS[c.channel];
  const exclusions = (Object.entries(c.exclusions) as [ExclusionReason, number][]).filter(([, n]) => n > 0);

  return (
    <>
      <AutoRefresh active={t.pending > 0} />
      <PageHeader
        back={{ href: "/campaigns", label: "Kampanyalar" }}
        eyebrow={c.mode === "TEST" ? `${channelLabel} · test gönderimi` : `${channelLabel} kampanyası`}
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {c.status === "SENDING" ? <Badge tone="caution">Gönderiliyor</Badge> : <Badge tone="positive">Gönderim tamamlandı</Badge>}
            <span>{c.audienceLabel}</span>
            <span>
              · {formatDateTime(c.createdAt)}
              {c.createdByName ? ` · ${c.createdByName}` : ""}
            </span>
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Alıcı" value={c.recipientCount} detail={c.excludedCount ? `${c.excludedCount} kişi önceden elendi` : undefined} />
        <Metric label={c.channel === "WHATSAPP" ? "Meta'ya iletildi" : c.channel === "SMS" ? "Netgsm'e iletildi" : "Brevo'ya iletildi"} value={t.accepted} />
        <Metric label="Teslim edildi" value={t.delivered} />
        {c.channel === "WHATSAPP" && <Metric label="Okundu" value={t.read} detail="Kişinin okundu ayarına bağlı" />}
        {c.channel === "EMAIL" && <Metric label="Açıldı" value={c.engagement?.opened ?? 0} detail={`Yaklaşık · ${c.engagement?.clicked ?? 0} tıklama`} />}
        <Metric label="Başarısız" value={t.failed} />
        <Metric label="Gönderilmedi" value={t.skipped} detail={c.channel === "SMS" ? "İzin veya İYS kontrolü" : "Gönderim anı kontrolü"} />
      </div>

      {c.channel === "SMS" && (c.counts.ACCEPTED > 0 || c.counts.SENT > 0) && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
            <p className="text-muted" data-numeric>
              <span className="text-fg">{c.counts.ACCEPTED + c.counts.SENT} SMS</span> için teslim bilgisi Netgsm raporundan alınır (dakikada en fazla 10 sorgu).
            </p>
            <ActionButton action={refreshSmsStatusesAction} fields={{ id: c.id }} variant="secondary" pendingLabel="Netgsm'e soruluyor">
              Teslim durumlarını güncelle
            </ActionButton>
          </div>
        </Card>
      )}

      {(t.pending > 0 || c.stuckSending > 0) && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
            <p className="text-muted" data-numeric>
              {c.counts.QUEUED > 0 && <span className="text-fg">{c.counts.QUEUED} mesaj sırada. </span>}
              {c.stuckSending > 0 && `${c.stuckSending} mesajın Meta'ya ulaşıp ulaşmadığı bilinmiyor; tekrar gönderilmez. `}
              Sayfa gönderim sürdükçe kendini yeniler.
            </p>
            {c.counts.QUEUED > 0 && (
              <ActionButton action={resumeCampaignAction} fields={{ id: c.id }} variant="secondary" pendingLabel="Başlatılıyor">
                Gönderime devam et
              </ActionButton>
            )}
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Mesajlar" description={c.truncated ? `İlk ${c.messages.length} mesaj gösteriliyor` : `${c.messages.length} mesaj`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-medium">Alıcı</th>
                  <th className="px-3 py-2.5 font-medium">Durum</th>
                  <th className="px-5 py-2.5 text-right font-medium">Son güncelleme</th>
                </tr>
              </thead>
              <tbody>
                {c.messages.map((m) => (
                  <tr key={m.id} className="border-line align-top [&+tr]:border-t">
                    <td className="px-5 py-3">
                      {m.customerId ? (
                        <Link href={`/customers/${m.customerId}`} className="text-fg hover:underline">
                          {m.recipient}
                        </Link>
                      ) : (
                        <span className="text-fg">{m.recipient}</span>
                      )}
                      <p className="text-[12px] text-muted" data-numeric>
                        {m.phoneLabel}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={TONE[m.status]}>{MESSAGE_STATUS_LABELS[m.status]}</Badge>
                      {m.skipReason && <p className="mt-1 text-[12px] text-muted">{EXCLUSION_LABELS[m.skipReason]}</p>}
                      {m.errorMessage && <p className="mt-1 max-w-xs text-[12px] break-words text-negative">{m.errorMessage}</p>}
                    </td>
                    <td className="px-5 py-3 text-right text-[13px] whitespace-nowrap text-muted">{formatDateTime(m.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Mesaj" description={c.template?.name ?? c.content.subject ?? undefined} />
            <div className="p-4">
              {c.template && <WhatsAppBubble template={c.template} />}
              {c.channel === "SMS" && c.content.body && (
                <>
                  <SmsBubble body={c.content.body} footer={sms?.legalFooter ?? ""} header={sms?.msgheader} />
                  <p className="mt-2 text-[12px] text-muted">Yasal bilgi gönderim anındaki SMS ayarlarından eklenir.</p>
                </>
              )}
              {c.channel === "EMAIL" && c.content.subject && c.content.body && (
                <EmailPreview
                  content={{ subject: c.content.subject, body: c.content.body, ctaLabel: c.content.ctaLabel, ctaUrl: c.content.ctaUrl }}
                  senderName={email?.settings?.senderName ?? ctx.tenant.name}
                  legalFooter={email?.settings?.legalFooter ?? ""}
                  height={420}
                />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Gönderim öncesi" />
            <div className="space-y-2 p-5 text-[13px] text-muted">
              {exclusions.length === 0 ? (
                <p>Kitleden elenen kişi olmadı.</p>
              ) : (
                <ul className="space-y-1">
                  {exclusions.map(([reason, n]) => (
                    <li key={reason} data-numeric>
                      {n} kişi: {EXCLUSION_LABELS[reason]}
                    </li>
                  ))}
                </ul>
              )}
              {c.estimatedCostMicroUsd !== null && (
                <p>
                  Tahmini Meta ücreti: <span className="text-fg">{formatUsd(c.estimatedCostMicroUsd)}</span> · Meta&apos;nın ücretli bildirdiği mesaj: {c.billable}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
