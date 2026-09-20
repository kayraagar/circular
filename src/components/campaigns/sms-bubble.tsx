import { SAMPLE_FIRST_NAME, composeSms, smsSegments } from "@/modules/campaigns/rules";

/** SMS önizlemesi: gönderilecek metin (yasal alt bilgi dahil) ve yaklaşık SMS adedi. */
export function SmsBubble({ body, footer, header, firstName = SAMPLE_FIRST_NAME }: { body: string; footer: string; header?: string | null; firstName?: string }) {
  const empty = !body.trim();
  const text = empty ? "" : composeSms(body, footer, firstName);
  const { segments, unicode, length } = smsSegments(text);
  return (
    <div className="rounded-card border border-line bg-raised p-4" aria-label="SMS önizlemesi">
      <p className="mb-3 text-center text-[11px] tracking-wide text-muted uppercase">{header || "SMS başlığı"}</p>
      <div className="max-w-[300px] rounded-[16px] rounded-bl-[4px] bg-[#2c2c2e] px-3.5 py-2.5 text-[14px] leading-snug text-[#f2f2f7]">
        {empty ? <span className="text-[#8e8e93] italic">SMS metni burada görünür</span> : <span className="break-words whitespace-pre-line">{text}</span>}
      </div>
      {!empty && (
        <p className="mt-2 text-[12px] text-muted" data-numeric>
          {length} karakter · yaklaşık {segments} SMS{unicode ? " (emoji/özel karakter nedeniyle kısa parçalar)" : ""}
        </p>
      )}
    </div>
  );
}
