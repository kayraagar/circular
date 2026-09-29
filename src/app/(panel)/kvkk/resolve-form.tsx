"use client";

import { useActionState, useState } from "react";
import { resolveDataRequestAction } from "@/modules/privacy/actions";
import { IDLE, fieldError } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

/** Başvuruyu sonuçlandırır. Sonuç metni zorunludur: cevap verildiğinin kaydıdır. */
export function ResolveForm({ requestId, dueAt }: { requestId: string; dueAt: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(resolveDataRequestAction, IDLE);
  const resolutionError = fieldError(state, "resolution");
  const general = state.status === "error" && !state.fieldErrors ? state.message : null;

  if (!open) {
    return (
      <div className="mt-2.5">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Sonuçlandır
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="mt-2.5 space-y-3 rounded-field border border-line bg-raised/40 p-3.5">
      <input type="hidden" name="requestId" value={requestId} />
      {general && <FormAlert tone="error">{general}</FormAlert>}

      <div>
        <label htmlFor={`resolution-${requestId}`} className="text-[13px] font-medium text-fg">
          Başvurana ne cevap verildi?
        </label>
        <textarea
          id={`resolution-${requestId}`}
          name="resolution"
          rows={3}
          maxLength={2000}
          required
          aria-invalid={resolutionError ? true : undefined}
          className="input mt-1.5 !h-auto py-2"
          placeholder="Örn: Kayıt anonimleştirildi ve kişiye 12.10.2026 tarihinde e-postayla bildirildi."
        />
        {resolutionError && (
          <p role="alert" className="mt-1.5 text-[13px] text-negative">
            {resolutionError}
          </p>
        )}
        <p className="mt-1.5 text-[12px] text-muted">
          Son cevap tarihi: {new Date(dueAt).toLocaleDateString("tr-TR")}. Bu metin denetimde kanıt olarak kullanılır.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="primary" size="sm" name="status" value="DONE" pendingLabel="Kaydediliyor">
          Cevaplandı olarak kapat
        </SubmitButton>
        <SubmitButton variant="secondary" size="sm" name="status" value="REJECTED" pendingLabel="Kaydediliyor">
          Reddedildi olarak kapat
        </SubmitButton>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}
