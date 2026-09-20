"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { formString, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { signupPath } from "./campaign";
import { publicSignup, type SignupResult } from "./public";

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

  if (result.status === "created" && result.passToken) redirect(`/pass/${result.passToken}`);
  const durum = result.status === "existing" ? "kayitli" : result.status === "created" && result.perk === "UNAVAILABLE" ? "ikram-yok" : "tamam";
  redirect(`${signupPath(slug)}/tamam?durum=${durum}`);
}
