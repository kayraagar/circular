"use client";

import { useActionState } from "react";
import { completePasswordResetAction } from "@/modules/auth/password-actions";
import { IDLE, fieldError } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

const MIN_PASSWORD = 10;

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(completePasswordResetAction, IDLE);
  const passwordError = fieldError(state, "password");
  const repeatError = fieldError(state, "passwordRepeat");

  return (
    <form action={action} className="mt-5 space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {state.status === "error" && !passwordError && !repeatError && <FormAlert tone="error">{state.message}</FormAlert>}

      <Field label="Yeni şifre" htmlFor="new-password" error={passwordError} hint={`En az ${MIN_PASSWORD} karakter.`} required>
        <input
          {...describedBy("new-password", passwordError, true)}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          maxLength={200}
          required
          className="input !h-12 !text-base"
          autoFocus
        />
      </Field>

      <Field label="Yeni şifre (tekrar)" htmlFor="new-password-repeat" error={repeatError} required>
        <input
          {...describedBy("new-password-repeat", repeatError)}
          name="passwordRepeat"
          type="password"
          autoComplete="new-password"
          maxLength={200}
          required
          className="input !h-12 !text-base"
        />
      </Field>

      <SubmitButton className="w-full !h-12" pendingLabel="Kaydediliyor">
        Şifreyi kaydet
      </SubmitButton>
    </form>
  );
}
