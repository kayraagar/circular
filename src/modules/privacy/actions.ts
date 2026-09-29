"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, setFlash, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { anonymizeCustomer, deleteCustomerPermanently } from "./service";
import { createDataRequest, resolveDataRequest } from "./requests";

/**
 * KVKK ilgili kişi hakları Server Action'ları.
 * Anonimleştirme ve kalıcı silme geri alınamaz; onay arayüzde alınır, yetki servistedir.
 */

function revalidatePrivacy(customerId?: string) {
  revalidatePath("/kvkk");
  revalidatePath("/customers");
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function anonymizeCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const customerId = formString(formData, "customerId");
  try {
    const ctx = await requireServiceContext();
    await anonymizeCustomer(ctx, customerId);
  } catch (error) {
    return toErrorState(error);
  }
  revalidatePrivacy(customerId);
  await setFlash("Kayıt anonimleştirildi. Kimlik ve iletişim bilgileri kalıcı olarak silindi.");
  redirect(`/customers/${customerId}`);
}

export async function deleteCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const customerId = formString(formData, "customerId");
  try {
    const ctx = await requireServiceContext();
    await deleteCustomerPermanently(ctx, customerId);
  } catch (error) {
    return toErrorState(error);
  }
  revalidatePrivacy();
  await setFlash("Müşteri kaydı kalıcı olarak silindi.");
  redirect("/customers");
}

export async function createDataRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = {
    applicantName: formString(formData, "applicantName"),
    contact: formString(formData, "contact"),
    kind: formString(formData, "kind"),
    channel: formString(formData, "channel"),
    note: formString(formData, "note"),
    receivedOn: formString(formData, "receivedOn"),
    customerId: formString(formData, "customerId"),
  };
  try {
    const ctx = await requireServiceContext();
    await createDataRequest(ctx, values);
    revalidatePrivacy();
    return success("Başvuru kaydedildi. Cevap süresi 30 gündür.");
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function resolveDataRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await resolveDataRequest(ctx, formString(formData, "requestId"), {
      status: formString(formData, "status"),
      resolution: formString(formData, "resolution"),
    });
    revalidatePrivacy();
    return success("Başvuru sonuçlandırıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}
