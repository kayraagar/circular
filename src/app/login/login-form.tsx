"use client";

import { useActionState, useRef } from "react";
import { loginAction } from "@/modules/auth/actions";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function LoginForm({ next, demoAccounts }: { next: string; demoAccounts: { email: string; label: string }[] }) {
  const [state, action] = useActionState(loginAction, IDLE);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailError = fieldError(state, "email");
  const passwordError = fieldError(state, "password");

  return (
    <>
      <form action={action} className="space-y-5" noValidate>
        <input type="hidden" name="next" value={next} />
        {state.status === "error" && !emailError && !passwordError && <FormAlert tone="error">{state.message}</FormAlert>}
        <Field label="E-posta" htmlFor="email" error={emailError} required>
          <input
            ref={emailRef}
            {...describedBy("email", emailError)}
            key={state.status === "error" ? state.at : "initial"}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            defaultValue={valueOf(state, "email")}
            className="input"
            autoFocus
          />
        </Field>
        <Field label="Şifre" htmlFor="password" error={passwordError} required>
          <input
            ref={passwordRef}
            {...describedBy("password", passwordError)}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
          />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Giriş yapılıyor">
          Giriş yap
        </SubmitButton>
      </form>

      {demoAccounts.length > 0 && (
        <div className="mt-10 border-t border-line pt-6">
          <p className="eyebrow">Demo hesapları</p>
          <p className="mt-1.5 text-xs text-muted">Şifre: .env içindeki SEED_DEMO_PASSWORD. Tüm veriler kurgusaldır.</p>
          <ul className="mt-3 space-y-1">
            {demoAccounts.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  onClick={() => {
                    if (emailRef.current) emailRef.current.value = a.email;
                    passwordRef.current?.focus();
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-raised"
                >
                  <span className="truncate font-mono text-fg">{a.email}</span>
                  <span className="shrink-0 text-xs text-muted">{a.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
