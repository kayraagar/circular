"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createTemplateAction } from "@/modules/campaigns/actions";
import { DEFAULT_FOOTER, DEFAULT_OPT_OUT_LABEL, TEMPLATE_LIMITS, templateNameFrom } from "@/modules/campaigns/rules";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { WhatsAppBubble } from "@/components/campaigns/whatsapp-bubble";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

/** Pazarlama şablonu: metin, ret bilgisi ve "Abonelikten çık" düğmesi; yazdıkça önizleme güncellenir. */
export function TemplateForm({ canSubmit, businessName }: { canSubmit: boolean; businessName: string }) {
  const [state, action] = useActionState(createTemplateAction, IDLE);
  const [draft, setDraft] = useState({
    name: valueOf(state, "name"),
    headerText: valueOf(state, "headerText"),
    bodyText: valueOf(state, "bodyText"),
    footerText: valueOf(state, "footerText", DEFAULT_FOOTER),
    optOutLabel: valueOf(state, "optOutLabel", DEFAULT_OPT_OUT_LABEL),
  });
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message);
      setDraft({ name: "", headerText: "", bodyText: "", footerText: DEFAULT_FOOTER, optOutLabel: DEFAULT_OPT_OUT_LABEL });
    }
  }, [state]);

  const err = (k: string) => fieldError(state, k);
  const bind = (k: keyof typeof draft, extra: Record<string, unknown> = {}, hint = false) => ({
    ...describedBy(`tpl-${k}`, err(k), hint),
    name: k,
    value: draft[k],
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value })),
    className: "input",
    ...extra,
  });
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const slug = templateNameFrom(draft.name);

  const insertName = () => {
    const el = bodyRef.current;
    const token = "{{ad}}";
    const start = el?.selectionStart ?? draft.bodyText.length;
    const end = el?.selectionEnd ?? start;
    const next = draft.bodyText.slice(0, start) + token + draft.bodyText.slice(end);
    setDraft((d) => ({ ...d, bodyText: next.slice(0, TEMPLATE_LIMITS.body) }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <form action={action} className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_300px]" noValidate>
      <div className="space-y-4">
        {generalError && <FormAlert tone="error">{generalError}</FormAlert>}
        <Field label="Şablon adı" htmlFor="tpl-name" error={err("name")} required hint={slug ? `Meta'daki adı: ${slug}` : "Yalnızca sizin göreceğiniz ad."}>
          <input {...bind("name", { maxLength: 80, autoComplete: "off", placeholder: "Ör. Cuma daveti" }, true)} />
        </Field>
        <Field label="Başlık" htmlFor="tpl-headerText" error={err("headerText")} hint={`${draft.headerText.length}/${TEMPLATE_LIMITS.header}`}>
          <input {...bind("headerText", { maxLength: TEMPLATE_LIMITS.header, autoComplete: "off", placeholder: "Ör. Bu Cuma Orbita'da" }, true)} />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="tpl-bodyText" className="text-[13px] font-medium text-fg">
              Mesaj <span className="text-muted" aria-hidden>*</span>
            </label>
            <Button size="sm" variant="ghost" onClick={insertName} className="!h-7">
              + Müşterinin adı
            </Button>
          </div>
          <textarea
            ref={bodyRef}
            {...bind("bodyText", { rows: 6, maxLength: TEMPLATE_LIMITS.body, placeholder: "Merhaba {{ad}}, bu cuma DJ performansıyla seni bekliyoruz. Listeye yazılmak için bu mesaja yanıt ver." }, true)}
          />
          {err("bodyText") ? (
            <p id="tpl-bodyText-error" className="mt-1.5 text-[13px] text-negative">
              {err("bodyText")}
            </p>
          ) : (
            <p id="tpl-bodyText-hint" className="mt-1.5 text-[13px] text-muted">
              {draft.bodyText.length}/{TEMPLATE_LIMITS.body} · {"{{ad}}"} gönderimde müşterinin adıyla değişir; mesaj adla başlayamaz veya bitemez.
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ret bilgisi (alt metin)" htmlFor="tpl-footerText" error={err("footerText")} required hint="Pazarlama mesajında zorunlu.">
            <input {...bind("footerText", { maxLength: TEMPLATE_LIMITS.footer }, true)} />
          </Field>
          <Field label="Abonelikten çıkma düğmesi" htmlFor="tpl-optOutLabel" error={err("optOutLabel")} required hint="Basan kişinin WhatsApp izni kaldırılır.">
            <input {...bind("optOutLabel", { maxLength: TEMPLATE_LIMITS.button }, true)} />
          </Field>
        </div>
        <SubmitButton className="w-full sm:w-auto" pendingLabel="Meta'ya gönderiliyor">
          Meta onayına gönder
        </SubmitButton>
        {!canSubmit && <p className="text-[13px] text-caution">Şablonu gönderebilmek için önce WhatsApp numarasını bağlayın.</p>}
        <p className="text-[12px] leading-relaxed text-muted">
          Şablon işletmenin WhatsApp hesabında pazarlama kategorisinde oluşturulur. Meta genellikle kısa sürede yanıt verir; reddedilirse nedeni burada görünür.
        </p>
      </div>
      <div className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-2 text-[13px] font-medium text-muted">Önizleme</p>
        <WhatsAppBubble template={draft} businessName={businessName} />
      </div>
    </form>
  );
}
