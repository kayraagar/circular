"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireServiceContext } from "@/lib/context";
import { createSession } from "@/lib/auth/session";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { homePathForRole } from "@/lib/routes";
import { acceptInvite, changeMemberRole, createInvite, revokeInvite, setMemberStatus, setMemberVenues } from "./service";

/** Ekip yönetimi Server Action'ları. Yetki ve kilitlenme korumaları servis katmanındadır. */

function revalidateSettings() {
  revalidatePath("/settings");
}

export async function inviteMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { name: formString(formData, "name"), email: formString(formData, "email"), role: formString(formData, "role") };
  try {
    const ctx = await requireServiceContext();
    const invite = await createInvite(ctx, { ...values, venueIds: formData.getAll("venueIds").filter((v): v is string => typeof v === "string") });
    revalidateSettings();
    // Bağlantı yalnızca burada gösterilir; veritabanında ham kod tutulmaz.
    return success(`${invite.email} için davet bağlantısı hazır.`, { url: invite.url, expiresAt: invite.expiresAt.toISOString() });
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function revokeInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await revokeInvite(ctx, formString(formData, "inviteId"));
    revalidateSettings();
    return success("Davet iptal edildi.");
  } catch (error) {
    return toErrorState(error);
  }
}

export async function changeRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await changeMemberRole(ctx, formString(formData, "membershipId"), formString(formData, "role"));
    revalidateSettings();
    return success("Rol güncellendi.");
  } catch (error) {
    return toErrorState(error);
  }
}

export async function setMemberStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    const active = formString(formData, "active") === "true";
    await setMemberStatus(ctx, formString(formData, "membershipId"), active);
    revalidateSettings();
    return success(active ? "Erişim yeniden açıldı." : "Erişim kapatıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}

export async function setMemberVenuesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await setMemberVenues(ctx, formString(formData, "membershipId"), formData.getAll("venueIds").filter((v): v is string => typeof v === "string"));
    revalidateSettings();
    return success("Mekan erişimi güncellendi.");
  } catch (error) {
    return toErrorState(error);
  }
}

/** Herkese açık: davet bağlantısını kabul eder, oturum açar ve rolün ana sayfasına gönderir. */
export async function acceptInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let target: string | null = null;
  try {
    const result = await acceptInvite(formString(formData, "token"), { password: formString(formData, "password") });
    const h = await headers();
    await createSession(result.userId, result.tenantId, h.get("user-agent"));
    await db.user.update({ where: { id: result.userId }, data: { lastLoginAt: new Date() } });
    target = homePathForRole(result.role);
  } catch (error) {
    return toErrorState(error);
  }
  redirect(target);
}
