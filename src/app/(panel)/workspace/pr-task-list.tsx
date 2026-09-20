"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { markPrTaskAction } from "@/modules/pr/actions";
import { PR_TASK_KIND_LABELS, type PrTaskKind, type RecipientState } from "@/modules/pr/tasks";
import { IDLE } from "@/lib/action-state";
import { Badge, FormAlert } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

export type PortalTask = {
  taskId: string;
  kind: PrTaskKind;
  title: string;
  body: string | null;
  state: RecipientState;
  eventId: string | null;
  eventLabel: string | null;
  dueLabel: string | null;
  overdue: boolean;
  guestTarget: number | null;
  progress: { people: number; admitted: number; ratio: number } | null;
};

function MarkButton({ taskId, op, label }: { taskId: string; op: "read" | "done"; label: string }) {
  const [state, action] = useActionState(markPrTaskAction, IDLE);
  useEffect(() => {
    if (state.status === "success") toast(state.message);
  }, [state]);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton size="sm" variant={op === "done" ? "primary" : "secondary"} pendingLabel="Kaydediliyor">
        {label}
      </SubmitButton>
      {state.status === "error" && (
        <span className="basis-full">
          <FormAlert tone="error">{state.message}</FormAlert>
        </span>
      )}
    </form>
  );
}

/** PR portalı: kişiye verilen açık talimatlar. */
export function PrTaskList({ tasks }: { tasks: PortalTask[] }) {
  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.taskId} className="border-line px-5 py-4 [&+li]:border-t">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{PR_TASK_KIND_LABELS[task.kind]}</Badge>
            {task.state === "UNREAD" && <Badge tone="caution">Yeni</Badge>}
            {task.state === "DONE" && <Badge tone="positive">Tamamlandı</Badge>}
            {task.overdue && task.state !== "DONE" && <Badge tone="caution">Süresi geçti</Badge>}
          </div>
          <p className="mt-2 font-display text-[17px] leading-snug font-medium text-fg">{task.title}</p>
          {task.body && <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-line text-muted">{task.body}</p>}
          {(task.eventLabel || task.dueLabel) && (
            <p className="mt-2 text-[12px] text-muted">
              {task.eventLabel}
              {task.eventLabel && task.dueLabel ? " · " : ""}
              {task.dueLabel ? `Son tarih ${task.dueLabel}` : ""}
            </p>
          )}

          {task.kind === "GUEST_TARGET" && task.progress && task.guestTarget !== null && (
            <div className="mt-3 max-w-md space-y-1.5">
              <span
                className="block h-1.5 w-full overflow-hidden rounded-full bg-line"
                role="img"
                aria-label={`${task.progress.people} / ${task.guestTarget} kişi`}
              >
                <span
                  className="block h-full rounded-full bg-[#2E8B57] transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${Math.round(task.progress.ratio * 100)}%` }}
                />
              </span>
              <p className="text-[12px] text-muted" data-numeric>
                {task.progress.people} / {task.guestTarget} kişi · {task.progress.admitted} içeride
                {task.progress.ratio >= 1 ? " · hedefe ulaşıldı" : ""}
              </p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {task.state === "UNREAD" && <MarkButton taskId={task.taskId} op="read" label="Okudum" />}
            {task.kind === "TODO" && task.state !== "DONE" && <MarkButton taskId={task.taskId} op="done" label="Tamamladım" />}
            {task.eventId && (
              <Link href={`/events/${task.eventId}/guests`} className="text-[13px] text-muted underline-offset-4 hover:text-fg hover:underline">
                Misafir listesine git
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
