"use client";

import { useActionState, useEffect } from "react";
import { IDLE, type ActionState } from "@/lib/action-state";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Onay gerektirmeyen tek tuşluk işlem (ör. durumu yenile); sonuç bildirim olarak gösterilir. */
export function ActionButton({
  action,
  fields,
  children,
  pendingLabel,
  variant = "ghost",
  size = "sm",
}: {
  action: Action;
  fields: Record<string, string>;
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  useEffect(() => {
    if (state.status === "success") toast(state.message);
    if (state.status === "error") toast(state.message, "error");
  }, [state]);
  return (
    <form action={formAction}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
    </form>
  );
}
