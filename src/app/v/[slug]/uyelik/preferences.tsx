"use client";

import { useActionState } from "react";
import { saveMemberPreferencesAction } from "@/modules/member/actions";
import type { Channel } from "@/lib/domain";
import { IDLE } from "@/lib/action-state";
import { FormAlert } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

/** Üyelik alanındaki izin kutuları; tercih merkeziyle aynı servisi kullanır. */
export function MemberPreferences({ slug, consents }: { slug: string; consents: { channel: Channel; label: string; granted: boolean }[] }) {
  const [state, action] = useActionState(saveMemberPreferencesAction, IDLE);

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="slug" value={slug} />
      {state.status === "success" && <FormAlert tone="success">{state.message}</FormAlert>}
      {state.status === "error" && <FormAlert tone="error">{state.message}</FormAlert>}

      <fieldset className="space-y-2">
        <legend className="sr-only">İletişim kanalları</legend>
        {consents.map((c) => (
          <label
            key={c.channel}
            htmlFor={`member-${c.channel}`}
            className="flex cursor-pointer items-center gap-3 rounded-field border border-line px-4 py-3 text-sm text-fg transition-colors hover:border-line-strong has-checked:border-fg has-checked:bg-raised"
          >
            <input id={`member-${c.channel}`} type="checkbox" name="channels" value={c.channel} defaultChecked={c.granted} className="size-4 accent-white" />
            {c.label}
          </label>
        ))}
      </fieldset>

      <SubmitButton variant="secondary" pendingLabel="Kaydediliyor">
        Tercihleri kaydet
      </SubmitButton>
    </form>
  );
}
