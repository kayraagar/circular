"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { closePrTask, createPrTask, markPrTask } from "./service";

/** PR yönetimi Server Action'ları. Yetki ve tenant kapsamı servis katmanında uygulanır. */

const TASK_FIELDS = ["kind", "title", "body", "eventId", "guestTarget", "dueAt", "audience"] as const;

export async function createPrTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = Object.fromEntries(TASK_FIELDS.map((k) => [k, formString(formData, k)]));
  const membershipIds = formData.getAll("membershipIds").filter((v): v is string => typeof v === "string");
  try {
    const ctx = await requireServiceContext();
    const result = await createPrTask(ctx, { ...values, membershipIds });
    revalidatePath("/pr");
    revalidatePath("/workspace");
    return success(`Talimat ${result.recipientCount} PR'a iletildi.`);
  } catch (error) {
    return toErrorState(error, { ...values, membershipIds });
  }
}

export async function closePrTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await closePrTask(ctx, formString(formData, "taskId"));
    revalidatePath("/pr");
    revalidatePath("/workspace");
    return success("Talimat kapatıldı; PR portalından kaldırıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}

export async function markPrTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const op = formString(formData, "op");
  try {
    const ctx = await requireServiceContext();
    await markPrTask(ctx, formString(formData, "taskId"), op);
    revalidatePath("/workspace");
    revalidatePath("/pr");
    return success(op === "done" ? "Tamamlandı olarak işaretlendi." : "Okundu olarak işaretlendi.");
  } catch (error) {
    return toErrorState(error);
  }
}
