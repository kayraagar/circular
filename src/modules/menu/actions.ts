"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { uploadMenuAsset, type UploadedAsset } from "./assets";
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  saveMenuConfig,
  updateCategory,
  updateMenuItem,
} from "./service";

/**
 * QR Menü oluşturucu Server Action'ları.
 * Yetki ve tenant kontrolü servis katmanında (assertCan + tenantId filtresi) yapılır.
 */

const BUILDER_PATH = "/menu";

const CONFIG_FIELDS = [
  "logoAssetId",
  "coverAssetId",
  "legacyLogoUrl",
  "backgroundColor",
  "accentColor",
  "textColor",
  "themeStyle",
  "fontPair",
  "cornerStyle",
  "surfaceStyle",
  "density",
  "headerAlign",
  "priceStyle",
  "tagline",
  "showImages",
  "showDescriptions",
  "showCategoryNav",
  "showFeatured",
] as const;
const CATEGORY_FIELDS = ["name", "description", "order"] as const;
const ITEM_FIELDS = ["categoryId", "name", "description", "price", "imageAssetId", "legacyImage", "isFeatured", "isAvailable", "order"] as const;

const values = (formData: FormData, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, formString(formData, k)]));

/** Rozetler onay kutularından birden fazla değer olarak gelir. */
const itemValues = (formData: FormData) => ({
  ...values(formData, ITEM_FIELDS),
  badges: formData
    .getAll("badges")
    .filter((b): b is string => typeof b === "string")
    .join(","),
});

function firstMessage(error: unknown, fallback: string): string {
  const state = toErrorState(error);
  if (state.status !== "error") return fallback;
  const fieldMessage = state.fieldErrors ? Object.values(state.fieldErrors).flat().find(Boolean) : undefined;
  return fieldMessage ?? state.message;
}

export type UploadResult = { ok: true; asset: UploadedAsset } | { ok: false; message: string };

/** Kırpılmış görseli yükler; ayar veya ürün kaydedilince bağlanır. */
export async function uploadMenuAssetAction(formData: FormData): Promise<UploadResult> {
  try {
    const ctx = await requireServiceContext();
    const asset = await uploadMenuAsset(ctx, { kind: formString(formData, "kind"), file: formData.get("file") });
    return { ok: true, asset };
  } catch (error) {
    return { ok: false, message: firstMessage(error, "Görsel yüklenemedi.") };
  }
}

export async function saveMenuConfigAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const data = values(formData, CONFIG_FIELDS);
  try {
    const ctx = await requireServiceContext();
    const config = await saveMenuConfig(ctx, data);
    revalidatePath(BUILDER_PATH);
    return success("Menü tasarımı kaydedildi.", config);
  } catch (error) {
    return toErrorState(error, data);
  }
}

export async function createCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const data = values(formData, CATEGORY_FIELDS);
  try {
    const ctx = await requireServiceContext();
    const category = await createCategory(ctx, data);
    revalidatePath(BUILDER_PATH);
    return success(`"${category.name}" kategorisi eklendi.`);
  } catch (error) {
    return toErrorState(error, data);
  }
}

export async function updateCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const data = values(formData, CATEGORY_FIELDS);
  try {
    const ctx = await requireServiceContext();
    await updateCategory(ctx, formString(formData, "categoryId"), data);
    revalidatePath(BUILDER_PATH);
    return success("Kategori güncellendi.");
  } catch (error) {
    return toErrorState(error, data);
  }
}

export async function deleteCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    const result = await deleteCategory(ctx, formString(formData, "categoryId"));
    revalidatePath(BUILDER_PATH);
    return success(result.itemCount > 0 ? `Kategori ve ${result.itemCount} ürün silindi.` : "Kategori silindi.");
  } catch (error) {
    return toErrorState(error);
  }
}

export async function createMenuItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const data = itemValues(formData);
  try {
    const ctx = await requireServiceContext();
    const item = await createMenuItem(ctx, data);
    revalidatePath(BUILDER_PATH);
    return success(`"${item.name}" menüye eklendi.`);
  } catch (error) {
    return toErrorState(error, data);
  }
}

export async function updateMenuItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const data = itemValues(formData);
  try {
    const ctx = await requireServiceContext();
    await updateMenuItem(ctx, formString(formData, "itemId"), data);
    revalidatePath(BUILDER_PATH);
    return success("Ürün güncellendi.");
  } catch (error) {
    return toErrorState(error, data);
  }
}

export async function deleteMenuItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireServiceContext();
    await deleteMenuItem(ctx, formString(formData, "itemId"));
    revalidatePath(BUILDER_PATH);
    return success("Ürün silindi.");
  } catch (error) {
    return toErrorState(error);
  }
}
