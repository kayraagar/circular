import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { formatDateTime } from "@/lib/datetime";
import { getWhatsAppAccount } from "@/modules/campaigns/accounts";
import { refreshTemplateAction } from "@/modules/campaigns/actions";
import { TEMPLATE_STATUS_LABELS, type TemplateStatus } from "@/modules/campaigns/rules";
import { listTemplates } from "@/modules/campaigns/templates";
import { CampaignNav } from "@/components/campaigns/campaign-nav";
import { WhatsAppBubble } from "@/components/campaigns/whatsapp-bubble";
import { ActionButton } from "@/components/campaigns/action-button";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = { title: "WhatsApp şablonları" };

const TONE: Record<TemplateStatus, "positive" | "caution" | "negative" | "muted"> = {
  APPROVED: "positive",
  PENDING: "caution",
  REJECTED: "negative",
  PAUSED: "caution",
  DISABLED: "muted",
};

export default async function CampaignTemplatesPage() {
  const ctx = await requirePermission("campaigns.manage");
  const [templates, account] = await Promise.all([listTemplates(ctx.service), getWhatsAppAccount(ctx.service)]);
  const connected = account?.status === "ACTIVE" && account.tokenUsable;

  return (
    <>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title="Kampanyalar"
        description="WhatsApp'ta işletmenin başlattığı mesajlar yalnızca Meta'nın onayladığı şablonlarla gönderilebilir."
      />
      <CampaignNav active="/campaigns/templates" />

      <Card>
        <CardHeader title="Yeni şablon" description="Kampanya mesajınızı yazın; Meta onayından sonra kampanyalarda kullanılabilir." />
        <TemplateForm canSubmit={Boolean(connected)} businessName={account?.verifiedName ?? ctx.tenant.name} />
      </Card>

      <Card className="mt-6">
        <CardHeader title="Şablonlar" description={`${templates.length} şablon`} />
        {templates.length === 0 ? (
          <EmptyState compact title="Henüz şablon yok" description="Yukarıdaki formla ilk şablonunuzu Meta onayına gönderin." />
        ) : (
          <ul className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-col gap-3 rounded-card border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-mono text-[13px] text-fg">{t.name}</p>
                  <Badge tone={TONE[t.status]}>{TEMPLATE_STATUS_LABELS[t.status]}</Badge>
                </div>
                <WhatsAppBubble template={t} />
                {t.rejectionReason && <p className="text-[13px] text-negative">Meta&apos;nın gerekçesi: {t.rejectionReason}</p>}
                {t.otherAccount && <p className="text-[13px] text-caution">Önceden bağlı başka bir WhatsApp hesabında oluşturuldu; bu numarayla kullanılamaz.</p>}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
                  <span>Gönderildi {formatDateTime(t.submittedAt)}</span>
                  {!t.otherAccount && connected && t.status !== "APPROVED" && (
                    <ActionButton action={refreshTemplateAction} fields={{ id: t.id }} pendingLabel="Soruluyor">
                      Durumu yenile
                    </ActionButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
