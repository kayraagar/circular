"use client";

import { useActionState } from "react";
import { IDLE, fieldError } from "@/lib/action-state";
import { confirmPhoneAction } from "@/modules/verification/actions";

/**
 * Tek kullanımlık SMS kodu kutusu. Kayıt sonrası gösterilir; kişi doğrulamadan da
 * devam edebilir (kaydı geçerlidir), doğrulama yalnızca numaranın ona ait olduğunu kanıtlar.
 *
 * Renkler dışarıdan verilir: menü sayfaları işletmenin temasını kullanır.
 */
export function PhoneVerifyForm({
  handle,
  maskedPhone,
  colors,
}: {
  handle: string;
  maskedPhone: string;
  colors?: { fg: string; accent: string; onAccent: string; border: string };
}) {
  const [state, action] = useActionState(confirmPhoneAction, IDLE);
  const error = fieldError(state, "code") ?? (state.status === "error" ? state.message : null);
  const fg = colors?.fg;
  const done = state.status === "success";

  if (done) {
    return (
      <p role="status" className="mt-6 text-[14px] leading-relaxed" style={fg ? { color: fg } : undefined}>
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="mt-6 text-left">
      <input type="hidden" name="handle" value={handle} />
      <label htmlFor="verify-code" className="text-[13px] font-medium" style={fg ? { color: fg } : undefined}>
        {maskedPhone} numarasına gönderilen kod
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="verify-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          aria-invalid={error ? true : undefined}
          className="input !h-12 flex-1 text-center !text-[18px] tracking-[0.3em]"
          style={colors ? { color: colors.fg, borderColor: colors.border } : undefined}
        />
        <button
          type="submit"
          className="inline-flex h-12 shrink-0 items-center justify-center rounded-xl px-5 text-[15px] font-semibold"
          style={colors ? { background: colors.accent, color: colors.onAccent } : undefined}
        >
          Doğrula
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-negative">
          {error}
        </p>
      )}
      <p className="mt-2 text-[12px] leading-relaxed" style={fg ? { color: fg, opacity: 0.7 } : undefined}>
        Doğrulamadan da devam edebilirsiniz; kaydınız geçerlidir. Kod 10 dakika içinde kullanılmalıdır.
      </p>
    </form>
  );
}
