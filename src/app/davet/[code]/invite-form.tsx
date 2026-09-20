"use client";

import { useActionState, useState } from "react";
import { inviteSignupAction } from "@/modules/guests/invite-actions";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";

const MAX_PARTY = 10;

/** Davet linkinden guest listesine kayıt. Kayıt iletişim izni oluşturmaz. */
export function InviteForm({ code, tenantName }: { code: string; tenantName: string }) {
  const [state, action, pending] = useActionState(inviteSignupAction, IDLE);
  const [party, setParty] = useState(() => {
    const previous = Number(valueOf(state, "partySize", "1"));
    return Number.isInteger(previous) && previous >= 1 && previous <= MAX_PARTY ? previous : 1;
  });
  const err = (k: string) => fieldError(state, k);
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;

  const field = (name: "firstName" | "lastName" | "phone", label: string, extra: Record<string, unknown>) => (
    <div>
      <label htmlFor={`invite-${name}`} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      <input
        id={`invite-${name}`}
        name={name}
        defaultValue={valueOf(state, name)}
        aria-invalid={!!err(name)}
        aria-describedby={err(name) ? `invite-${name}-error` : undefined}
        className="input mt-1.5 !h-12 !text-base"
        {...extra}
      />
      {err(name) && (
        <p id={`invite-${name}-error`} className="mt-1 text-[13px] text-negative">
          {err(name)}
        </p>
      )}
    </div>
  );

  return (
    <form key={state.status === "error" ? state.at : "initial"} action={action} className="relative space-y-4" noValidate>
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="partySize" value={party} />
      {/* Bal küpü: ekran okuyuculardan ve klavyeden gizli; yalnızca otomatik doldurucular doldurur. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Web sitesi
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {generalError && (
        <p role="alert" className="rounded-field border border-negative/30 bg-negative/10 px-3.5 py-3 text-sm text-fg">
          {generalError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", "Ad", { autoComplete: "given-name", maxLength: 80 })}
        {field("lastName", "Soyad", { autoComplete: "family-name", maxLength: 80 })}
      </div>
      {field("phone", "Telefon", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "0532 123 45 67", maxLength: 32 })}

      <div>
        <p id="invite-party-label" className="text-[13px] font-medium text-fg">
          Kaç kişi geleceksiniz?
        </p>
        <div className="mt-1.5 flex items-center justify-between rounded-field border border-line bg-raised px-2 py-1.5" role="group" aria-labelledby="invite-party-label">
          <button
            type="button"
            aria-label="Bir kişi azalt"
            disabled={party <= 1}
            onClick={() => setParty((p) => Math.max(1, p - 1))}
            className="inline-flex size-10 items-center justify-center rounded-full text-xl text-fg disabled:opacity-30"
          >
            −
          </button>
          <output aria-live="polite" className="font-display text-2xl font-medium" data-numeric>
            {party}
          </output>
          <button
            type="button"
            aria-label="Bir kişi artır"
            disabled={party >= MAX_PARTY}
            onClick={() => setParty((p) => Math.min(MAX_PARTY, p + 1))}
            className="inline-flex size-10 items-center justify-center rounded-full text-xl text-fg disabled:opacity-30"
          >
            +
          </button>
        </div>
        <p className="mt-1 text-[12px] text-muted">Siz dahil toplam kişi sayısı.</p>
        {err("partySize") && <p className="mt-1 text-[13px] text-negative">{err("partySize")}</p>}
      </div>

      <p className="text-[12px] leading-relaxed text-muted">
        Bilgileriniz {tenantName} tarafından etkinlik girişiniz için kullanılır. Bu kayıt size kampanya mesajı gönderilmesine izin vermez.
      </p>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="flex h-12 w-full items-center justify-center rounded-field bg-fg text-[15px] font-semibold text-bg transition-opacity disabled:opacity-60"
      >
        {pending ? "Kaydediliyor…" : "Listeye yazıl"}
      </button>
    </form>
  );
}
