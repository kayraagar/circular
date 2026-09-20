import type { Metadata } from "next";
import { can } from "@/lib/authz";
import { requirePermission } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { firstParam, type SearchParams } from "@/lib/page";
import { disconnectInstagramAction } from "@/modules/campaigns/channel-actions";
import { getInstagramOverview } from "@/modules/campaigns/instagram-service";
import { CampaignNav } from "@/components/campaigns/campaign-nav";
import { CopyButton } from "@/components/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader, FormAlert, PageHeader } from "@/components/ui/primitives";
import { AutoReplyForm } from "./auto-reply-form";
import { InstagramConnectButton, InstagramManualConnect } from "./instagram-connect";
import { RuleList } from "./rule-list";

export const metadata: Metadata = { title: "Instagram" };

/** Instagram: hesap bağlantısı ve DM'de anahtar kelimeye otomatik yanıt. */
export default async function InstagramChannelPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("campaigns.manage");
  const params = await searchParams;
  const overview = await getInstagramOverview(ctx.service);
  const { account, setup, rules, links, stats } = overview;
  const isOwner = can(ctx.membership.role, "channels.connect");
  const connected = account?.status === "ACTIVE";
  const error = firstParam(params.hata);
  const justConnected = firstParam(params.durum) === "baglandi";

  return (
    <>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title="Kampanyalar"
        description="Instagram'da toplu mesaj gönderilemez; size DM atan kişiye anahtar kelimeye göre otomatik yanıt verilir."
      />
      <CampaignNav active="/campaigns/instagram" />

      {error && (
        <div className="mb-6">
          <FormAlert tone="error">{error === "iptal" ? "Instagram bağlantısı iptal edildi." : error === "eksik" ? "Instagram'dan eksik bilgi döndü; tekrar deneyin." : error}</FormAlert>
        </div>
      )}
      {justConnected && (
        <div className="mb-6">
          <FormAlert tone="success">Instagram hesabı bağlandı.</FormAlert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Otomatik yanıtlar" description={`Son 30 günde ${stats.sent30} yanıt gönderildi${stats.failed30 ? ` · ${stats.failed30} başarısız` : ""}`} />
            <RuleList rules={rules} links={links} />
          </Card>
          <Card>
            <CardHeader title="Yeni otomatik yanıt" description="{menu} menü linkine, {kayit} üyelik sayfası linkine dönüşür." />
            <div className="p-5">
              <AutoReplyForm links={links} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Instagram hesabı"
              action={
                connected ? <Badge tone={account.tokenUsable ? "positive" : "caution"}>{account.tokenUsable ? "Bağlı" : "Yeniden bağlanmalı"}</Badge> : <Badge tone="muted">Bağlı değil</Badge>
              }
            />
            <div className="space-y-4 p-5 text-sm">
              {connected ? (
                <>
                  <p className="font-medium text-fg">@{account.username}</p>
                  <p className="text-[13px] text-muted">
                    Bağlandı {formatDateTime(account.connectedAt)}
                    {account.tokenExpiresAt ? ` · erişim ${formatDate(account.tokenExpiresAt)} tarihine kadar (kullanıldıkça yenilenir)` : ""}
                  </p>
                  {isOwner && (
                    <ConfirmDialog
                      trigger="Bağlantıyı kes"
                      title="Instagram bağlantısını kes"
                      description="Erişim bilgisi silinir ve otomatik yanıtlar durur. Kurallar korunur."
                      confirmLabel="Bağlantıyı kes"
                      action={disconnectInstagramAction}
                      fields={{}}
                    />
                  )}
                </>
              ) : !isOwner ? (
                <p className="text-muted">Instagram hesabını işletme sahibi bağlayabilir.</p>
              ) : setup.oauthReady ? (
                <InstagramConnectButton />
              ) : (
                <p className="text-[13px] leading-relaxed text-muted">
                  Circular&apos;ın Instagram uygulaması henüz yapılandırılmadı. Circular ekibi: Meta uygulamasına &quot;Instagram API (Instagram girişi)&quot; ürününü ekleyip{" "}
                  <code className="font-mono text-[12px] text-fg">INSTAGRAM_APP_ID</code>, <code className="font-mono text-[12px] text-fg">INSTAGRAM_APP_SECRET</code> değerlerini girmeli ve
                  uygulama incelemesinden <code className="font-mono text-[12px] text-fg">instagram_business_manage_messages</code> iznini almalı.
                </p>
              )}
              {isOwner && !connected && setup.manualConnectAllowed && (
                <div className="border-t border-line pt-4">
                  <p className="mb-3 text-[12px] font-medium text-muted">Geliştirme: token ile bağla</p>
                  <InstagramManualConnect />
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Kurallar" />
            <ul className="list-disc space-y-2 py-5 pr-5 pl-9 text-[13px] leading-relaxed text-muted">
              <li>Yalnızca size yazan kişiye, mesajından sonraki 24 saat içinde yanıt verilebilir (Instagram kuralı).</li>
              <li>Aynı mesaja bir kez yanıt verilir; aynı kişiye aynı yanıt 10 dakika içinde tekrar gitmez.</li>
              <li>Uyan kural yoksa mesaj yanıtsız kalır ve Instagram gelen kutunuzda görünür.</li>
              <li>Kişinin Instagram kimliği Circular&apos;da saklanmaz; yalnızca tekrarı önlemek için özeti tutulur.</li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Bildirim adresi (webhook)" action={<Badge tone={setup.webhookReady ? "positive" : "muted"}>{setup.webhookReady ? "Hazır" : "Yapılandırılmadı"}</Badge>} />
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap gap-2">
                <input readOnly value={setup.webhookUrl} aria-label="Instagram webhook adresi" className="input min-w-0 flex-1 basis-40 font-mono !text-xs" />
                <CopyButton value={setup.webhookUrl} />
              </div>
              <p className="text-[12px] leading-relaxed text-muted">Meta uygulamasında Instagram webhook&apos;u olarak ekleyip &quot;messages&quot; alanına abone olun. Adres internetten erişilebilir olmalı.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
