import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { formatDateTime } from "@/lib/datetime";
import { getChannelOverview } from "@/modules/campaigns/accounts";
import { listCampaigns } from "@/modules/campaigns/campaign-service";
import { getEmailOverview } from "@/modules/campaigns/email-service";
import { getInstagramOverview } from "@/modules/campaigns/instagram-service";
import { CAMPAIGN_CHANNEL_LABELS, deliveryTotals } from "@/modules/campaigns/rules";
import { getSmsAccount } from "@/modules/campaigns/sms-service";
import { CampaignNav } from "@/components/campaigns/campaign-nav";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Kampanyalar" };

function StatusCard({ label, value, detail, tone, action }: { label: string; value: string; detail: string; tone: "positive" | "caution" | "muted"; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-[13px] font-medium tracking-tight text-muted">{label}</p>
        <span className={`size-2 rounded-full ${tone === "positive" ? "bg-positive" : tone === "caution" ? "bg-caution" : "bg-line-strong"}`} aria-hidden />
      </div>
      <p className="mt-3 font-display text-[20px] leading-tight font-medium break-words">{value}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{detail}</p>
      {action && <div className="mt-auto pt-3">{action}</div>}
    </div>
  );
}

/** Kampanyalar: kanal durumu, gönderilen kampanyalar ve gerçek teslim sayıları. */
export default async function CampaignsPage() {
  const ctx = await requirePermission("campaigns.manage");
  const [overview, campaigns, sms, email, instagram] = await Promise.all([
    getChannelOverview(ctx.service),
    listCampaigns(ctx.service),
    getSmsAccount(ctx.service),
    getEmailOverview(ctx.service),
    getInstagramOverview(ctx.service),
  ]);
  const { account, iys, usage } = overview;
  const connected = account?.status === "ACTIVE" && account.tokenUsable;
  const channels = [
    { label: "WhatsApp", href: "/campaigns/whatsapp", ready: Boolean(connected), detail: connected ? account.displayPhoneNumber : "Numara bağlı değil" },
    { label: "SMS", href: "/campaigns/sms", ready: sms?.status === "ACTIVE" && sms.passwordUsable, detail: sms?.status === "ACTIVE" ? `Başlık ${sms.msgheader}` : "Netgsm bağlı değil" },
    {
      label: "E-posta",
      href: "/campaigns/email",
      ready: email.provider.ready && Boolean(email.settings),
      detail: !email.provider.ready ? "Servis yapılandırılmadı" : email.settings ? email.settings.senderName : "Gönderici ayarlanmadı",
    },
    {
      label: "Instagram",
      href: "/campaigns/instagram",
      ready: instagram.account?.status === "ACTIVE",
      detail: instagram.account?.status === "ACTIVE" ? `@${instagram.account.username} · ${instagram.rules.filter((r) => r.isActive).length} otomatik yanıt` : "Hesap bağlı değil",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title="Kampanyalar"
        description="İzinli müşterilerinize WhatsApp, SMS veya e-posta ile kampanya gönderin; kitleyi seçin, tek tuşta gönderin ve teslim durumunu izleyin. Instagram'da DM'lere otomatik yanıt verin."
        actions={
          <ButtonLink href="/campaigns/new" variant="primary">
            Yeni kampanya
          </ButtonLink>
        }
      />
      <CampaignNav active="/campaigns" />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-5">
          <p className="font-display text-[13px] font-medium tracking-tight text-muted">Kanallar</p>
          <ul className="mt-3 space-y-2">
            {channels.map((ch) => (
              <li key={ch.label}>
                <Link href={ch.href} className="flex items-center gap-2.5 text-[13px] hover:text-fg">
                  <span className={`size-2 shrink-0 rounded-full ${ch.ready ? "bg-positive" : "bg-caution"}`} aria-hidden />
                  <span className="w-[72px] shrink-0 text-fg">{ch.label}</span>
                  <span className="min-w-0 truncate text-muted">{ch.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <StatusCard
          label="İYS"
          tone={iys.configured ? "positive" : "caution"}
          value={iys.configured ? `WhatsApp: ${iys.name}` : "WhatsApp: entegratör bağlı değil"}
          detail={
            iys.configured
              ? "WhatsApp'ta gönderimden hemen önce İYS onayı kontrol edilir; SMS'te kontrolü Netgsm yapar."
              : "WhatsApp'ta müşterilere gönderim kapalı (yalnızca test numaraları). SMS'te İYS kontrolünü Netgsm yapar; e-postada gönderim öncesi İYS sorgusu zorunlu değil."
          }
        />
        <StatusCard
          label="Bu ay"
          tone="muted"
          value={`${usage.accepted} mesaj iletildi`}
          detail={`Tüm kanallar · ${usage.delivered} teslim edildi · ${usage.failed} başarısız · WhatsApp'ta ${usage.billable} ücretli (Meta bildirimi)`}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Gönderimler" description="Test gönderimleri dahil. Sayılar sağlayıcıların (Meta, Netgsm, Brevo) bildirdiği gerçek durumlardır." />
        {campaigns.length === 0 ? (
          <EmptyState
            compact
            title="Henüz gönderim yok"
            description="Kanalı ve kitleyi seçip mesajınızı hazırlayarak ilk kampanyanızı gönderin."
            action={
              <ButtonLink href="/campaigns/new" size="sm">
                Yeni kampanya
              </ButtonLink>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-medium">Kampanya</th>
                  <th className="px-3 py-2.5 text-right font-medium">Alıcı</th>
                  <th className="px-3 py-2.5 text-right font-medium">İletildi</th>
                  <th className="px-3 py-2.5 text-right font-medium">Teslim</th>
                  <th className="px-3 py-2.5 text-right font-medium">Okundu</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sorunlu</th>
                  <th className="px-5 py-2.5 text-right font-medium">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const d = deliveryTotals(c.counts);
                  return (
                    <tr key={c.id} className="border-line transition-colors hover:bg-raised/50 [&+tr]:border-t">
                      <td className="px-5 py-3">
                        <Link href={`/campaigns/${c.id}`} className="font-medium text-fg hover:underline">
                          {c.name}
                        </Link>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                          <Badge tone="neutral">{CAMPAIGN_CHANNEL_LABELS[c.channel]}</Badge>
                          <Badge tone={c.mode === "TEST" ? "muted" : "neutral"}>{c.mode === "TEST" ? "Test" : "Canlı"}</Badge>
                          {c.status === "SENDING" && <Badge tone="caution">Gönderiliyor</Badge>}
                          {c.audienceLabel}
                          {c.templateName ? ` · ${c.templateName}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right" data-numeric>
                        {c.recipientCount}
                      </td>
                      <td className="px-3 py-3 text-right" data-numeric>
                        {d.accepted}
                      </td>
                      <td className="px-3 py-3 text-right" data-numeric>
                        {d.delivered}
                      </td>
                      <td className="px-3 py-3 text-right" data-numeric>
                        {d.read}
                      </td>
                      <td className={`px-3 py-3 text-right ${d.problems ? "text-caution" : "text-muted"}`} data-numeric>
                        {d.problems}
                      </td>
                      <td className="px-5 py-3 text-right text-[13px] whitespace-nowrap text-muted">{formatDateTime(c.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
