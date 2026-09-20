"use client";

import { useActionState } from "react";
import { IDLE, fieldError, type ActionState } from "@/lib/action-state";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export type EventFormInitial = {
  name: string;
  venueId: string;
  description: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  entryClosesAt: string;
  status: string;
};

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function EventForm({
  mode,
  action,
  initial,
  venues,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: Action;
  initial: EventFormInitial;
  venues: { id: string; name: string }[];
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const v = (k: keyof EventFormInitial) => (typeof values[k] === "string" ? (values[k] as string) : initial[k]);
  const err = (k: string) => fieldError(state, k);
  const input = (k: keyof EventFormInitial, extra: Record<string, unknown> = {}, hint = false) => ({
    ...describedBy(k, err(k), hint),
    name: k,
    defaultValue: v(k),
    className: "input",
    ...extra,
  });

  return (
    <form key={state.status === "error" ? state.at : "initial"} action={formAction} className="space-y-6" noValidate>
      {state.status === "error" && <FormAlert tone="error">{state.message}</FormAlert>}

      <Card>
        <CardHeader title="Etkinlik" />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Etkinlik adı" htmlFor="name" error={err("name")} required className="sm:col-span-2">
            <input {...input("name", { maxLength: 120, required: true, autoComplete: "off" })} />
          </Field>
          <Field label="Mekan" htmlFor="venueId" error={err("venueId")} required>
            <select {...input("venueId", { required: true })}>
              {venues.length > 1 && <option value="">Mekan seçin</option>}
              {venues.map((ven) => (
                <option key={ven.id} value={ven.id}>
                  {ven.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kapasite (kişi)" htmlFor="capacity" error={err("capacity")} hint="Boş bırakılırsa sınır uygulanmaz. Grup kayıtlarındaki kişi sayısı toplanır.">
            <input {...input("capacity", { type: "number", min: 1, max: 100000, step: 1, inputMode: "numeric" }, true)} />
          </Field>
          <Field label="Açıklama" htmlFor="description" error={err("description")} className="sm:col-span-2">
            <textarea {...input("description", { rows: 4, maxLength: 2000 })} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Tarih ve saat" description="Tüm saatler İstanbul saatine göre (Europe/Istanbul)." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Başlangıç" htmlFor="startsAt" error={err("startsAt")} required>
            <input {...input("startsAt", { type: "datetime-local", required: true })} />
          </Field>
          <Field label="Bitiş" htmlFor="endsAt" error={err("endsAt")} required>
            <input {...input("endsAt", { type: "datetime-local", required: true })} />
          </Field>
          <Field
            label="Giriş kapanışı"
            htmlFor="entryClosesAt"
            error={err("entryClosesAt")}
            hint="Boşsa etkinlik bitişi kullanılır; gece uzarsa bitişten sonrasına da ayarlanabilir. Gelmedi (no-show) durumu yalnızca bu saatten sonra belirlenir."
            className="sm:col-span-2"
          >
            <input {...input("entryClosesAt", { type: "datetime-local" }, true)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Kayıt penceresi"
          description="Müşterilerin kendi kaydını yapacağı etkinlik sayfası hazırlandığında bu pencere uygulanır. Personel guest eklemesi etkinlik bitene kadar açıktır."
        />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Kayıt başlangıcı" htmlFor="registrationOpensAt" error={err("registrationOpensAt")}>
            <input {...input("registrationOpensAt", { type: "datetime-local" })} />
          </Field>
          <Field label="Kayıt bitişi" htmlFor="registrationClosesAt" error={err("registrationClosesAt")}>
            <input {...input("registrationClosesAt", { type: "datetime-local" })} />
          </Field>
        </div>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader title="Yayın durumu" />
          <fieldset className="grid gap-3 p-5 sm:grid-cols-2">
            <legend className="sr-only">Yayın durumu</legend>
            {[
              ["DRAFT", "Taslak", "Ekip içinde hazırlanır; daha sonra yayına alınabilir."],
              ["PUBLISHED", "Yayında", "Etkinlik aktif olarak işaretlenir. Herkese açık etkinlik sayfası sonraki fazda eklenecek."],
            ].map(([value, label, desc]) => (
              <label
                key={value}
                className="flex cursor-pointer gap-3 rounded-field border border-line p-4 transition-colors hover:border-line-strong has-[:checked]:border-fg/60 has-[:checked]:bg-raised"
              >
                <input type="radio" name="status" value={value} defaultChecked={v("status") === value} className="mt-0.5 size-4 accent-[#f7f7f5]" />
                <span>
                  <span className="block text-sm font-medium text-fg">{label}</span>
                  <span className="mt-0.5 block text-[13px] text-muted">{desc}</span>
                </span>
              </label>
            ))}
            {err("status") && <p className="text-[13px] text-negative">{err("status")}</p>}
          </fieldset>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <ButtonLink href={cancelHref} variant="ghost">
          Vazgeç
        </ButtonLink>
        <SubmitButton pendingLabel="Kaydediliyor">{mode === "create" ? "Etkinliği oluştur" : "Değişiklikleri kaydet"}</SubmitButton>
      </div>
    </form>
  );
}
