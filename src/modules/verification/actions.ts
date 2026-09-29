"use server";

import { formString, success } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { confirmByHandle } from "./service";

const MESSAGES: Record<string, string> = {
  INVALID: "Kod hatalı. Tekrar deneyin.",
  EXPIRED: "Kodun süresi doldu. Personelden yeni kod isteyebilirsiniz.",
  TOO_MANY: "Çok fazla hatalı deneme yapıldı. Bu kod artık kullanılamaz.",
  NOT_FOUND: "Doğrulama bağlantısı geçersiz.",
};

/** Kişinin kendi numarasını doğrulaması. Oturum gerekmez; kol imzalıdır. */
export async function confirmPhoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await confirmByHandle(formString(formData, "handle"), formString(formData, "code"));
  if (result.ok) return success("Numaranız doğrulandı. Teşekkürler!");
  return { status: "error", message: MESSAGES[result.reason] ?? MESSAGES.NOT_FOUND, fieldErrors: { code: [MESSAGES[result.reason] ?? MESSAGES.NOT_FOUND] }, at: Date.now() };
}
