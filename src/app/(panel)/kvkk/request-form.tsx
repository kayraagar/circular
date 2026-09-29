"use client";

import { useActionState } from "react";
import { createDataRequestAction } from "@/modules/privacy/actions";
import { REQUEST_CHANNELS, REQUEST_CHANNEL_LABELS, REQUEST_KINDS, REQUEST_KIND_LABELS } from "@/modules/privacy/rules";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

/** Gelen ilgili kişi başvurusunu deftere yazar. */
export function RequestForm() {
  const [state, action] = useActionState(createDataRequestAction, IDLE);
  const general = state.status === "error" && !state.fieldErrors ? state.message : null;

  return (
    <form action={action} className="space-y-4 p-5" noValidate key={state.status === "success" ? state.at : "form"}>
      {general && <FormAlert tone="error">{general}</FormAlert>}
      {state.status === "success" && <FormAlert tone="success">{state.message}</FormAlert>}

      <Field label="Başvuran" htmlFor="applicant-name" required showOptional={false} error={fieldError(state, "applicantName")}>
        <input
          {...describedBy("applicant-name", fieldError(state, "applicantName"))}
          name="applicantName"
          maxLength={120}
          defaultValue={valueOf(state, "applicantName")}
          className="input"
        />
      </Field>

      <Field label="İletişim" htmlFor="applicant-contact" hint="Cevabın gönderileceği e-posta, KEP veya adres." error={fieldError(state, "contact")}>
        <input
          {...describedBy("applicant-contact", fieldError(state, "contact"), true)}
          name="contact"
          maxLength={200}
          defaultValue={valueOf(state, "contact")}
          className="input"
        />
      </Field>

      <Field label="Talep türü" htmlFor="request-kind" required showOptional={false} error={fieldError(state, "kind")}>
        <select {...describedBy("request-kind", fieldError(state, "kind"))} name="kind" defaultValue={valueOf(state, "kind", "ACCESS")} className="input">
          {REQUEST_KINDS.map((k) => (
            <option key={k} value={k}>
              {REQUEST_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Geliş yolu" htmlFor="request-channel" required showOptional={false} error={fieldError(state, "channel")}>
          <select
            {...describedBy("request-channel", fieldError(state, "channel"))}
            name="channel"
            defaultValue={valueOf(state, "channel", "EMAIL")}
            className="input"
          >
            {REQUEST_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {REQUEST_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Geliş tarihi" htmlFor="request-date" hint="Boşsa bugün." error={fieldError(state, "receivedOn")}>
          <input
            {...describedBy("request-date", fieldError(state, "receivedOn"), true)}
            name="receivedOn"
            type="date"
            defaultValue={valueOf(state, "receivedOn")}
            className="input"
          />
        </Field>
      </div>

      <Field label="Talebin özeti" htmlFor="request-note" error={fieldError(state, "note")}>
        <textarea
          {...describedBy("request-note", fieldError(state, "note"))}
          name="note"
          rows={3}
          maxLength={2000}
          defaultValue={valueOf(state, "note")}
          className="input !h-auto py-2"
        />
      </Field>

      <Field label="CRM kaydı (isteğe bağlı)" htmlFor="request-customer" hint="Müşteri kimliği; eşleşen kayıt varsa bağlanır." error={fieldError(state, "customerId")}>
        <input
          {...describedBy("request-customer", fieldError(state, "customerId"), true)}
          name="customerId"
          maxLength={40}
          defaultValue={valueOf(state, "customerId")}
          className="input font-mono text-[13px]"
        />
      </Field>

      <SubmitButton variant="primary" pendingLabel="Kaydediliyor">
        Başvuruyu kaydet
      </SubmitButton>
    </form>
  );
}
