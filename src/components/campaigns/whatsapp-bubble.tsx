import { SAMPLE_FIRST_NAME, renderTemplateText } from "@/modules/campaigns/rules";

export type BubbleTemplate = {
  headerText: string | null;
  bodyText: string;
  footerText: string;
  optOutLabel: string;
};

/**
 * Şablon önizlemesi: kişinin telefonunda mesajın yaklaşık görünümü.
 * {{ad}} yerine örnek ad yazılır; gerçek görünüm cihaza göre değişebilir.
 */
export function WhatsAppBubble({ template, firstName = SAMPLE_FIRST_NAME, businessName }: { template: BubbleTemplate; firstName?: string; businessName?: string }) {
  const empty = !template.bodyText.trim();
  return (
    <div className="rounded-card border border-line bg-[#0b141a] p-4" aria-label="Mesaj önizlemesi">
      {businessName && <p className="mb-3 text-center text-[11px] text-[#8696a0]">{businessName}</p>}
      <div className="max-w-[300px]">
        <div className="rounded-[10px] rounded-tl-[3px] bg-[#1f2c34] px-3 pt-2 pb-1.5 text-[14px] leading-snug text-[#e9edef] shadow-sm">
          {template.headerText && <p className="mb-1 font-semibold break-words">{template.headerText}</p>}
          <p className={`break-words whitespace-pre-line ${empty ? "text-[#8696a0] italic" : ""}`}>
            {empty ? "Mesaj metni burada görünür" : renderTemplateText(template.bodyText, firstName)}
          </p>
          {template.footerText && <p className="mt-1.5 text-[12px] break-words text-[#8696a0]">{template.footerText}</p>}
          <p className="mt-0.5 text-right text-[10px] text-[#8696a0]" aria-hidden>
            21:30
          </p>
        </div>
        {template.optOutLabel && (
          <div className="mt-0.5 rounded-[10px] bg-[#1f2c34] py-2 text-center text-[14px] text-[#53bdeb]">{template.optOutLabel}</div>
        )}
      </div>
    </div>
  );
}
