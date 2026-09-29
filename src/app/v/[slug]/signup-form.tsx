"use client";

import { useActionState } from "react";
import { venueSignupAction } from "@/modules/venue-page/actions";
import { VENUE_SIGNUP_CONSENT_TEXTS } from "@/modules/venue-page/rules";
import { CHANNELS } from "@/lib/domain";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

type EventOption = { id: string; name: string; startsAt: string; spotsLeft: number | null };

/**
 * Mekan sayfasındaki kayıt formu. Üç şey ayrıdır ve ayrı görünür:
 * üyelik, etkinlik kaydı (isteğe bağlı) ve kanal kanal iletişim izni (işaretsiz başlar).
 */
export function VenueSignupForm({
  slug,
  venueName,
  events,
  selectedEventId,
  legal,
}: {
  slug: string;
  venueName: string;
  events: EventOption[];
  selectedEventId: string;
  legal: { legalName: string | null; legalEmail: string | null; legalAddress: string | null; privacyUrl: string | null; ready: boolean };
}) {
  const [state, action] = useActionState(venueSignupAction, IDLE);
  const err = (k: string) => fieldError(state, k);
  const previousConsents = state.status === "error" && Array.isArray(state.values?.consents) ? (state.values.consents as string[]) : [];

  return (
    <form key={state.status === "error" ? state.at : "initial"} action={action} className="relative mt-6 space-y-4" noValidate>
      <input type="hidden" name="slug" value={slug} />

      {/* Bal küpü: ekran okuyuculardan ve klavyeden gizli; yalnızca otomatik doldurucular doldurur. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Web sitesi
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {state.status === "error" && !state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ad" htmlFor="v-firstName" required showOptional={false} error={err("firstName")}>
          <input {...describedBy("v-firstName", err("firstName"))} name="firstName" autoComplete="given-name" maxLength={80} defaultValue={valueOf(state, "firstName")} className="input !h-12 !text-base" />
        </Field>
        <Field label="Soyad" htmlFor="v-lastName" required showOptional={false} error={err("lastName")}>
          <input {...describedBy("v-lastName", err("lastName"))} name="lastName" autoComplete="family-name" maxLength={80} defaultValue={valueOf(state, "lastName")} className="input !h-12 !text-base" />
        </Field>
      </div>
      <Field label="Telefon" htmlFor="v-phone" required showOptional={false} error={err("phone")}>
        <input {...describedBy("v-phone", err("phone"))} name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0532 123 45 67" maxLength={32} defaultValue={valueOf(state, "phone")} className="input !h-12 !text-base" />
      </Field>
      <Field label="E-posta" htmlFor="v-email" error={err("email")}>
        <input {...describedBy("v-email", err("email"))} name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} defaultValue={valueOf(state, "email")} className="input !h-12 !text-base" />
      </Field>

      {events.length > 0 && (
        <fieldset className="rounded-field border border-line p-4">
          <legend className="px-1 text-[13px] font-medium text-fg">Etkinlik kaydı (isteğe bağlı)</legend>
          <Field label="Etkinlik" htmlFor="v-event" showOptional={false} error={err("eventId")}>
            <select {...describedBy("v-event", err("eventId"))} name="eventId" defaultValue={valueOf(state, "eventId", selectedEventId)} className="input">
              <option value="">Yalnızca üye olmak istiyorum</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {new Date(e.startsAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}
                  {e.spotsLeft !== null ? ` (${e.spotsLeft} yer)` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kaç kişi" htmlFor="v-party" hint="Kendiniz dahil." showOptional={false} error={err("partySize")} className="mt-3">
            <input {...describedBy("v-party", err("partySize"), true)} name="partySize" type="number" min={1} max={10} defaultValue={valueOf(state, "partySize", "1")} className="input w-24" />
          </Field>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Etkinliğe kaydolursanız girişte okutacağınız kişiye özel QR kodunuz hemen oluşturulur.
          </p>
        </fieldset>
      )}

      <fieldset className="rounded-field border border-line p-4">
        <legend className="px-1 text-[13px] font-medium text-fg">İletişim tercihleri (isteğe bağlı)</legend>
        <p className="text-[12px] leading-relaxed text-muted">
          Üye olmak için izin vermeniz gerekmez. İstediğiniz kanalları işaretleyin; dilediğiniz zaman vazgeçebilirsiniz.
        </p>
        <div className="mt-3 space-y-2.5">
          {CHANNELS.map((channel) => (
            <label key={channel} className="flex items-start gap-3 text-[14px] leading-snug text-fg">
              <input type="checkbox" name="consents" value={channel} defaultChecked={previousConsents.includes(channel)} className="mt-0.5 size-5 shrink-0 accent-white" />
              <span>{VENUE_SIGNUP_CONSENT_TEXTS[channel]}</span>
            </label>
          ))}
        </div>
        {err("consents") && <p className="mt-2 text-[13px] text-negative">{err("consents")}</p>}
      </fieldset>

      {/* KVKK m.10: veri toplanmadan önce veri sorumlusunun kimliği, amaç ve haklar bildirilir. */}
      <div className="space-y-1.5 text-[12px] leading-relaxed text-muted">
        <p>
          Veri sorumlusu: <span className="text-fg">{legal.legalName ?? venueName}</span>
          {legal.legalAddress ? ` · ${legal.legalAddress}` : ""}
        </p>
        <p>
          Bilgileriniz üyelik kaydınızı oluşturmak, kaydolduğunuz etkinliğin giriş hakkını vermek ve yalnızca izin
          verdiğiniz kanallardan duyuru göndermek için işlenir. İzninizi istediğiniz zaman geri alabilirsiniz.
        </p>
        <p>
          {legal.legalEmail ? (
            <>
              KVKK kapsamındaki haklarınız için{" "}
              <a href={`mailto:${legal.legalEmail}`} className="text-fg underline underline-offset-2">
                {legal.legalEmail}
              </a>{" "}
              adresine başvurabilirsiniz.
            </>
          ) : (
            "KVKK kapsamındaki haklarınız için işletmeye başvurabilirsiniz."
          )}{" "}
          {legal.privacyUrl && (
            <a href={legal.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-2">
              Aydınlatma metni
            </a>
          )}
        </p>
        {!legal.ready && (
          <p role="status" className="text-fg">
            Not: Bu işletme aydınlatma bilgilerini henüz tamamlamadı.
          </p>
        )}
      </div>

      <SubmitButton variant="primary" className="w-full !h-12" pendingLabel="Kaydediliyor">
        Kaydı tamamla
      </SubmitButton>
    </form>
  );
}
