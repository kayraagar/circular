"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireServiceContext } from "@/lib/context";
import { formString, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { createInviteLink, invitePath, registerViaInvite, type InviteLinkView, type InviteSignupResult } from "./invite";

/** PR: davet linkini oluşturur veya yeniler. */
export async function inviteLinkAction(eventId: string, rotate: boolean): Promise<{ ok: true; data: InviteLinkView } | { ok: false; message: string }> {
  try {
    const ctx = await requireServiceContext();
    const data = await createInviteLink(ctx, eventId, { rotate });
    revalidatePath(`/events/${eventId}/guests`);
    return { ok: true, data };
  } catch (error) {
    const state = toErrorState(error);
    return { ok: false, message: state.status === "error" ? state.message : "Davet linki oluşturulamadı." };
  }
}

const FIELDS = ["firstName", "lastName", "phone", "partySize"] as const;

const DONE_STATUS: Record<Exclude<InviteSignupResult["status"], "created">, string> = {
  registered_existing: "alindi",
  ignored: "alindi",
  duplicate: "kayitli",
  blocked: "olusturulamadi",
};

/** Misafir: davet linkinden kayıt. Yeni kişi kendi giriş QR sayfasına gider. */
export async function inviteSignupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = formString(formData, "code");
  const values = Object.fromEntries(FIELDS.map((k) => [k, formString(formData, k)]));

  let result: InviteSignupResult;
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
    result = await registerViaInvite(code, { ...values, website: formString(formData, "website") }, { ip });
  } catch (error) {
    return toErrorState(error, values);
  }

  if (result.status === "created") redirect(`/pass/${result.passToken}`);
  redirect(`${invitePath(code)}/tamam?durum=${DONE_STATUS[result.status]}`);
}
