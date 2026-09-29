"use client";

import { useActionState, useState } from "react";
import { confirmMemberCodeAction, requestMemberCodeAction } from "@/modules/member/actions";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Şifresiz giriş: önce telefon/e-posta, sonra tek kullanımlık kod.
 * Cevap hiçbir adımda kaydın var olup olmadığını belli etmez.
 */
export function MemberLogin({ slug }: { slug: string }) {
  const [requestState, requestAction] = useActionState(requestMemberCodeAction, IDLE);
  const [codeState, codeAction] = useActionState(confirmMemberCodeAction, IDLE);
  const [identifier, setIdentifier] = useState("");
  const sent = requestState.status === "success";
  const deliverable = sent && (requestState.data as { deliverable?: boolean } | undefined)?.deliverable !== false;

  return (
    <div className="mt-5 space-y-4">
      <form action={requestAction} className="space-y-4" noValidate>
        <input type="hidden" name="slug" value={slug} />
        {requestState.status === "error" && !requestState.fieldErrors && <FormAlert tone="error">{requestState.message}</FormAlert>}
        {sent && <FormAlert tone={deliverable ? "success" : "info"}>{requestState.message}</FormAlert>}

        <Field label="Telefon veya e-posta" htmlFor="member-identifier" required showOptional={false} error={fieldError(requestState, "identifier")}>
          <input
            {...describedBy("member-identifier", fieldError(requestState, "identifier"))}
            name="identifier"
            autoComplete="username"
            maxLength={254}
            defaultValue={valueOf(requestState, "identifier")}
            onChange={(e) => setIdentifier(e.target.value)}
            className="input !h-12 !text-base"
          />
        </Field>
        <SubmitButton variant={sent ? "secondary" : "primary"} className="w-full !h-12" pendingLabel="Gönderiliyor">
          {sent ? "Yeni kod gönder" : "Giriş kodu gönder"}
        </SubmitButton>
      </form>

      {sent && deliverable && (
        <form action={codeAction} className="space-y-3 border-t border-line pt-4" noValidate>
          <input type="hidden" name="slug" value={slug} />
          <input
            type="hidden"
            name="identifier"
            value={identifier || (typeof requestState.data === "object" && requestState.data !== null ? ((requestState.data as { identifier?: string }).identifier ?? "") : "")}
          />
          {codeState.status === "error" && <FormAlert tone="error">{codeState.message}</FormAlert>}
          <div>
            <label htmlFor="member-code" className="text-[13px] font-medium text-fg">
              Gelen kod
            </label>
            <input
              id="member-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              className="input mt-1.5 !h-12 text-center !text-[18px] tracking-[0.3em]"
            />
          </div>
          <SubmitButton variant="primary" className="w-full !h-12" pendingLabel="Giriş yapılıyor">
            Giriş yap
          </SubmitButton>
          <p className="text-[12px] leading-relaxed text-muted">Kod 10 dakika geçerlidir ve bir kez kullanılır.</p>
        </form>
      )}

      {sent && !deliverable && (
        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
          Baştan dene
        </Button>
      )}
    </div>
  );
}
