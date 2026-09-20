"use client";

import { useActionState, type CSSProperties } from "react";
import { publicSignupAction } from "@/modules/menu/public-actions";
import { SIGNUP_CONSENT_TEXTS } from "@/modules/menu/campaign";
import { readableForeground, withAlpha } from "@/modules/menu/theme";
import { CHANNELS } from "@/lib/domain";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";

/**
 * Menüden kayıt formu. İletişim izinleri kanal kanal ve işaretsiz başlar;
 * yalnızca kişinin işaretlediği kanallar kaydedilir.
 */
export function SignupForm({
  slug,
  tenantName,
  perkName,
  privacyUrl,
  colors,
}: {
  slug: string;
  tenantName: string;
  perkName: string | null;
  privacyUrl: string | null;
  colors: { fg: string; accent: string; background: string };
}) {
  const [state, action, pending] = useActionState(publicSignupAction, IDLE);
  const err = (k: string) => fieldError(state, k);
  const previousConsents = state.status === "error" && Array.isArray(state.values?.consents) ? (state.values.consents as string[]) : [];

  const muted = withAlpha(colors.fg, 0.64);
  const inputStyle: CSSProperties = {
    background: withAlpha(colors.fg, 0.06),
    border: `1px solid ${withAlpha(colors.fg, 0.18)}`,
    color: colors.fg,
    borderRadius: 10,
  };
  const inputClass = "mt-1.5 block h-12 w-full px-3.5 text-[16px] outline-none focus:ring-2";
  const field = (name: "firstName" | "lastName" | "phone" | "email", label: string, extra: Record<string, unknown>) => (
    <div>
      <label htmlFor={`signup-${name}`} className="text-[13px] font-medium">
        {label}
      </label>
      <input
        id={`signup-${name}`}
        name={name}
        defaultValue={valueOf(state, name)}
        aria-invalid={!!err(name)}
        aria-describedby={err(name) ? `signup-${name}-error` : undefined}
        className={inputClass}
        style={inputStyle}
        {...extra}
      />
      {err(name) && (
        <p id={`signup-${name}-error`} className="mt-1 text-[13px]" style={{ color: colors.fg }}>
          {err(name)}
        </p>
      )}
    </div>
  );

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

      {state.status === "error" && !state.fieldErrors && (
        <p role="alert" className="rounded-xl px-3.5 py-3 text-[14px]" style={{ background: withAlpha(colors.fg, 0.08) }}>
          {state.message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", "Ad", { autoComplete: "given-name", maxLength: 80, required: true })}
        {field("lastName", "Soyad", { autoComplete: "family-name", maxLength: 80, required: true })}
      </div>
      {field("phone", "Telefon", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "0532 123 45 67", maxLength: 32, required: true })}
      {field("email", "E-posta (isteğe bağlı)", { type: "email", inputMode: "email", autoComplete: "email", maxLength: 254 })}

      <fieldset className="rounded-xl p-4" style={{ border: `1px solid ${withAlpha(colors.fg, 0.14)}` }}>
        <legend className="px-1 text-[13px] font-medium">İletişim tercihleri (isteğe bağlı)</legend>
        <p className="text-[12px] leading-relaxed" style={{ color: muted }}>
          Üye olmak için izin vermeniz gerekmez. İstediğiniz kanalları işaretleyin; dilediğiniz zaman vazgeçebilirsiniz.
        </p>
        <div className="mt-3 space-y-2.5">
          {CHANNELS.map((channel) => (
            <label key={channel} className="flex items-start gap-3 text-[14px] leading-snug">
              <input
                type="checkbox"
                name="consents"
                value={channel}
                defaultChecked={previousConsents.includes(channel)}
                className="mt-0.5 size-5 shrink-0"
                style={{ accentColor: colors.accent }}
              />
              <span>{SIGNUP_CONSENT_TEXTS[channel]}</span>
            </label>
          ))}
        </div>
        {err("consents") && <p className="mt-2 text-[13px]">{err("consents")}</p>}
      </fieldset>

      <p className="text-[12px] leading-relaxed" style={{ color: muted }}>
        Bilgileriniz {tenantName} tarafından üyelik kaydınızı oluşturmak
        {perkName ? ", size tanımlanan ikramı iletmek" : ""} ve yalnızca izin verdiğiniz kanallardan duyuru göndermek için kullanılır.{" "}
        {privacyUrl && (
          <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: colors.fg }}>
            Aydınlatma metni
          </a>
        )}
      </p>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="flex h-12 w-full items-center justify-center rounded-xl px-4 text-[15px] font-semibold disabled:opacity-60"
        style={{ background: colors.accent, color: readableForeground(colors.accent) }}
      >
        {pending ? "Kaydediliyor…" : perkName ? "Üye ol ve ikramını al" : "Üye ol"}
      </button>
    </form>
  );
}
