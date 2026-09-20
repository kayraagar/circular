"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { AppError, ValidationError } from "@/lib/errors";
import { processCampaign } from "./campaign-service";
import { addEmailTestRecipient, removeEmailTestRecipient, saveEmailSettings, startEmailCampaign, startEmailTest } from "./email-service";
import {
  connectInstagramManually,
  createAutoReply,
  deleteAutoReply,
  disconnectInstagram,
  instagramAuthorizeUrl,
  setAutoReplyActive,
  updateAutoReply,
} from "./instagram-service";
import { connectSms, disconnectSms, refreshSmsStatuses, startSmsCampaign, startSmsTest } from "./sms-service";

/** SMS, e-posta ve Instagram Server Action'ları. Yetki ve tenant kapsamı servis katmanında uygulanır. */

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

function fail(error: unknown): { ok: false; message: string } {
  if (error instanceof ValidationError) return { ok: false, message: Object.values(error.fieldErrors).flat().find(Boolean) ?? error.message };
  if (error instanceof AppError) return { ok: false, message: error.message };
  console.error("[channels] beklenmeyen hata", error);
  return { ok: false, message: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin." };
}

const refresh = () => revalidatePath("/campaigns", "layout");

async function startAndProcess(start: () => Promise<{ id: string }>): Promise<Result<{ campaignId: string }>> {
  try {
    const campaign = await start();
    after(() => processCampaign(campaign.id));
    refresh();
    return { ok: true, data: { campaignId: campaign.id } };
  } catch (error) {
    return fail(error);
  }
}

// ─────────────────────────────────────────────── SMS

export async function connectSmsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { username: formString(formData, "username"), msgheader: formString(formData, "msgheader"), legalFooter: formString(formData, "legalFooter") };
  try {
    const ctx = await requireServiceContext();
    await connectSms(ctx, { ...values, password: formString(formData, "password") });
    refresh();
    return success("Netgsm hesabı kaydedildi.");
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function disconnectSmsAction(): Promise<ActionState> {
  try {
    await disconnectSms(await requireServiceContext());
    refresh();
    return success("SMS hesabının bağlantısı kesildi.");
  } catch (error) {
    return toErrorState(error);
  }
}

export async function sendSmsTestAction(input: { body: string; name?: string }) {
  const ctx = await requireServiceContext().catch(() => null);
  if (!ctx) return fail(new AppError("Oturumunuz sona erdi."));
  return startAndProcess(() => startSmsTest(ctx, input));
}

export async function sendSmsCampaignAction(input: { audience: unknown; body: string; name?: string }) {
  const ctx = await requireServiceContext().catch(() => null);
  if (!ctx) return fail(new AppError("Oturumunuz sona erdi."));
  return startAndProcess(() => startSmsCampaign(ctx, input));
}

export async function refreshSmsStatusesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    const { updated } = await refreshSmsStatuses(ctx, formString(formData, "id"));
    refresh();
    return success(updated ? `${updated} mesajın durumu güncellendi.` : "Netgsm'de yeni durum yok.");
  } catch (error) {
    return toErrorState(error);
  }
}

// ─────────────────────────────────────────────── E-posta

export async function saveEmailSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { senderName: formString(formData, "senderName"), replyTo: formString(formData, "replyTo"), legalFooter: formString(formData, "legalFooter") };
  try {
    const ctx = await requireServiceContext();
    await saveEmailSettings(ctx, values);
    refresh();
    return success("E-posta ayarları kaydedildi.");
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function addEmailTestRecipientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { label: formString(formData, "label"), email: formString(formData, "email") };
  try {
    const ctx = await requireServiceContext();
    await addEmailTestRecipient(ctx, { ...values, confirmed: formString(formData, "confirmed") });
    refresh();
    return success("Test adresi eklendi.");
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function removeEmailTestRecipientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await removeEmailTestRecipient(await requireServiceContext(), formString(formData, "id"));
    refresh();
    return success("Test adresi kaldırıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}

type EmailInput = { subject: string; body: string; ctaLabel?: string; ctaUrl?: string; name?: string };

export async function sendEmailTestAction(input: EmailInput) {
  const ctx = await requireServiceContext().catch(() => null);
  if (!ctx) return fail(new AppError("Oturumunuz sona erdi."));
  return startAndProcess(() => startEmailTest(ctx, input));
}

export async function sendEmailCampaignAction(input: EmailInput & { audience: unknown }) {
  const ctx = await requireServiceContext().catch(() => null);
  if (!ctx) return fail(new AppError("Oturumunuz sona erdi."));
  return startAndProcess(() => startEmailCampaign(ctx, input));
}

// ─────────────────────────────────────────────── Instagram

export async function startInstagramConnectAction(): Promise<ActionState> {
  let url: string;
  try {
    url = await instagramAuthorizeUrl(await requireServiceContext());
  } catch (error) {
    return toErrorState(error);
  }
  redirect(url);
}

export async function connectInstagramManualAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    const account = await connectInstagramManually(ctx, { accessToken: formString(formData, "accessToken") });
    refresh();
    return success(`@${account.username} bağlandı.`);
  } catch (error) {
    return toErrorState(error);
  }
}

export async function disconnectInstagramAction(): Promise<ActionState> {
  try {
    await disconnectInstagram(await requireServiceContext());
    refresh();
    return success("Instagram bağlantısı kesildi.");
  } catch (error) {
    return toErrorState(error);
  }
}

const RULE_FIELDS = ["keywords", "matchType", "replyText"] as const;

export async function saveAutoReplyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = Object.fromEntries(RULE_FIELDS.map((k) => [k, formString(formData, k)]));
  const id = formString(formData, "id");
  try {
    const ctx = await requireServiceContext();
    if (id) await updateAutoReply(ctx, id, values);
    else await createAutoReply(ctx, values);
    refresh();
    return success(id ? "Kural güncellendi." : "Otomatik yanıt eklendi.");
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function toggleAutoReplyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const active = formString(formData, "active") === "1";
  try {
    await setAutoReplyActive(await requireServiceContext(), formString(formData, "id"), active);
    refresh();
    return success(active ? "Kural açıldı." : "Kural kapatıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}

export async function deleteAutoReplyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await deleteAutoReply(await requireServiceContext(), formString(formData, "id"));
    refresh();
    return success("Kural silindi.");
  } catch (error) {
    return toErrorState(error);
  }
}
