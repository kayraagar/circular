"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { formString, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { signupPath } from "./campaign";
import { publicSignup, type SignupResult } from "./public";
import { startPhoneVerification } from "@/modules/verification/service";
import { clientIp } from "@/lib/page";

const FIELDS = ["firstName", "lastName", "phone", "email"] as const;

/** Menüden kayıt formu. Başarılı kayıtta avantaj verildiyse kişiye özel QR sayfasına gider. */
export async function publicSignupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const slug = formString(formData, "slug");
  const values = Object.fromEntries(FIELDS.map((k) => [k, formString(formData, k)]));
  const consents = formData.getAll("consents").filter((c): c is string => typeof c === "string");

  let result: SignupResult;
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
    result = await publicSignup(slug, { ...values, website: formString(formData, "website"), consents }, { ip });
  } catch (error) {
    return toErrorState(error, { ...values, consents });
  }

  // Telefon doğrulaması: SMS hesabı bağlıysa kod gönderilir. Numara adrese yazılmaz;
  // yalnızca doğrulama kaydının imzalı kolu taşınır.
  let handle: string | null = null;
  if (result.status === "created" && result.phone) {
    try {
      const started = await startPhoneVerification(result.tenantId, result.phone, { ip: await clientIp() });
      if (started.status === "sent") handle = started.handle;
    } catch (error) {
      // Doğrulama gönderilemezse kayıt yine de geçerlidir; akış kesilmez.
      console.error("[signup] doğrulama kodu gönderilemedi", error);
    }
  }
  const verify = handle ? `dogrula=${encodeURIComponent(handle)}` : "";

  if (result.status === "created" && result.passToken) {
    redirect(`/pass/${result.passToken}${verify ? `?${verify}` : ""}`);
  }
  const durum = result.status === "existing" ? "kayitli" : result.status === "created" && result.perk === "UNAVAILABLE" ? "ikram-yok" : "tamam";
  redirect(`${signupPath(slug)}/tamam?durum=${durum}${verify ? `&${verify}` : ""}`);
}
