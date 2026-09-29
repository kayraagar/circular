"use client";

import { useActionState } from "react";
import { requestPasswordResetAction } from "@/modules/auth/password-actions";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

/** Talep formu. Başarılı cevapta form gizlenir; mesaj hesabın varlığını belli etmez. */
export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, IDLE);
  const emailError = fieldError(state, "email");

  if (state.status === "success") {
    return (
      <div className="mt-5">
        <FormAlert tone="success">{state.message}</FormAlert>
      </div>
    );
  }

  return (
    <form action={action} className="mt-5 space-y-4" noValidate>
      {state.status === "error" && !emailError && <FormAlert tone="error">{state.message}</FormAlert>}
      <Field label="E-posta" htmlFor="forgot-email" error={emailError} required>
        <input
          {...describedBy("forgot-email", emailError)}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          maxLength={254}
          defaultValue={valueOf(state, "email")}
          className="input !h-12 !text-base"
          autoFocus
        />
      </Field>
      <SubmitButton className="w-full !h-12" pendingLabel="Gönderiliyor">
        Sıfırlama bağlantısı gönder
      </SubmitButton>
    </form>
  );
}
