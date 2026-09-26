"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/modules/team/actions";
import { IDLE, fieldError } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";

const MIN_PASSWORD = 10;

/**
 * Daveti kabul etme. Hesabı olmayan kişi kendi şifresini belirler; hesabı olan
 * mevcut şifresiyle katılır (davet bağlantısı tek başına erişim vermez).
 */
export function AcceptInviteForm({ token, hasAccount }: { token: string; hasAccount: boolean }) {
  const [state, action, pending] = useActionState(acceptInviteAction, IDLE);
  const error = fieldError(state, "password") ?? (state.status === "error" && !state.fieldErrors ? state.message : null);

  return (
    <form action={action} className="mt-5 space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {state.status === "error" && !fieldError(state, "password") && state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}

      <div>
        <label htmlFor="accept-password" className="text-[13px] font-medium text-fg">
          {hasAccount ? "Mevcut şifreniz" : "Şifre belirleyin"}
        </label>
        <input
          id="accept-password"
          name="password"
          type="password"
          autoComplete={hasAccount ? "current-password" : "new-password"}
          minLength={hasAccount ? undefined : MIN_PASSWORD}
          maxLength={200}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "accept-password-error" : "accept-password-hint"}
          className="input mt-1.5 !h-12 !text-base"
        />
        {error ? (
          <p id="accept-password-error" role="alert" className="mt-1.5 text-[13px] text-negative">
            {error}
          </p>
        ) : (
          <p id="accept-password-hint" className="mt-1.5 text-[13px] text-muted">
            {hasAccount ? "Bu e-postayla zaten hesabınız var; mevcut şifrenizle katılın." : `En az ${MIN_PASSWORD} karakter.`}
          </p>
        )}
      </div>

      <Button type="submit" variant="primary" className="w-full !h-12" disabled={pending}>
        {pending && <Spinner size={14} />}
        {hasAccount ? "Ekibe katıl" : "Hesabı oluştur ve katıl"}
      </Button>
    </form>
  );
}
