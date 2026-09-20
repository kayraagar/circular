"use client";

import { useActionState, useId, useRef, type ReactNode } from "react";
import { IDLE, type ActionState } from "@/lib/action-state";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { FormAlert } from "./primitives";
import { SubmitButton } from "./submit-button";
import { toast } from "./toaster";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Geri alınması zor işlemler için onay diyaloğu (native <dialog>: odak hapsi ve Esc tarayıcıdan).
 * İşlem sunucuda ayrıca yetki kontrolünden geçer.
 */
export function ConfirmDialog({
  trigger,
  triggerVariant = "secondary",
  triggerSize = "sm",
  title,
  description,
  confirmLabel,
  confirmVariant = "danger",
  action,
  fields,
  children,
}: {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  action: Action;
  fields: Record<string, string>;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.status === "success") {
      ref.current?.close();
      formRef.current?.reset();
      toast(result.message);
    }
    return result;
  }, IDLE);

  const firstFieldError =
    state.status === "error" && state.fieldErrors
      ? Object.values(state.fieldErrors).flat().filter(Boolean)[0]
      : undefined;

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} onClick={() => ref.current?.showModal()} aria-haspopup="dialog">
        {trigger}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-surface p-0 text-fg shadow-[0_24px_80px_rgb(0_0_0/0.6)] open:animate-enter"
      >
        <form ref={formRef} action={formAction} className="p-6">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <h2 id={titleId} className="text-lg font-medium">
            {title}
          </h2>
          <div className="mt-2 text-sm leading-relaxed text-muted">{description}</div>
          {children && <div className="mt-4">{children}</div>}
          {state.status === "error" && (
            <div className="mt-4">
              <FormAlert tone="error">{firstFieldError ?? state.message}</FormAlert>
            </div>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => ref.current?.close()}>
              Vazgeç
            </Button>
            <SubmitButton variant={confirmVariant}>{confirmLabel}</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
