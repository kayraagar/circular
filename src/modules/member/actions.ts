"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { clientIp } from "@/lib/page";
import { savePreferences } from "@/modules/preferences/service";
import { preferenceToken } from "@/modules/preferences/service";
import { MEMBER_COOKIE, confirmMemberCode, endMemberSession, readMemberSession, requestMemberCode, SESSION_TTL_MS } from "./service";

/**
 * Üyelik alanı Server Action'ları.
 * Oturum cookie'si httpOnly'dir ve hiçbir panel yetkisi vermez.
 */

const CODE_ERRORS: Record<string, string> = {
  INVALID: "Kod hatalı. Tekrar deneyin.",
  EXPIRED: "Kodun süresi doldu. Yeni kod isteyin.",
  TOO_MANY: "Çok fazla hatalı deneme yapıldı. Yeni kod isteyin.",
  NOT_FOUND: "Giriş yapılamadı. Bilgileri kontrol edip yeni kod isteyin.",
};

export async function requestMemberCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identifier = formString(formData, "identifier").trim();
  try {
    const { deliverable } = await requestMemberCode(formString(formData, "slug"), identifier, { ip: await clientIp() });
    return success(
      deliverable
        ? "Kayıtlıysanız tek kullanımlık giriş kodu gönderildi."
        : "Bu mekan henüz kod gönderemiyor (SMS/e-posta servisi bağlı değil). Personelden yardım isteyebilirsiniz.",
      { identifier, deliverable },
    );
  } catch (error) {
    return toErrorState(error, { identifier });
  }
}

export async function confirmMemberCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const slug = formString(formData, "slug");
  const identifier = formString(formData, "identifier");
  const result = await confirmMemberCode(slug, identifier, formString(formData, "code"));
  if (!result.ok) {
    return { status: "error", message: CODE_ERRORS[result.reason] ?? CODE_ERRORS.NOT_FOUND, values: { identifier }, at: Date.now() };
  }
  const jar = await cookies();
  jar.set(MEMBER_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(Date.now() + SESSION_TTL_MS),
  });
  redirect(`/v/${encodeURIComponent(slug)}/uyelik`);
}

export async function memberLogoutAction(formData: FormData) {
  const jar = await cookies();
  await endMemberSession(jar.get(MEMBER_COOKIE)?.value);
  jar.delete(MEMBER_COOKIE);
  redirect(`/v/${encodeURIComponent(formString(formData, "slug"))}/uyelik`);
}

/** Üyelik alanından iletişim tercihlerini kaydeder (tercih merkeziyle aynı servis). */
export async function saveMemberPreferencesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const jar = await cookies();
  const ctx = await readMemberSession(jar.get(MEMBER_COOKIE)?.value);
  if (!ctx) return { status: "error", message: "Oturumunuz sona erdi. Tekrar giriş yapın.", at: Date.now() };
  const channels = formData.getAll("channels").filter((v): v is string => typeof v === "string");
  try {
    const view = await savePreferences(preferenceToken(ctx.customerId), channels);
    if (!view) return { status: "error", message: "Tercihler kaydedilemedi.", at: Date.now() };
    revalidatePath(`/v/${formString(formData, "slug")}/uyelik`);
    const open = view.channels.filter((c) => c.granted).map((c) => c.label);
    return success(open.length > 0 ? `Tercihleriniz kaydedildi: ${open.join(", ")}.` : "Tüm iletişim kanalları kapatıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}
