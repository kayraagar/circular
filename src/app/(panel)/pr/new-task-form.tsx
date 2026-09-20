"use client";

import { useActionState, useEffect, useState } from "react";
import { createPrTaskAction } from "@/modules/pr/actions";
import { PR_TASK_KINDS, PR_TASK_KIND_HINTS, PR_TASK_KIND_LABELS, PR_TASK_LIMITS, type PrTaskKind } from "@/modules/pr/tasks";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { isOneOf } from "@/lib/domain";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

type Option = { id: string; label: string };

/** Yeni talimat: tür, içerik, isteğe bağlı etkinlik/hedef/son tarih ve alıcılar. */
export function NewTaskForm({ events, prs }: { events: Option[]; prs: Option[] }) {
  const [state, action] = useActionState(createPrTaskAction, IDLE);
  const previousKind = valueOf(state, "kind");
  const [kind, setKind] = useState<PrTaskKind>(isOneOf(PR_TASK_KINDS, previousKind) ? previousKind : "ANNOUNCEMENT");
  const [audience, setAudience] = useState(valueOf(state, "audience", "ALL"));
  const previousIds = state.status === "error" && Array.isArray(state.values?.membershipIds) ? (state.values.membershipIds as string[]) : [];

  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);

  const err = (k: string) => fieldError(state, k);
  const input = (k: string, extra: Record<string, unknown> = {}, hint = false) => ({
    ...describedBy(k, err(k), hint),
    name: k,
    defaultValue: valueOf(state, k),
    className: "input",
    ...extra,
  });
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;

  return (
    <form key={state.status === "idle" ? "initial" : state.at} action={action} className="space-y-4 p-5" noValidate>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="audience" value={audience} />
      {generalError && <FormAlert tone="error">{generalError}</FormAlert>}

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Tür</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {PR_TASK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-field border px-2 py-1.5 text-[13px] transition-colors ${
                kind === k ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg"
              }`}
            >
              {PR_TASK_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{PR_TASK_KIND_HINTS[kind]}</p>
        {err("kind") && <p className="mt-1 text-[13px] text-negative">{err("kind")}</p>}
      </fieldset>

      <Field label="Başlık" htmlFor="title" error={err("title")} required>
        <input
          {...input("title", {
            maxLength: PR_TASK_LIMITS.title,
            autoComplete: "off",
            placeholder: kind === "GUEST_TARGET" ? "Ör. Cuma için guest listesini doldurun" : kind === "TODO" ? "Ör. Story paylaşımı yapın" : "Ör. Liste 22:00'de kapanıyor",
          })}
        />
      </Field>
      <Field label="Açıklama" htmlFor="body" error={err("body")} hint="PR portalında başlığın altında görünür.">
        <textarea {...input("body", { rows: 3, maxLength: PR_TASK_LIMITS.body }, true)} />
      </Field>

      <Field
        label="Etkinlik"
        htmlFor="eventId"
        error={err("eventId")}
        required={kind === "GUEST_TARGET"}
        hint={events.length === 0 ? "Yayında ve bitmemiş etkinlik yok." : undefined}
      >
        <select {...input("eventId", {}, events.length === 0)}>
          <option value="">{kind === "GUEST_TARGET" ? "Etkinlik seçin" : "Etkinlikle ilişkili değil"}</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {kind === "GUEST_TARGET" && (
          <Field label="PR başına kişi hedefi" htmlFor="guestTarget" error={err("guestTarget")} required>
            <input {...input("guestTarget", { type: "number", min: 1, max: PR_TASK_LIMITS.maxTarget, inputMode: "numeric" })} />
          </Field>
        )}
        <Field label="Son tarih" htmlFor="dueAt" error={err("dueAt")}>
          <input {...input("dueAt", { type: "datetime-local" })} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Alıcılar</legend>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="audience-choice" checked={audience === "ALL"} onChange={() => setAudience("ALL")} className="accent-white" />
            Tüm aktif PR&apos;lar ({prs.length})
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="audience-choice" checked={audience === "SELECTED"} onChange={() => setAudience("SELECTED")} className="accent-white" />
            Seçili PR&apos;lar
          </label>
        </div>
        {audience === "SELECTED" && (
          <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-field border border-line p-3">
            {prs.map((pr) => (
              <label key={pr.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="membershipIds" value={pr.id} defaultChecked={previousIds.includes(pr.id)} className="size-4 accent-white" />
                {pr.label}
              </label>
            ))}
          </div>
        )}
        {err("membershipIds") && <p className="mt-1.5 text-[13px] text-negative">{err("membershipIds")}</p>}
        {kind === "GUEST_TARGET" && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">Etkinliğin mekanına erişimi olmayan PR&apos;lar bu talimatı alamaz.</p>
        )}
      </fieldset>

      <SubmitButton className="w-full" pendingLabel="Gönderiliyor">
        Talimatı gönder
      </SubmitButton>
      <p className="text-[12px] leading-relaxed text-muted">Talimat PR portalında görünür; SMS veya WhatsApp bildirimi gönderilmez.</p>
    </form>
  );
}
