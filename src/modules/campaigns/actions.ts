"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/errors";
import { addTestRecipient, completeEmbeddedSignup, connectWhatsAppManually, disconnectWhatsApp, removeTestRecipient } from "./accounts";
import { searchAudienceCustomers, type AudienceSearchRow } from "./audience";
import { assertCanResume, previewCampaign, processCampaign, startLiveCampaign, startTestCampaign, type CampaignPreview } from "./campaign-service";
import { createTemplate, refreshTemplateStatus } from "./templates";

/** Kampanya Server Action'ları. Yetki ve tenant kapsamı servis katmanında uygulanır. */

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

function fail(error: unknown): { ok: false; message: string } {
  if (error instanceof AppError) return { ok: false, message: error.message };
  console.error("[campaigns] beklenmeyen hata", error);
  return { ok: false, message: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin." };
}

function revalidateCampaigns() {
  revalidatePath("/campaigns", "layout");
}

// ─────────────────────────────────────────────── WhatsApp bağlantısı

export async function connectManualAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { wabaId: formString(formData, "wabaId"), phoneNumberId: formString(formData, "phoneNumberId") };
  try {
    const ctx = await requireServiceContext();
    const account = await connectWhatsAppManually(ctx, { ...values, accessToken: formString(formData, "accessToken") });
    revalidateCampaigns();
    return success(`${account.displayPhoneNumber} bağlandı.`);
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function completeEmbeddedSignupAction(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<Result<{ displayPhoneNumber: string }>> {
  try {
    const ctx = await requireServiceContext();
    const account = await completeEmbeddedSignup(ctx, input);
    revalidateCampaigns();
    return { ok: true, data: { displayPhoneNumber: account.displayPhoneNumber } };
  } catch (error) {
    return fail(error);
  }
}

export async function disconnectWhatsAppAction(): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await disconnectWhatsApp(ctx);
    revalidateCampaigns();
    return success("WhatsApp bağlantısı kesildi.");
  } catch (error) {
    return toErrorState(error);
  }
}

export async function addTestRecipientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { label: formString(formData, "label"), phone: formString(formData, "phone") };
  try {
    const ctx = await requireServiceContext();
    await addTestRecipient(ctx, { ...values, confirmed: formString(formData, "confirmed") });
    revalidateCampaigns();
    return success("Test numarası eklendi.");
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function removeTestRecipientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await removeTestRecipient(ctx, formString(formData, "id"));
    revalidateCampaigns();
    return success("Test numarası kaldırıldı.");
  } catch (error) {
    return toErrorState(error);
  }
}

// ─────────────────────────────────────────────── Şablonlar

const TEMPLATE_FIELDS = ["name", "headerText", "bodyText", "footerText", "optOutLabel"] as const;

export async function createTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = Object.fromEntries(TEMPLATE_FIELDS.map((k) => [k, formString(formData, k)]));
  try {
    const ctx = await requireServiceContext();
    const template = await createTemplate(ctx, values);
    revalidateCampaigns();
    return success(template.status === "APPROVED" ? "Şablon Meta tarafından onaylandı." : "Şablon Meta onayına gönderildi.", { id: template.id });
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function refreshTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await refreshTemplateStatus(ctx, formString(formData, "id"));
    revalidateCampaigns();
    return success("Şablon durumu güncellendi.");
  } catch (error) {
    return toErrorState(error);
  }
}

// ─────────────────────────────────────────────── Kampanya

export async function previewCampaignAction(input: { audience: unknown; channel?: string }): Promise<Result<CampaignPreview>> {
  try {
    const ctx = await requireServiceContext();
    return { ok: true, data: await previewCampaign(ctx, input) };
  } catch (error) {
    return fail(error);
  }
}

export async function searchAudienceAction(q: string, channel?: string): Promise<Result<AudienceSearchRow[]>> {
  try {
    const ctx = await requireServiceContext();
    const ch = channel === "SMS" || channel === "EMAIL" ? channel : "WHATSAPP";
    return { ok: true, data: await searchAudienceCustomers(ctx, String(q ?? "").slice(0, 100), ch) };
  } catch (error) {
    return fail(error);
  }
}

export async function sendTestCampaignAction(input: { templateId: string; name?: string }): Promise<Result<{ campaignId: string }>> {
  try {
    const ctx = await requireServiceContext();
    const campaign = await startTestCampaign(ctx, input);
    after(() => processCampaign(campaign.id));
    revalidateCampaigns();
    return { ok: true, data: { campaignId: campaign.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function sendLiveCampaignAction(input: { templateId: string; audience: unknown; name?: string }): Promise<Result<{ campaignId: string }>> {
  try {
    const ctx = await requireServiceContext();
    const campaign = await startLiveCampaign(ctx, input);
    after(() => processCampaign(campaign.id));
    revalidateCampaigns();
    return { ok: true, data: { campaignId: campaign.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function resumeCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    const campaign = await assertCanResume(ctx, formString(formData, "id"));
    after(() => processCampaign(campaign.id));
    revalidateCampaigns();
    return success("Sıradaki mesajların gönderimi başladı.");
  } catch (error) {
    return toErrorState(error);
  }
}
