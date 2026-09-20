"use client";

import { useActionState } from "react";
import { createPerkAction } from "@/modules/perks/actions";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function PerkForm({ venues, allowAllVenues }: { venues: { id: string; name: string }[]; allowAllVenues: boolean }) {
  const [state, action] = useActionState(createPerkAction, IDLE);
  const err = (k: string) => fieldError(state, k);
  const input = (k: string, extra: Record<string, unknown> = {}, hint = false) => ({
    ...describedBy(k, err(k), hint),
    name: k,
    defaultValue: valueOf(state, k, k === "perCustomerLimit" ? "1" : ""),
    className: "input",
    ...extra,
  });

  return (
    <form key={state.status === "error" ? state.at : "initial"} action={action} className="space-y-6" noValidate>
      {state.status === "error" && <FormAlert tone="error">{state.message}</FormAlert>}
      <Card>
        <CardHeader title="Avantaj" />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Avantaj adı" htmlFor="name" error={err("name")} required className="sm:col-span-2">
            <input {...input("name", { maxLength: 80, autoComplete: "off", placeholder: "Ör. Hoş geldin kokteyli" })} />
          </Field>
          <Field label="Geçerli mekan" htmlFor="venueId" error={err("venueId")} required>
            <select {...input("venueId")}>
              {allowAllVenues && <option value="">Tüm mekanlar</option>}
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kişi başı kullanım" htmlFor="perCustomerLimit" error={err("perCustomerLimit")} required hint="Bir müşterinin bu avantajı toplamda kaç kez kullanabileceği.">
            <input {...input("perCustomerLimit", { type: "number", min: 1, max: 100, inputMode: "numeric" }, true)} />
          </Field>
          <Field label="Açıklama" htmlFor="description" error={err("description")} className="sm:col-span-2" hint="Müşterinin pass sayfasında görünür.">
            <textarea {...input("description", { rows: 3, maxLength: 500 }, true)} />
          </Field>
          <Field label="Kullanım koşulları" htmlFor="terms" error={err("terms")} className="sm:col-span-2" hint="Ör. Yalnızca 22:00'ye kadar, başka kampanyalarla birleştirilmez.">
            <textarea {...input("terms", { rows: 3, maxLength: 1000 }, true)} />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Geçerlilik" description="Boş bırakılırsa süre sınırı uygulanmaz. Saatler İstanbul saatine göredir." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Başlangıç" htmlFor="validFrom" error={err("validFrom")}>
            <input {...input("validFrom", { type: "datetime-local" })} />
          </Field>
          <Field label="Bitiş" htmlFor="validUntil" error={err("validUntil")}>
            <input {...input("validUntil", { type: "datetime-local" })} />
          </Field>
        </div>
      </Card>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <ButtonLink href="/menu/perks" variant="ghost">
          Vazgeç
        </ButtonLink>
        <SubmitButton pendingLabel="Kaydediliyor">Avantajı oluştur</SubmitButton>
      </div>
    </form>
  );
}
