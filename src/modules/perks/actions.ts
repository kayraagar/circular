"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, setFlash, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import type { PassShare } from "@/modules/passes/internal";
import { createPerk, getOrIssuePerkPass, setPerkStatus } from "./service";

const PERK_FIELDS = ["name", "venueId", "description", "terms", "validFrom", "validUntil", "perCustomerLimit"] as const;

export async function createPerkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = Object.fromEntries(PERK_FIELDS.map((k) => [k, formString(formData, k)]));
  try {
    const ctx = await requireServiceContext();
    await createPerk(ctx, values);
  } catch (error) {
    return toErrorState(error, values);
  }
  await setFlash("Avantaj oluşturuldu.");
  revalidatePath("/menu/perks");
  redirect("/menu/perks");
}

export async function setPerkStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const status = formString(formData, "status");
  try {
    const ctx = await requireServiceContext();
    await setPerkStatus(ctx, formString(formData, "perkId"), status);
  } catch (error) {
    return toErrorState(error);
  }
  revalidatePath("/menu/perks");
  return success(status === "ARCHIVED" ? "Avantaj arşivlendi." : "Avantaj yeniden etkinleştirildi.");
}

export async function perkPassAction(
  customerId: string,
  perkId: string,
  reissue: boolean,
): Promise<{ ok: true; data: PassShare & { remaining: number; perkName: string } } | { ok: false; message: string }> {
  try {
    const ctx = await requireServiceContext();
    const data = await getOrIssuePerkPass(ctx, { customerId, perkId, reissue });
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, data };
  } catch (error) {
    const state = toErrorState(error);
    return { ok: false, message: state.status === "error" ? state.message : "QR oluşturulamadı." };
  }
}
