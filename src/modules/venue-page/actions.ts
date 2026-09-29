"use server";

import { redirect } from "next/navigation";
import { formString, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { clientIp } from "@/lib/page";
import { startPhoneVerification } from "@/modules/verification/service";
import { venueSignup, type VenueSignupResult } from "./service";

const FIELDS = ["firstName", "lastName", "phone", "email", "eventId", "partySize"] as const;

/**
 * Mekan sayfasındaki kayıt formu. Etkinliğe kaydolunduysa kişiye özel giriş QR'ına,
 * yalnızca üyelikte bilgi ekranına gidilir.
 */
export async function venueSignupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const slug = formString(formData, "slug");
  const values = Object.fromEntries(FIELDS.map((k) => [k, formString(formData, k)]));
  const consents = formData.getAll("consents").filter((c): c is string => typeof c === "string");

  let result: VenueSignupResult;
  try {
    result = await venueSignup(slug, { ...values, website: formString(formData, "website"), consents }, { ip: await clientIp() });
  } catch (error) {
    return toErrorState(error, { ...values, consents });
  }

  // SMS hesabı bağlıysa numara doğrulaması başlatılır; numara adrese yazılmaz.
  let handle: string | null = null;
  if (result.status === "created" && result.phone) {
    try {
      const started = await startPhoneVerification(result.tenantId, result.phone, { ip: await clientIp() });
      if (started.status === "sent") handle = started.handle;
    } catch (error) {
      console.error("[venue-signup] doğrulama kodu gönderilemedi", error);
    }
  }
  const verify = handle ? `dogrula=${encodeURIComponent(handle)}` : "";

  if (result.status === "created" && result.passToken) redirect(`/pass/${result.passToken}${verify ? `?${verify}` : ""}`);
  const durum = result.status === "existing" ? "kayitli" : "tamam";
  redirect(`/v/${encodeURIComponent(slug)}/tamam?durum=${durum}${verify ? `&${verify}` : ""}`);
}
