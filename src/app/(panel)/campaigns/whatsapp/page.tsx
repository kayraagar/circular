import type { Metadata } from "next";
import { can } from "@/lib/authz";
import { requirePermission } from "@/lib/context";
import { formatDateTime } from "@/lib/datetime";
import { getChannelOverview } from "@/modules/campaigns/accounts";
import { disconnectWhatsAppAction } from "@/modules/campaigns/actions";
import { CampaignNav } from "@/components/campaigns/campaign-nav";
import { CopyButton } from "@/components/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { EmbeddedSignupButton } from "./embedded-signup";
import { ManualConnectForm } from "./manual-connect-form";
import { TestRecipients } from "./test-recipients";

export const metadata: Metadata = { title: "WhatsApp bağlantısı" };

const QUALITY: Record<string, { label: string; tone: "positive" | "caution" | "negative" | "muted" }> = {
  GREEN: { label: "Kalite: yüksek", tone: "positive" },
  YELLOW: { label: "Kalite: orta", tone: "caution" },
  RED: { label: "Kalite: düşük", tone: "negative" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-fg sm:text-right">{children}</dd>
    </div>
  );
}

/** İşletmenin WhatsApp numarası, test numaraları, İYS durumu ve bu ayki kullanım. */
export default async function WhatsAppChannelPage() {
  const ctx = await requirePermission("campaigns.manage");
  const overview = await getChannelOverview(ctx.service);
  const { account, setup, iys, usage, testRecipients } = overview;
  const isOwner = can(ctx.membership.role, "whatsapp.connect");
  const connected = account?.status === "ACTIVE";
  const quality = account?.qualityRating ? QUALITY[account.qualityRating] : undefined;

  return (
    <>
      <PageHeader eyebrow={ctx.tenant.name} title="Kampanyalar" description="İşletmenizin WhatsApp numarası ve gönderim kurulumu." />
      <CampaignNav active="/campaigns/whatsapp" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="WhatsApp numarası"
              description="Kampanyalar işletmenin kendi numarasından gönderilir; mesaj ücretlerini Circular üstlenir."
              action={connected ? <Badge tone={account.tokenUsable ? "positive" : "caution"}>{account.tokenUsable ? "Bağlı" : "Yeniden bağlanmalı"}</Badge> : <Badge tone="muted">Bağlı değil</Badge>}
            />
            <div className="p-5">
              {connected ? (
                <>
                  <dl className="divide-y divide-line">
                    <Row label="Numara">{account.displayPhoneNumber}</Row>
                    <Row label="Görünen işletme adı">{account.verifiedName ?? "—"}</Row>
                    <Row label="Meta kalite puanı">{quality ? <Badge tone={quality.tone}>{quality.label}</Badge> : "Henüz yok"}</Row>
                    <Row label="Bağlantı">
                      {account.connectionMethod === "MANUAL" ? "Elle (geliştirme)" : "Meta bağlantı akışı"} · {formatDateTime(account.connectedAt)}
                    </Row>
                  </dl>
                  {!account.tokenUsable && (
                    <p className="mt-3 text-[13px] text-caution">Kayıtlı erişim bilgisi çözülemedi (şifreleme anahtarı değişmiş olabilir). Bağlantıyı kesip numarayı yeniden bağlayın.</p>
                  )}
                  {isOwner ? (
                    <div className="mt-4">
                      <ConfirmDialog
                        trigger="Bağlantıyı kes"
                        title="WhatsApp bağlantısını kes"
                        description="Erişim bilgisi silinir ve bu numaradan gönderim durur. Sırada bekleyen mesajlar gönderilmez; geçmiş kampanyalar korunur."
                        confirmLabel="Bağlantıyı kes"
                        action={disconnectWhatsAppAction}
                        fields={{}}
                      />
                    </div>
                  ) : (
                    <p className="mt-4 text-[13px] text-muted">Numarayı yalnızca işletme sahibi değiştirebilir.</p>
                  )}
                </>
              ) : !isOwner ? (
                <p className="text-sm text-muted">WhatsApp numarasını işletme sahibi bağlayabilir.</p>
              ) : setup.embeddedSignupReady && setup.appId && setup.configId ? (
                <EmbeddedSignupButton appId={setup.appId} configId={setup.configId} graphVersion={setup.graphVersion} />
              ) : (
                <div className="space-y-2 text-sm leading-relaxed text-muted">
                  <p className="text-fg">Circular&apos;ın Meta uygulaması henüz yapılandırılmadı.</p>
                  <p>
                    Mekanların numaralarını birkaç tıkla bağlayabilmesi için Circular ekibinin Meta işletme doğrulamasını, uygulama incelemesini ve Tech Provider
                    kurulumunu tamamlayıp sunucuya <code className="font-mono text-[12px] text-fg">META_APP_ID</code>, <code className="font-mono text-[12px] text-fg">META_APP_SECRET</code>,{" "}
                    <code className="font-mono text-[12px] text-fg">WHATSAPP_ES_CONFIG_ID</code> ve <code className="font-mono text-[12px] text-fg">CHANNEL_TOKEN_SECRET</code> değerlerini girmesi
                    gerekiyor.
                  </p>
                </div>
              )}
            </div>
          </Card>

          {isOwner && !connected && setup.manualConnectAllowed && (
            <Card>
              <CardHeader title="Test numarası bağla (geliştirme)" description="Meta uygulama panelindeki WhatsApp › API Kurulumu ekranında yer alan test numarası ve geçici token ile." />
              <div className="p-5">
                <ManualConnectForm />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Test numaraları" description="Ekibin kendi numaraları. Onaylı şablonları kampanyadan önce burada deneyin." />
            <div className="p-5">
              <TestRecipients recipients={testRecipients} />
              <p className="mt-4 text-[12px] leading-relaxed text-muted">
                Meta&apos;nın test numarası kullanılıyorsa, bu numaraların Meta uygulama panelinde de alıcı olarak eklenmiş olması gerekir.
              </p>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="İYS" action={<Badge tone={iys.configured ? "positive" : "caution"}>{iys.configured ? "Bağlı" : "Bağlı değil"}</Badge>} />
            <div className="space-y-2 p-5 text-[13px] leading-relaxed text-muted">
              {iys.configured ? (
                <p>{iys.name} üzerinden her gönderimden hemen önce kişinin MESAJ onayı kontrol edilir; onayı olmayana gönderilmez.</p>
              ) : (
                <>
                  <p className="text-fg">Müşterilere pazarlama mesajı gönderimi kapalı.</p>
                  <p>İYS&apos;ye yetkili entegratör üzerinden bağlanıldığında açılır. O zamana kadar onaylı şablonlar yalnızca test numaralarına gönderilebilir.</p>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Bu ay" description={`${formatDateTime(usage.since)} itibarıyla`} />
            <dl className="divide-y divide-line px-5 py-2">
              <Row label="Meta'ya iletilen">{usage.accepted}</Row>
              <Row label="Teslim edilen">{usage.delivered}</Row>
              <Row label="Başarısız">{usage.failed}</Row>
              <Row label="Meta'nın ücretli bildirdiği">{usage.billable}</Row>
            </dl>
            <p className="px-5 pb-5 text-[12px] leading-relaxed text-muted">Ücret bilgisi Meta&apos;nın durum bildirimlerinden gelir; tutar Meta veya çözüm ortağı faturasındadır.</p>
          </Card>

          <Card>
            <CardHeader title="Bildirim adresi (webhook)" action={<Badge tone={setup.webhookReady ? "positive" : "muted"}>{setup.webhookReady ? "Hazır" : "Yapılandırılmadı"}</Badge>} />
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap gap-2">
                <input readOnly value={setup.webhookUrl} aria-label="Webhook adresi" className="input min-w-0 flex-1 basis-40 font-mono !text-xs" />
                <CopyButton value={setup.webhookUrl} />
              </div>
              <p className="text-[12px] leading-relaxed text-muted">
                Teslim, okundu ve ret bildirimleri bu adrese gelir. Meta&apos;nın erişebilmesi için adres internetten açık olmalı (localhost olmaz).
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
