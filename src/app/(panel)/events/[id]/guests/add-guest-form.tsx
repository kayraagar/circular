"use client";

import { useActionState, useEffect, useState } from "react";
import { addGuestToEventAction } from "@/modules/guests/actions";
import { GUEST_SOURCES, GUEST_SOURCE_LABELS, type GuestSource } from "@/modules/guests/status";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { MAX_PARTY_SIZE, isOneOf } from "@/lib/domain";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

/**
 * Misafir ekleme. PR için kaynak her zaman "PR" ve kendisidir; yönetim kaynağı ve PR'ı seçer.
 * Aynı telefonla aynı etkinliğe ikinci kayıt sunucuda engellenir.
 */
export function AddGuestForm({
  eventId,
  promoterMode,
  promoters,
}: {
  eventId: string;
  promoterMode: boolean;
  promoters: { membershipId: string; name: string }[];
}) {
  const [state, action] = useActionState(addGuestToEventAction, IDLE);
  const previousSource = valueOf(state, "source");
  const [source, setSource] = useState<GuestSource>(isOneOf(GUEST_SOURCES, previousSource) ? previousSource : "ORGANIC");
  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);

  const err = (k: string) => fieldError(state, k);
  const input = (k: string, extra: Record<string, unknown> = {}, hint = false) => ({
    ...describedBy(k, err(k), hint),
    name: k,
    defaultValue: valueOf(state, k, k === "partySize" ? "1" : ""),
    className: "input",
    ...extra,
  });
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;

  return (
    <form key={state.status === "idle" ? "initial" : state.at} action={action} className="space-y-4 p-5" noValidate>
      <input type="hidden" name="eventId" value={eventId} />
      {generalError && <FormAlert tone="error">{generalError}</FormAlert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Field label="Ad" htmlFor="firstName" error={err("firstName")} required>
          <input {...input("firstName", { autoComplete: "off", maxLength: 80 })} />
        </Field>
        <Field label="Soyad" htmlFor="lastName" error={err("lastName")} required>
          <input {...input("lastName", { autoComplete: "off", maxLength: 80 })} />
        </Field>
      </div>
      <Field label="Telefon" htmlFor="phone" error={err("phone")} required hint="Aynı numarayla bu etkinliğe ikinci kayıt eklenemez.">
        <input {...input("phone", { type: "tel", inputMode: "tel", autoComplete: "off", placeholder: "0532 123 45 67", maxLength: 32 }, true)} />
      </Field>
      <Field label="Kişi sayısı" htmlFor="partySize" error={err("partySize")} required hint="Misafirin kendisi dahil.">
        <input {...input("partySize", { type: "number", min: 1, max: MAX_PARTY_SIZE, inputMode: "numeric" }, true)} />
      </Field>

      {!promoterMode && (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Kaynak</legend>
          <input type="hidden" name="source" value={source} />
          <div className="flex flex-wrap gap-1.5">
            {GUEST_SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={source === s}
                onClick={() => setSource(s)}
                className={`rounded-field border px-3 py-1.5 text-[13px] transition-colors ${
                  source === s ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg"
                }`}
              >
                {GUEST_SOURCE_LABELS[s]}
              </button>
            ))}
          </div>
          {err("source") && <p className="mt-1.5 text-[13px] text-negative">{err("source")}</p>}
        </fieldset>
      )}

      {!promoterMode && source === "PROMOTER" && (
        <Field label="PR" htmlFor="promoterMembershipId" error={err("promoterMembershipId")} required>
          {promoters.length === 0 ? (
            <p className="text-[13px] text-muted">Bu işletmede aktif PR üyesi yok.</p>
          ) : (
            <select {...input("promoterMembershipId")}>
              <option value="">PR seçin</option>
              {promoters.map((p) => (
                <option key={p.membershipId} value={p.membershipId}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field label="Not" htmlFor="note" error={err("note")} hint="Kapı ekranında görünür; ör. masa, geliş saati.">
        <textarea {...input("note", { rows: 2, maxLength: 300 }, true)} />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Ekleniyor">
        Misafir ekle
      </SubmitButton>
      <p className="text-[12px] leading-relaxed text-muted">Misafir eklemek iletişim izni veya üyelik oluşturmaz.</p>
    </form>
  );
}
