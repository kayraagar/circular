"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, setFlash, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { CHANNEL_LABELS, isOneOf, CHANNELS } from "@/lib/domain";
import { createCustomer, setConsent, setCustomerArchived, updateCustomer } from "./service";

function readCustomerForm(formData: FormData) {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(formString(formData, "tags") || "[]");
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === "string").slice(0, 50);
  } catch {
    tags = [];
  }
  return {
    firstName: formString(formData, "firstName"),
    lastName: formString(formData, "lastName"),
    phone: formString(formData, "phone"),
    email: formString(formData, "email"),
    birthDate: formString(formData, "birthDate"),
    notes: formString(formData, "notes"),
    source: formString(formData, "source") || "MANUAL",
    tags,
    consentChannels: formData.getAll("consentChannels").filter((v): v is string => typeof v === "string"),
    consentNote: formString(formData, "consentNote"),
  };
}

export async function createCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = readCustomerForm(formData);
  let id: string;
  try {
    const ctx = await requireServiceContext();
    const customer = await createCustomer(ctx, values, {
      confirmPossibleDuplicate: formString(formData, "confirmDuplicate") === "1",
    });
    id = customer.id;
  } catch (error) {
    return toErrorState(error, values);
  }
  await setFlash("Müşteri kaydedildi.");
  revalidatePath("/customers");
  redirect(`/customers/${id}`);
}

export async function updateCustomerAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = readCustomerForm(formData);
  try {
    const ctx = await requireServiceContext();
    await updateCustomer(ctx, id, values);
  } catch (error) {
    return toErrorState(error, values);
  }
  await setFlash("Değişiklikler kaydedildi.");
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}`);
}

export async function setArchivedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formString(formData, "customerId");
  const archive = formString(formData, "archive") === "1";
  try {
    const ctx = await requireServiceContext();
    await setCustomerArchived(ctx, id, archive);
  } catch (error) {
    return toErrorState(error);
  }
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return success(archive ? "Müşteri arşivlendi." : "Müşteri arşivden çıkarıldı.");
}

export async function setConsentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const customerId = formString(formData, "customerId");
  const channel = formString(formData, "channel");
  const grant = formString(formData, "grant") === "1";
  const note = formString(formData, "note");
  try {
    const ctx = await requireServiceContext();
    await setConsent(ctx, { customerId, channel, grant, note });
  } catch (error) {
    return toErrorState(error, { note });
  }
  revalidatePath(`/customers/${customerId}`);
  const label = isOneOf(CHANNELS, channel) ? CHANNEL_LABELS[channel] : channel;
  return success(grant ? `${label} izni kaydedildi.` : `${label} izni kaldırıldı.`);
}
