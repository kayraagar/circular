"use client";

import { useActionState, useEffect } from "react";
import { addEmailTestRecipientAction, removeEmailTestRecipientAction } from "@/modules/campaigns/channel-actions";
import { MAX_TEST_RECIPIENTS } from "@/modules/campaigns/rules";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

/** Ekibin kendi e-posta adresleri: kampanyayı göndermeden önce deneme. */
export function EmailTestRecipients({ recipients }: { recipients: { id: string; email: string; label: string }[] }) {
  const [state, action] = useActionState(addEmailTestRecipientAction, IDLE);
  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);
  const err = (k: string) => fieldError(state, k);
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;

  return (
    <div className="space-y-4">
      {recipients.length > 0 && (
        <ul className="divide-y divide-line rounded-field border border-line">
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-fg">{r.label}</p>
                <p className="truncate text-[12px] text-muted">{r.email}</p>
              </div>
              <ConfirmDialog
                trigger="Kaldır"
                triggerVariant="ghost"
                title="Test adresini kaldır"
                description={`${r.label} (${r.email}) test listesinden çıkarılır.`}
                confirmLabel="Kaldır"
                action={removeEmailTestRecipientAction}
                fields={{ id: r.id }}
              />
            </li>
          ))}
        </ul>
      )}
      {recipients.length >= MAX_TEST_RECIPIENTS ? (
        <p className="text-[13px] text-muted">En fazla {MAX_TEST_RECIPIENTS} test adresi eklenebilir.</p>
      ) : (
        <form key={state.status === "success" ? state.at : "form"} action={action} className="space-y-3" noValidate>
          {generalError && <FormAlert tone="error">{generalError}</FormAlert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kime ait" htmlFor="etest-label" error={err("label")} required>
              <input {...describedBy("etest-label", err("label"))} name="label" defaultValue={valueOf(state, "label")} maxLength={60} placeholder="Ör. Selin (müdür)" className="input" />
            </Field>
            <Field label="E-posta" htmlFor="etest-email" error={err("email")} required>
              <input {...describedBy("etest-email", err("email"))} name="email" type="email" defaultValue={valueOf(state, "email")} className="input" />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
            <input type="checkbox" name="confirmed" className="mt-0.5 size-4 shrink-0 accent-white" />
            Adresin sahibi ekibimizden ve bu adrese test e-postası gönderilmesini kabul etti.
          </label>
          {err("confirmed") && <p className="text-[13px] text-negative">{err("confirmed")}</p>}
          <SubmitButton variant="secondary" pendingLabel="Ekleniyor">
            Test adresi ekle
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
