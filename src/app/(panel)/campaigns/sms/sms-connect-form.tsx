"use client";

import { useActionState, useEffect } from "react";
import { connectSmsAction } from "@/modules/campaigns/channel-actions";
import { SMS_LIMITS } from "@/modules/campaigns/rules";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

type Current = { username: string; msgheader: string; legalFooter: string } | null;

/** Netgsm hesabı: kullanıcı adı, API şifresi, onaylı başlık ve ticari SMS'e eklenecek yasal bilgi. */
export function SmsConnectForm({ current }: { current: Current }) {
  const [state, action] = useActionState(connectSmsAction, IDLE);
  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);
  const err = (k: string) => fieldError(state, k);
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const value = (k: keyof NonNullable<Current>) => valueOf(state, k, current?.[k] ?? "");

  return (
    <form key={state.status === "success" ? state.at : "form"} action={action} className="space-y-4" noValidate>
      {generalError && <FormAlert tone="error">{generalError}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Netgsm kullanıcı adı (abone no)" htmlFor="sms-username" error={err("username")} required>
          <input {...describedBy("sms-username", err("username"))} name="username" defaultValue={value("username")} autoComplete="off" inputMode="numeric" className="input font-mono" />
        </Field>
        <Field
          label="API alt kullanıcı şifresi"
          htmlFor="sms-password"
          error={err("password")}
          required={!current}
          showOptional={false}
          hint={current ? "Değiştirmeyecekseniz boş bırakın." : "Şifreli saklanır; bir daha görüntülenmez."}
        >
          <input {...describedBy("sms-password", err("password"), true)} name="password" type="password" autoComplete="off" className="input font-mono" />
        </Field>
      </div>
      <Field label="Onaylı SMS başlığı" htmlFor="sms-msgheader" error={err("msgheader")} required hint="Netgsm hesabınızda onaylanmış başlık (en fazla 11 karakter).">
        <input {...describedBy("sms-msgheader", err("msgheader"), true)} name="msgheader" defaultValue={value("msgheader")} maxLength={SMS_LIMITS.header} autoComplete="off" className="input font-mono uppercase" />
      </Field>
      <Field
        label="Yasal bilgi (her SMS'in sonuna eklenir)"
        htmlFor="sms-legalFooter"
        error={err("legalFooter")}
        required
        hint="Ticari SMS'te zorunlu: unvan ve MERSIS numarası ile Netgsm'in verdiği 0800'lü ret bilgisi."
      >
        <textarea
          {...describedBy("sms-legalFooter", err("legalFooter"), true)}
          name="legalFooter"
          rows={2}
          maxLength={SMS_LIMITS.footer}
          defaultValue={value("legalFooter")}
          placeholder="Orbita Ltd. MERSIS: 0123456789012345 · SMS almamak için: 0800 ..."
          className="input"
        />
      </Field>
      <SubmitButton pendingLabel="Netgsm'den doğrulanıyor">{current ? "Kaydet" : "Netgsm hesabını bağla"}</SubmitButton>
    </form>
  );
}
