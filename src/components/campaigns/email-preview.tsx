import { SAMPLE_FIRST_NAME } from "@/modules/campaigns/rules";
import { renderCampaignEmail, type EmailContent } from "@/modules/campaigns/email-template";

/** E-posta önizlemesi: gönderilecek HTML'in aynısı, yalıtılmış çerçevede (betik çalışmaz). */
export function EmailPreview({ content, senderName, legalFooter, height = 520 }: { content: EmailContent; senderName: string; legalFooter: string; height?: number }) {
  const html = renderCampaignEmail({
    ...content,
    subject: content.subject || "Konu",
    body: content.body || "E-posta metni burada görünür.",
    senderName,
    legalFooter: legalFooter || "Yasal bilgi (unvan, adres, MERSIS) burada görünür.",
    firstName: SAMPLE_FIRST_NAME,
    unsubscribeUrl: "#",
  });
  return (
    <div className="overflow-hidden rounded-card border border-line bg-raised">
      <div className="border-b border-line px-4 py-2.5 text-[12px] text-muted">
        <p className="truncate">
          <span className="text-fg">{senderName}</span> · kampanya adresi
        </p>
        <p className="truncate text-fg">{content.subject || "Konu"}</p>
      </div>
      <iframe title="E-posta önizlemesi" srcDoc={html} sandbox="" className="block w-full bg-white" style={{ height }} />
    </div>
  );
}
