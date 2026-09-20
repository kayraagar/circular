import { renderTemplateText } from "./rules";

/**
 * Kampanya e-postasının HTML'i. Sunucu gönderimde, arayüz önizlemede aynı işlevi kullanır.
 * Tablo tabanlı, satır içi stilli basit düzen (e-posta istemcileri harici CSS desteklemez).
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type EmailContent = { subject: string; body: string; ctaLabel?: string | null; ctaUrl?: string | null };

export function renderCampaignEmail(input: EmailContent & { senderName: string; legalFooter: string; firstName: string; unsubscribeUrl: string; test?: boolean }): string {
  const paragraphs = renderTemplateText(input.body, input.firstName)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f1f1f">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const cta =
    input.ctaLabel && input.ctaUrl
      ? `<p style="margin:24px 0 8px"><a href="${esc(input.ctaUrl)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px">${esc(input.ctaLabel)}</a></p>`
      : "";
  const testBanner = input.test
    ? `<tr><td style="padding:10px 28px;background:#fff4d6;font-size:12px;color:#6b5200;font-family:Arial,sans-serif">Bu bir test e-postasıdır.</td></tr>`
    : "";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f3f1">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
${testBanner}
<tr><td style="padding:24px 28px 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6f6f6f">${esc(input.senderName)}</td></tr>
<tr><td style="padding:8px 28px 12px">${paragraphs}${cta}</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #ececec;font-size:12px;line-height:1.6;color:#8a8a8a">
${esc(input.legalFooter)}<br>
Bu e-postayı ${esc(input.senderName)} ile iletişim izniniz olduğu için aldınız. <a href="${esc(input.unsubscribeUrl)}" style="color:#8a8a8a">Abonelikten çık</a>
</td></tr>
</table></td></tr></table></body></html>`;
}
