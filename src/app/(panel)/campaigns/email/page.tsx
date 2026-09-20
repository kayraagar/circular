import type { Metadata } from "next";
import { can } from "@/lib/authz";
import { requirePermission } from "@/lib/context";
import { getEmailOverview } from "@/modules/campaigns/email-service";
import { CampaignNav } from "@/components/campaigns/campaign-nav";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { EmailSettingsForm } from "./email-settings-form";
import { EmailTestRecipients } from "./email-test-recipients";

export const metadata: Metadata = { title: "E-posta" };

/** E-posta kanalı: gönderici ayarları, test adresleri ve Brevo bildirim adresi. */
export default async function EmailChannelPage() {
  const ctx = await requirePermission("campaigns.manage");
  const overview = await getEmailOverview(ctx.service);
  const { provider, settings } = overview;
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const webhookUrl = `${base}/api/webhooks/brevo`;

  return (
    <>
      <PageHeader eyebrow={ctx.tenant.name} title="Kampanyalar" description="E-postalar Circular'ın doğrulanmış adresinden, işletmenizin adıyla gönderilir." />
      <CampaignNav active="/campaigns/email" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Gönderici"
              description={provider.senderEmail ? `Gönderen adres: ${provider.senderEmail}` : "Gönderen adres Circular tarafından tanımlanır."}
              action={<Badge tone={settings ? "positive" : "caution"}>{settings ? "Kaydedildi" : "Ayarlanmadı"}</Badge>}
            />
            <EmailSettingsForm current={settings} defaultName={ctx.tenant.name} canEdit={can(ctx.membership.role, "channels.connect")} />
          </Card>
          <Card>
            <CardHeader title="Test adresleri" description="Kampanyayı müşterilere göndermeden önce ekibin adreslerine deneyin. Konunun başına [TEST] eklenir." />
            <div className="p-5">
              <EmailTestRecipients recipients={overview.testRecipients} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="E-posta servisi" action={<Badge tone={provider.ready ? "positive" : "caution"}>{provider.ready ? "Hazır" : "Yapılandırılmadı"}</Badge>} />
            <div className="space-y-2 p-5 text-[13px] leading-relaxed text-muted">
              {provider.ready ? (
                <p>Gönderim Brevo üzerinden yapılır. Her e-postada yasal bilgi ve &quot;Abonelikten çık&quot; bağlantısı bulunur; tek tıkla çıkış desteklenir.</p>
              ) : (
                <>
                  <p className="text-fg">Circular&apos;ın Brevo hesabı henüz tanımlanmadı.</p>
                  <p>
                    Circular ekibi: sunucuya <code className="font-mono text-[12px] text-fg">BREVO_API_KEY</code> ve Brevo&apos;da alan adı doğrulanmış (SPF, DKIM, DMARC){" "}
                    <code className="font-mono text-[12px] text-fg">BREVO_SENDER_EMAIL</code> değerlerini girmeli.
                  </p>
                </>
              )}
              <p>Açılma sayıları yaklaşıktır: bazı e-posta uygulamaları görselleri önceden yükler.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Bildirim adresi (Brevo webhook)" action={<Badge tone={provider.webhookReady ? "positive" : "muted"}>{provider.webhookReady ? "Hazır" : "Yapılandırılmadı"}</Badge>} />
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap gap-2">
                <input readOnly value={webhookUrl} aria-label="Brevo webhook adresi" className="input min-w-0 flex-1 basis-40 font-mono !text-xs" />
                <CopyButton value={webhookUrl} />
              </div>
              <p className="text-[12px] leading-relaxed text-muted">
                Brevo&apos;da işlemsel e-posta webhook&apos;u olarak ekleyin; yetkilendirmede <code className="font-mono">BREVO_WEBHOOK_TOKEN</code> değerini Bearer token olarak
                girin. Teslim, geri dönme, açılma, tıklama, spam ve abonelikten çıkma olaylarını seçin.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
