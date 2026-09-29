"use client";

import { useActionState } from "react";
import type { PreferenceChannel } from "@/modules/preferences/service";
import { IDLE } from "@/lib/action-state";
import { FormAlert } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { savePreferencesAction } from "./actions";

/** Kanal kutuları. İletişim bilgisi olmayan kanal açılamaz; nedeni yazılır. */
export function PreferenceForm({ token, channels }: { token: string; channels: PreferenceChannel[] }) {
  const [state, action] = useActionState(savePreferencesAction, IDLE);

  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "success" && <FormAlert tone="success">{state.message}</FormAlert>}
      {state.status === "error" && <FormAlert tone="error">{state.message}</FormAlert>}

      <fieldset className="space-y-2.5">
        <legend className="sr-only">İletişim kanalları</legend>
        {channels.map((c) => (
          <label
            key={c.channel}
            htmlFor={`channel-${c.channel}`}
            className={`flex gap-3 rounded-field border border-line px-4 py-3.5 transition-colors ${
              c.available ? "cursor-pointer hover:border-line-strong has-checked:border-fg has-checked:bg-raised" : "opacity-60"
            }`}
          >
            <input
              id={`channel-${c.channel}`}
              type="checkbox"
              name="channels"
              value={c.channel}
              defaultChecked={c.granted}
              disabled={!c.available}
              className="mt-0.5 size-4 shrink-0 accent-white"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{c.label}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">
                {c.available ? c.text : "Bu kanal için kayıtlı iletişim bilginiz yok."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <SubmitButton variant="primary" className="w-full !h-12" pendingLabel="Kaydediliyor">
        Tercihleri kaydet
      </SubmitButton>
      <p className="text-[12px] leading-relaxed text-muted">
        İşaretlemediğiniz kanalların izni kaldırılır. Kaydettiğiniz an geçerli olur.
      </p>
    </form>
  );
}
