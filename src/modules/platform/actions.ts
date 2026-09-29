"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { ForbiddenError } from "@/lib/errors";
import { endSupportAccessByAdmin, grantSupportAccess, setTenantStatus } from "./service";

/** Platform konsolu Server Action'ları. Yetki `User.isPlatformAdmin` ile kontrol edilir. */

async function platformUser() {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) throw new ForbiddenError();
  return { id: session.user.id, isPlatformAdmin: true };
}

function refresh() {
  revalidatePath("/platform");
  revalidatePath("/", "layout");
}

export async function setTenantStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { tenantId: formString(formData, "tenantId"), reason: formString(formData, "reason") };
  try {
    const suspend = formString(formData, "suspend") === "true";
    const tenant = await setTenantStatus(await platformUser(), values, suspend);
    refresh();
    return success(suspend ? `${tenant.name} askıya alındı.` : `${tenant.name} yeniden açıldı.`);
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function grantSupportAccessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = {
    tenantId: formString(formData, "tenantId"),
    reason: formString(formData, "reason"),
    hours: formString(formData, "hours") || "2",
  };
  try {
    const grant = await grantSupportAccess(await platformUser(), values);
    refresh();
    return success(`Destek erişimi açıldı. ${grant.expiresAt.toLocaleString("tr-TR")} tarihinde kendiliğinden kapanır.`);
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function endSupportAccessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await endSupportAccessByAdmin(await platformUser(), formString(formData, "grantId"));
    refresh();
    return success("Destek erişimi kapatıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}
