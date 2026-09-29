"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { createVenue, setVenueActive, updateVenue } from "./service";

/** Mekan yönetimi Server Action'ları. Yetki ve kilitlenme koruması servis katmanındadır. */

function refresh() {
  revalidatePath("/settings");
  // Mekan filtresi üst barda görünür; menü ve etkinlik ekranları da mekan listesini kullanır.
  revalidatePath("/", "layout");
}

function venueValues(formData: FormData) {
  return {
    name: formString(formData, "name"),
    type: formString(formData, "type"),
    slug: formString(formData, "slug"),
    city: formString(formData, "city"),
    address: formString(formData, "address"),
  };
}

export async function createVenueAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = venueValues(formData);
  try {
    const ctx = await requireServiceContext();
    const venue = await createVenue(ctx, values);
    refresh();
    return success(`${venue.name} eklendi.`, { slug: venue.slug });
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function updateVenueAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = venueValues(formData);
  try {
    const ctx = await requireServiceContext();
    const venue = await updateVenue(ctx, formString(formData, "venueId"), values);
    refresh();
    return success(`${venue.name} güncellendi.`);
  } catch (error) {
    return toErrorState(error, values);
  }
}

export async function setVenueActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    const active = formString(formData, "active") === "true";
    const venue = await setVenueActive(ctx, formString(formData, "venueId"), active);
    refresh();
    return success(active ? `${venue.name} yeniden açıldı.` : `${venue.name} kapatıldı.`);
  } catch (error) {
    return toErrorState(error);
  }
}
