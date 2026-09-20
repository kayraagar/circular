"use client";

import { useActionState, useEffect } from "react";
import { addTestRecipientAction, removeTestRecipientAction } from "@/modules/campaigns/actions";
import { MAX_TEST_RECIPIENTS } from "@/modules/campaigns/rules";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

type Recipient = { id: string; label: string; phoneLabel: string };

/** Ekibin kendi numaraları: İYS bağlanana kadar yalnızca bunlara gönderim yapılabilir. */
export function TestRecipients({ recipients }: { recipients: Recipient[] }) {
  const [state, action] = useActionState(addTestRecipientAction, IDLE);
  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);
  const err = (k: string) => fieldError(state, k);
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const full = recipients.length >= MAX_TEST_RECIPIENTS;

  return (
    <div className="space-y-4">
      {recipients.length > 0 && (
        <ul className="divide-y divide-line rounded-field border border-line">
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-fg">{r.label}</p>
                <p className="text-[12px] text-muted" data-numeric>
                  {r.phoneLabel}
                </p>
              </div>
              <ConfirmDialog
                trigger="Kaldır"
                triggerVariant="ghost"
                title="Test numarasını kaldır"
                description={`${r.label} (${r.phoneLabel}) test listesinden çıkarılır.`}
                confirmLabel="Kaldır"
                action={removeTestRecipientAction}
                fields={{ id: r.id }}
              />
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-[13px] text-muted">En fazla {MAX_TEST_RECIPIENTS} test numarası eklenebilir.</p>
      ) : (
        <form key={state.status === "success" ? state.at : "form"} action={action} className="space-y-3" noValidate>
          {generalError && <FormAlert tone="error">{generalError}</FormAlert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kime ait" htmlFor="test-label" error={err("label")} required>
              <input {...describedBy("test-label", err("label"))} name="label" defaultValue={valueOf(state, "label")} maxLength={60} placeholder="Ör. Selin (müdür)" className="input" />
            </Field>
            <Field label="Telefon" htmlFor="test-phone" error={err("phone")} required>
              <input {...describedBy("test-phone", err("phone"))} name="phone" type="tel" inputMode="tel" defaultValue={valueOf(state, "phone")} placeholder="0532 123 45 67" className="input" />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
            <input type="checkbox" name="confirmed" className="mt-0.5 size-4 shrink-0 accent-white" aria-describedby={err("confirmed") ? "test-confirmed-error" : undefined} />
            Numaranın sahibi ekibimizden ve bu numaraya test mesajı gönderilmesini kabul etti.
          </label>
          {err("confirmed") && (
            <p id="test-confirmed-error" className="text-[13px] text-negative">
              {err("confirmed")}
            </p>
          )}
          <SubmitButton variant="secondary" pendingLabel="Ekleniyor">
            Test numarası ekle
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
