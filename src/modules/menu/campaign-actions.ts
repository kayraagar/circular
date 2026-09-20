"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { saveMenuCampaign } from "./campaign-service";

const CAMPAIGN_FIELDS = ["isActive", "title", "description", "ctaLabel", "imageAssetId", "perkId", "venueId", "delaySeconds", "privacyUrl"] as const;

export async function saveMenuCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const data = Object.fromEntries(CAMPAIGN_FIELDS.map((k) => [k, formString(formData, k)]));
  try {
    const ctx = await requireServiceContext();
    const campaign = await saveMenuCampaign(ctx, data);
    revalidatePath("/menu");
    return success(campaign.isActive ? "Kampanya popup'ı menüde yayında." : "Kampanya kaydedildi; popup kapalı.", campaign);
  } catch (error) {
    return toErrorState(error, data);
  }
}
