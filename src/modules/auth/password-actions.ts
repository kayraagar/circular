"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, setFlash, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { completePasswordReset, createResetLinkForMember, requestPasswordReset } from "./password-reset";

/** Şifre sıfırlama Server Action'ları. Yetki ve sınırlar servis katmanındadır. */

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

/**
 * Kişinin kendi talebi. Cevap hesabın varlığını açık etmez: adres kayıtlı olsun ya da
 * olmasın aynı mesaj döner.
 */
export async function requestPasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = formString(formData, "email").trim();
  try {
    const { emailConfigured } = await requestPasswordReset({ email }, await clientIp());
    return success(
      emailConfigured
        ? "Bu adres kayıtlıysa şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin."
        : "E-posta gönderimi henüz açık değil. İşletme sahibinden size Ayarlar › Ekip ekranından sıfırlama bağlantısı üretmesini isteyin.",
      { emailConfigured },
    );
  } catch (error) {
    return toErrorState(error, { email });
  }
}

export async function completePasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await completePasswordReset(formString(formData, "token"), {
      password: formString(formData, "password"),
      passwordRepeat: formString(formData, "passwordRepeat"),
    });
  } catch (error) {
    return toErrorState(error);
  }
  await setFlash("Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.");
  redirect("/login");
}

/** Ayarlar › Ekip: işletme sahibi üyeye bağlantı üretir, kendi kanalıyla iletir. */
export async function createResetLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    const link = await createResetLinkForMember(ctx, formString(formData, "membershipId"));
    revalidatePath("/settings");
    return success(`${link.email} için sıfırlama bağlantısı hazır.`, { url: link.url, expiresAt: link.expiresAt.toISOString() });
  } catch (error) {
    return toErrorState(error);
  }
}
