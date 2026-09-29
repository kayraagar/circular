"use server";

import { revalidatePath } from "next/cache";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { savePreferences } from "@/modules/preferences/service";

/** Tercih merkezi kaydı. Kişinin kendi işlemidir; oturum gerekmez, bağlantı imzalıdır. */
export async function savePreferencesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = formString(formData, "token");
  const channels = formData.getAll("channels").filter((v): v is string => typeof v === "string");
  try {
    const view = await savePreferences(token, channels);
    if (!view) return { status: "error", message: "Bağlantı geçersiz.", at: Date.now() };
    revalidatePath(`/tercih/${token}`);
    const open = view.channels.filter((c) => c.granted).map((c) => c.label);
    return success(open.length > 0 ? `Tercihleriniz kaydedildi: ${open.join(", ")}.` : "Tüm iletişim kanalları kapatıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}
