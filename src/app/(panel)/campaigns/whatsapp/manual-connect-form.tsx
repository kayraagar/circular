"use client";

import { useActionState, useEffect } from "react";
import { connectManualAction } from "@/modules/campaigns/actions";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

/** Geliştirme ortamı: Meta uygulama panelindeki test numarasını kimlikleri ve geçici token ile bağlar. */
export function ManualConnectForm() {
  const [state, action] = useActionState(connectManualAction, IDLE);
  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);
  const err = (k: string) => fieldError(state, k);
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;

  return (
    <form key={state.status === "success" ? state.at : "form"} action={action} className="space-y-4" noValidate>
      {generalError && <FormAlert tone="error">{generalError}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="WhatsApp Business hesap kimliği (WABA ID)" htmlFor="wabaId" error={err("wabaId")} required>
          <input {...describedBy("wabaId", err("wabaId"))} name="wabaId" defaultValue={valueOf(state, "wabaId")} inputMode="numeric" autoComplete="off" className="input font-mono" />
        </Field>
        <Field label="Telefon numarası kimliği" htmlFor="phoneNumberId" error={err("phoneNumberId")} required>
          <input {...describedBy("phoneNumberId", err("phoneNumberId"))} name="phoneNumberId" defaultValue={valueOf(state, "phoneNumberId")} inputMode="numeric" autoComplete="off" className="input font-mono" />
        </Field>
      </div>
      <Field label="Erişim token'ı" htmlFor="accessToken" error={err("accessToken")} required hint="Şifreli saklanır; bir daha görüntülenmez.">
        <input {...describedBy("accessToken", err("accessToken"), true)} name="accessToken" type="password" autoComplete="off" className="input font-mono" />
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Meta'dan doğrulanıyor">
        Test numarasını bağla
      </SubmitButton>
    </form>
  );
}
