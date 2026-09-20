"use client";

import Link from "next/link";
import { useActionState } from "react";
import { IDLE, fieldError, type ActionState } from "@/lib/action-state";
import { CHANNELS, CHANNEL_LABELS, CUSTOMER_SOURCE_LABELS, STAFF_SELECTABLE_SOURCES } from "@/lib/domain";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { TagInput } from "@/components/ui/tag-input";

export type CustomerFormInitial = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birthDate: string;
  notes: string;
  tags: string[];
};

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type DuplicateDetail = { customerId: string; name: string; archived: boolean };
type PossibleDetail = { matches: { customerId: string; name: string }[] };

export function CustomerForm({
  mode,
  action,
  initial,
  tagSuggestions,
  cancelHref,
  today,
}: {
  mode: "create" | "edit";
  action: Action;
  initial: CustomerFormInitial;
  tagSuggestions: string[];
  cancelHref: string;
  today: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const v = (k: Exclude<keyof CustomerFormInitial, "tags">) =>
    typeof values[k] === "string" ? (values[k] as string) : initial[k];
  const tags = Array.isArray(values.tags) ? (values.tags as string[]) : initial.tags;
  const consentChannels = Array.isArray(values.consentChannels) ? (values.consentChannels as string[]) : [];
  const err = (k: string) => fieldError(state, k);

  const possible = state.status === "error" && state.code === "POSSIBLE_DUPLICATE" ? (state.detail as PossibleDetail) : null;
  const duplicate = state.status === "error" && state.code === "DUPLICATE_CONTACT" ? (state.detail as DuplicateDetail) : null;

  return (
    <form key={state.status === "error" ? state.at : "initial"} action={formAction} className="space-y-6" noValidate>
      {state.status === "error" && !possible && !duplicate && <FormAlert tone="error">{state.message}</FormAlert>}
      {duplicate && (
        <FormAlert tone="error">
          <p>{state.status === "error" && state.message}</p>
          <p>
            Aynı kişi için ikinci kayıt açılmaz.{" "}
            <Link href={`/customers/${duplicate.customerId}`} className="underline underline-offset-4">
              Mevcut kaydı aç
            </Link>
          </p>
        </FormAlert>
      )}
      {possible && (
        <FormAlert tone="info">
          <p className="text-fg">{state.status === "error" && state.message}</p>
          <ul className="list-inside list-disc">
            {possible.matches.map((m) => (
              <li key={m.customerId}>
                <Link href={`/customers/${m.customerId}`} target="_blank" rel="noopener" className="text-fg underline underline-offset-4">
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
          <p>Farklı bir kişiyse aşağıdaki &quot;Farklı kişi, yine de kaydet&quot; ile devam edin.</p>
        </FormAlert>
      )}

      <Card>
        <CardHeader
          title="Kişi bilgileri"
          description="Telefon veya e-postadan en az biri gerekli. Telefon numaraları standart biçimde saklanır."
        />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Ad" htmlFor="firstName" error={err("firstName")} required>
            <input {...describedBy("firstName", err("firstName"))} name="firstName" defaultValue={v("firstName")} autoComplete="off" className="input" maxLength={80} required />
          </Field>
          <Field label="Soyad" htmlFor="lastName" error={err("lastName")} required>
            <input {...describedBy("lastName", err("lastName"))} name="lastName" defaultValue={v("lastName")} autoComplete="off" className="input" maxLength={80} required />
          </Field>
          <Field label="Telefon" htmlFor="phone" error={err("phone")} hint="Ör. 0532 123 45 67 veya +44…" showOptional={false}>
            <input {...describedBy("phone", err("phone"), true)} name="phone" type="tel" inputMode="tel" defaultValue={v("phone")} autoComplete="off" className="input" />
          </Field>
          <Field label="E-posta" htmlFor="email" error={err("email")} showOptional={false}>
            <input {...describedBy("email", err("email"))} name="email" type="email" inputMode="email" defaultValue={v("email")} autoComplete="off" className="input" />
          </Field>
          <Field label="Doğum tarihi" htmlFor="birthDate" error={err("birthDate")}>
            <input {...describedBy("birthDate", err("birthDate"))} name="birthDate" type="date" max={today} min="1900-01-01" defaultValue={v("birthDate")} className="input" />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Etiketler ve notlar" description="Etiketler işletme genelinde ortaktır; segmentlerin temelini oluşturur." />
        <div className="grid gap-5 p-5">
          <Field label="Etiketler" htmlFor="tags-input" error={err("tags")}>
            <TagInput name="tags" id="tags-input" initial={tags} suggestions={tagSuggestions} invalid={!!err("tags")} />
          </Field>
          <Field label="Notlar" htmlFor="notes" error={err("notes")} hint="Yalnızca yetkili ekip üyeleri görür.">
            <textarea {...describedBy("notes", err("notes"), true)} name="notes" defaultValue={v("notes")} rows={4} maxLength={4000} className="input" />
          </Field>
        </div>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader
            title="Kayıt kaynağı ve iletişim izni"
            description="Müşteri kaydı, üyelik ve pazarlama izni ayrı kavramlardır."
          />
          <div className="grid gap-6 p-5">
            <Field label="Kayıt kaynağı" htmlFor="source" error={err("source")} required>
              <select {...describedBy("source", err("source"))} name="source" defaultValue={typeof values.source === "string" ? values.source : "MANUAL"} className="input sm:max-w-xs">
                {STAFF_SELECTABLE_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {CUSTOMER_SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset aria-describedby="consent-help">
              <legend className="text-[13px] font-medium text-fg">İletişim izni</legend>
              <p id="consent-help" className="mt-1 text-[13px] text-muted">
                Yalnızca müşteri bu kanal için açıkça izin verdiyse işaretleyin. Boş bırakılan kanallara pazarlama mesajı gönderilemez.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {CHANNELS.map((ch) => (
                  <label
                    key={ch}
                    className="inline-flex h-10 cursor-pointer items-center gap-2.5 rounded-field border border-line px-3.5 text-sm transition-colors hover:border-line-strong has-[:checked]:border-fg/60 has-[:checked]:bg-raised"
                  >
                    <input type="checkbox" name="consentChannels" value={ch} defaultChecked={consentChannels.includes(ch)} className="size-4 accent-[#f7f7f5]" />
                    {CHANNEL_LABELS[ch]}
                  </label>
                ))}
              </div>
              {err("consentChannels") && <p className="mt-2 text-[13px] text-negative">{err("consentChannels")}</p>}
              <Field
                className="mt-4"
                label="İzin nasıl alındı?"
                htmlFor="consentNote"
                error={err("consentNote")}
                hint="İzin işaretlendiyse zorunlu. Ör. Kasa kayıt formu, 14 Eylül"
                showOptional={false}
              >
                <input {...describedBy("consentNote", err("consentNote"), true)} name="consentNote" defaultValue={typeof values.consentNote === "string" ? values.consentNote : ""} maxLength={300} className="input" />
              </Field>
            </fieldset>
          </div>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <ButtonLink href={cancelHref} variant="ghost">
          Vazgeç
        </ButtonLink>
        {possible ? (
          <SubmitButton name="confirmDuplicate" value="1" pendingLabel="Kaydediliyor">
            Farklı kişi, yine de kaydet
          </SubmitButton>
        ) : (
          <SubmitButton pendingLabel="Kaydediliyor">{mode === "create" ? "Müşteriyi kaydet" : "Değişiklikleri kaydet"}</SubmitButton>
        )}
      </div>
    </form>
  );
}
