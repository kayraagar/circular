import type { Metadata } from "next";
import { can } from "@/lib/authz";
import { requirePermission } from "@/lib/context";
import { formatDateTime } from "@/lib/datetime";
import { getChannelOverview } from "@/modules/campaigns/accounts";
import { disconnectSmsAction } from "@/modules/campaigns/channel-actions";
import { getSmsAccount } from "@/modules/campaigns/sms-service";
import { CampaignNav } from "@/components/campaigns/campaign-nav";
import { SmsBubble } from "@/components/campaigns/sms-bubble";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { TestRecipients } from "../whatsapp/test-recipients";
import { SmsConnectForm } from "./sms-connect-form";

export const metadata: Metadata = { title: "SMS" };

/** SMS kanalı: Netgsm hesabı, başlık, yasal bilgi, İYS ve test numaraları. */
export default async function SmsChannelPage() {
  const ctx = await requirePermission("campaigns.manage");
  const [account, overview] = await Promise.all([getSmsAccount(ctx.service), getChannelOverview(ctx.service)]);
  const isOwner = can(ctx.membership.role, "channels.connect");
  const connected = account?.status === "ACTIVE";

  return (
    <>
      <PageHeader eyebrow={ctx.tenant.name} title="Kampanyalar" description="SMS kampanyaları işletmenin kendi Netgsm hesabı ve onaylı başlığıyla gönderilir." />
      <CampaignNav active="/campaigns/sms" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Netgsm hesabı"
              description={connected ? `Bağlandı ${formatDateTime(account.connectedAt)}` : "Kullanıcı adı, şifre ve başlık Netgsm'den doğrulanarak kaydedilir."}
              action={
                connected ? (
                  <Badge tone={account.passwordUsable ? "positive" : "caution"}>{account.passwordUsable ? "Bağlı" : "Yeniden bağlanmalı"}</Badge>
                ) : (
                  <Badge tone="muted">Bağlı değil</Badge>
                )
              }
            />
            <div className="space-y-5 p-5">
              {isOwner ? (
                <SmsConnectForm current={connected ? { username: account.username, msgheader: account.msgheader, legalFooter: account.legalFooter } : null} />
              ) : connected ? (
                <p className="text-sm text-muted">
                  Başlık <span className="font-mono text-fg">{account.msgheader}</span>. Hesap ayarlarını işletme sahibi değiştirebilir.
                </p>
              ) : (
                <p className="text-sm text-muted">Netgsm hesabını işletme sahibi bağlayabilir.</p>
              )}
              {isOwner && connected && (
                <ConfirmDialog
                  trigger="Bağlantıyı kes"
                  title="SMS bağlantısını kes"
                  description="Netgsm şifresi silinir ve SMS gönderimi durur. Geçmiş kampanyalar korunur."
                  confirmLabel="Bağlantıyı kes"
                  action={disconnectSmsAction}
                  fields={{}}
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Test numaraları" description="WhatsApp ile ortaktır. SMS testi yalnızca Türkiye numaralarına gider ve metnin başına TEST: eklenir." />
            <div className="p-5">
              <TestRecipients recipients={overview.testRecipients} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {connected && (
            <Card>
              <CardHeader title="Örnek SMS" />
              <div className="p-4">
                <SmsBubble body="Merhaba {{ad}}, bu cuma DJ gecesinde seni bekliyoruz!" footer={account.legalFooter} header={account.msgheader} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="İYS" action={<Badge tone="neutral">Netgsm kontrol eder</Badge>} />
            <div className="space-y-2 p-5 text-[13px] leading-relaxed text-muted">
              <p>
                Kampanya SMS&apos;leri İYS filtresiyle gönderilir: Netgsm, İYS&apos;de onayı olmayan numaraya ticari SMS iletmez; bu kişiler kampanyada
                &quot;Gönderilmedi · İYS&apos;de onayı yok&quot; olarak görünür.
              </p>
              <p>Bunun için işletmenin İYS&apos;ye kayıtlı olması ve İYS&apos;de Netgsm&apos;i iş ortağı olarak yetkilendirmesi gerekir.</p>
              <p>0800 hattına gelen ret bildirimlerini Netgsm İYS&apos;ye işler; Circular&apos;daki SMS izni bu bildirimle otomatik güncellenmez.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Kurulum" />
            <ol className="list-decimal space-y-2 py-5 pr-5 pl-9 text-[13px] leading-relaxed text-muted">
              <li>Netgsm&apos;de işletme için hesap (Circular bayi hesabı altında alt hesap) ve API alt kullanıcısı açılır.</li>
              <li>SMS başlığı işletmenin belgeleriyle Netgsm&apos;den onaylatılır.</li>
              <li>İşletme İYS&apos;ye kayıt olur ve Netgsm&apos;i iş ortağı olarak yetkilendirir.</li>
              <li>Bilgiler bu ekrana girilir; SMS paketi Circular tarafından yüklenir.</li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
