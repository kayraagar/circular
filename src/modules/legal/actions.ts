"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { saveTenantLegal } from "./tenant-legal";

/** İşletmenin veri sorumlusu bilgileri. Yetki ve doğrulama servis katmanındadır. */
export async function saveTenantLegalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = {
    legalName: formString(formData, "legalName"),
    legalAddress: formString(formData, "legalAddress"),
    mersis: formString(formData, "mersis"),
    verbisId: formString(formData, "verbisId"),
    legalEmail: formString(formData, "legalEmail"),
    legalPhone: formString(formData, "legalPhone"),
    privacyUrl: formString(formData, "privacyUrl"),
  };
  try {
    const ctx = await requireServiceContext();
    const saved = await saveTenantLegal(ctx, values);
    revalidatePath("/settings");
    revalidatePath("/m", "layout");
    return success(saved.ready ? "Yasal bilgiler kaydedildi." : `Kaydedildi. Eksik alanlar: ${saved.missing.join(", ")}.`);
  } catch (error) {
    return toErrorState(error, values);
  }
}
