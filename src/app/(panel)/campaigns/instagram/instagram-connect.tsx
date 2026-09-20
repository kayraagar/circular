"use client";

import { useActionState, useEffect } from "react";
import { connectInstagramManualAction, startInstagramConnectAction } from "@/modules/campaigns/channel-actions";
import { IDLE, fieldError } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

/** Instagram girişine yönlendirir (Meta penceresinde işletme hesabı seçilir ve izin verilir). */
export function InstagramConnectButton() {
  const [state, action] = useActionState(startInstagramConnectAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      {state.status === "error" && <FormAlert tone="error">{state.message}</FormAlert>}
      <SubmitButton pendingLabel="Instagram'a yönlendiriliyor">Instagram hesabını bağla</SubmitButton>
      <p className="text-[12px] leading-relaxed text-muted">Instagram hesabının işletme veya içerik üreticisi (profesyonel) hesap olması gerekir.</p>
    </form>
  );
}

/** Geliştirme: uygulama panelinden üretilen token ile bağlama. */
export function InstagramManualConnect() {
  const [state, action] = useActionState(connectInstagramManualAction, IDLE);
  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);
  const err = fieldError(state, "accessToken");
  return (
    <form action={action} className="space-y-3" noValidate>
      {state.status === "error" && !state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}
      <Field label="Instagram erişim token'ı" htmlFor="ig-token" error={err} required hint="Meta uygulama paneli › Instagram › API kurulumu › Token oluştur. Şifreli saklanır.">
        <input {...describedBy("ig-token", err, true)} name="accessToken" type="password" autoComplete="off" className="input font-mono" />
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Instagram'dan doğrulanıyor">
        Token ile bağla
      </SubmitButton>
    </form>
  );
}
