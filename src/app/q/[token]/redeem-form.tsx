"use client";

import { useActionState, useState } from "react";
import { redeemPassAction } from "@/modules/passes/actions";
import { IDLE, fieldError } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

const stepper =
  "inline-flex size-12 items-center justify-center rounded-full border border-line text-2xl text-fg transition-colors hover:border-line-strong disabled:opacity-30";

/** Doğrulama onayı. Sayfayı açmak hiçbir şey kaydetmez; kayıt yalnızca bu form gönderilince yapılır. */
export function RedeemForm({
  token,
  purpose,
  partySize = 1,
}: {
  token: string;
  purpose: "EVENT_ENTRY" | "PERK_REDEMPTION";
  partySize?: number;
}) {
  const [state, action] = useActionState(redeemPassAction, IDLE);
  const [count, setCount] = useState(partySize);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const entry = purpose === "EVENT_ENTRY";

  if (state.status === "success" && state.at !== dismissedAt) {
    return (
      <div role="status" className="card border-positive/40 p-5 text-center animate-enter">
        <p className="font-display text-xl font-medium text-positive">{state.message}</p>
        {!entry && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setDismissedAt(state.at)}>
            Bir kullanım daha onayla
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="admittedCount" value={entry ? String(count) : ""} />
      {state.status === "error" && <FormAlert tone="error">{fieldError(state, "admittedCount") ?? state.message}</FormAlert>}

      {entry && partySize > 1 && (
        <div className="card p-4">
          <p id="admitted-label" className="text-center text-sm text-muted">
            Giriş yapan kişi
          </p>
          <div className="mt-3 flex items-center justify-between" role="group" aria-labelledby="admitted-label">
            <button type="button" className={stepper} aria-label="Bir kişi azalt" disabled={count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))}>
              −
            </button>
            <output aria-live="polite" className="font-display text-5xl leading-none font-medium" data-numeric>
              {count}
            </output>
            <button
              type="button"
              className={stepper}
              aria-label="Bir kişi artır"
              disabled={count >= partySize}
              onClick={() => setCount((c) => Math.min(partySize, c + 1))}
            >
              +
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-muted">Kayıtlı: {partySize} kişi</p>
        </div>
      )}

      <SubmitButton className="!h-14 w-full !text-base" pendingLabel="Onaylanıyor">
        {entry ? "Girişi onayla" : "Avantajı kullan"}
      </SubmitButton>
    </form>
  );
}
