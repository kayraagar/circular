"use client";

import { useActionState, useEffect, useState } from "react";
import { saveEmailSettingsAction } from "@/modules/campaigns/channel-actions";
import { EMAIL_LIMITS } from "@/modules/campaigns/rules";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { EmailPreview } from "@/components/campaigns/email-preview";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

type Settings = { senderName: string; replyTo: string | null; legalFooter: string } | null;

/** Gönderici ayarları: görünen ad, yanıt adresi ve ticari e-postada zorunlu tanıtıcı bilgi; önizlemeyle. */
export function EmailSettingsForm({ current, defaultName, canEdit }: { current: Settings; defaultName: string; canEdit: boolean }) {
  const [state, action] = useActionState(saveEmailSettingsAction, IDLE);
  const [draft, setDraft] = useState({
    senderName: valueOf(state, "senderName", current?.senderName ?? defaultName),
    replyTo: valueOf(state, "replyTo", current?.replyTo ?? ""),
    legalFooter: valueOf(state, "legalFooter", current?.legalFooter ?? ""),
  });
  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);
  const err = (k: string) => fieldError(state, k);
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const bind = (k: keyof typeof draft, extra: Record<string, unknown> = {}, hint = false) => ({
    ...describedBy(`email-${k}`, err(k), hint),
    name: k,
    value: draft[k],
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value })),
    readOnly: !canEdit,
    className: "input",
    ...extra,
  });

  return (
    <form action={action} className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]" noValidate>
      <div className="space-y-4">
        {generalError && <FormAlert tone="error">{generalError}</FormAlert>}
        <Field label="Görünen gönderici adı" htmlFor="email-senderName" error={err("senderName")} required hint="Alıcının gelen kutusunda görünen ad.">
          <input {...bind("senderName", { maxLength: EMAIL_LIMITS.senderName }, true)} />
        </Field>
        <Field label="Yanıt adresi" htmlFor="email-replyTo" error={err("replyTo")} hint="Müşteri e-postayı yanıtlarsa bu adrese gider.">
          <input {...bind("replyTo", { type: "email", autoComplete: "email", placeholder: "info@isletmeniz.com" }, true)} />
        </Field>
        <Field
          label="Yasal bilgi (e-postanın altına eklenir)"
          htmlFor="email-legalFooter"
          error={err("legalFooter")}
          required
          hint="Ticari e-postada zorunlu tanıtıcı bilgi: unvan, adres, iletişim ve varsa MERSIS numarası."
        >
          <textarea {...bind("legalFooter", { rows: 3, maxLength: EMAIL_LIMITS.footer, placeholder: "Orbita Ltd. · Moda Cad. No:1 Kadıköy/İstanbul · MERSIS 0123456789012345" }, true)} />
        </Field>
        {canEdit ? <SubmitButton pendingLabel="Kaydediliyor">Kaydet</SubmitButton> : <p className="text-[13px] text-muted">Bu ayarları işletme sahibi değiştirebilir.</p>}
      </div>
      <div className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-2 text-[13px] font-medium text-muted">Önizleme</p>
        <EmailPreview
          content={{ subject: "Bu cuma bizdesiniz", body: "Merhaba {{ad}},\n\nBu cuma DJ gecesinde sizi bekliyoruz.", ctaLabel: "Listeye yazıl", ctaUrl: "https://ornek.com" }}
          senderName={draft.senderName || defaultName}
          legalFooter={draft.legalFooter}
          height={420}
        />
      </div>
    </form>
  );
}
