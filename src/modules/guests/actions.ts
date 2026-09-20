"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { addGuestToEvent, getOrIssueGuestPass, type GuestPassResult } from "./service";

/**
 * Misafir ve PR Server Action'ları. Yetki, tenant ve PR kapsamı servis katmanında uygulanır.
 * Okuma işlemleri (getPromoterStats, getEventGuestList) sunucu bileşenlerinden doğrudan servisle yapılır.
 */

const GUEST_FIELDS = ["firstName", "lastName", "phone", "partySize", "note", "source", "promoterMembershipId"] as const;

export async function addGuestToEventAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const eventId = formString(formData, "eventId");
  const values = Object.fromEntries(GUEST_FIELDS.map((k) => [k, formString(formData, k)]));
  try {
    const ctx = await requireServiceContext();
    const result = await addGuestToEvent(ctx, eventId, values);
    revalidatePath(`/events/${eventId}/guests`);
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/workspace");
    return success(result.existingCustomer ? "Misafir eklendi (CRM'de kayıtlı müşteri kullanıldı)." : "Misafir eklendi.");
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function guestPassAction(
  registrationId: string,
  reissue: boolean,
): Promise<{ ok: true; data: GuestPassResult } | { ok: false; message: string }> {
  try {
    const ctx = await requireServiceContext();
    return { ok: true, data: await getOrIssueGuestPass(ctx, registrationId, { reissue }) };
  } catch (error) {
    const state = toErrorState(error);
    return { ok: false, message: state.status === "error" ? state.message : "QR oluşturulamadı." };
  }
}
