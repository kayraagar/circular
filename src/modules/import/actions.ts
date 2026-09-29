"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { AppError, ValidationError } from "@/lib/errors";
import { MAX_BYTES } from "./csv";
import { previewImport, runImport, type ImportPreview } from "./service";

/**
 * İçe aktarma Server Action'ları.
 * Dosya sunucuda tutulmaz: önizleme ve yazma aynı metinle iki ayrı çağrıda yapılır.
 */

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

function fail(error: unknown): { ok: false; message: string } {
  if (error instanceof ValidationError) return { ok: false, message: Object.values(error.fieldErrors).flat().find(Boolean) ?? error.message };
  if (error instanceof AppError) return { ok: false, message: error.message };
  console.error("[import] beklenmeyen hata", error);
  return { ok: false, message: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin." };
}

export async function previewImportAction(text: string): Promise<Result<ImportPreview>> {
  try {
    if (text.length > MAX_BYTES) return { ok: false, message: "Dosya çok büyük (en fazla 2 MB)." };
    const ctx = await requireServiceContext();
    return { ok: true, data: await previewImport(ctx, text) };
  } catch (error) {
    return fail(error);
  }
}

export async function runImportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const text = formString(formData, "text");
  const consentNote = formString(formData, "consentNote");
  try {
    if (text.length > MAX_BYTES) throw new ValidationError({ file: ["Dosya çok büyük (en fazla 2 MB)."] });
    const ctx = await requireServiceContext();
    const result = await runImport(ctx, text, {
      fillExisting: formString(formData, "fillExisting") === "true",
      consentChannels: formData.getAll("consentChannels").filter((c): c is string => typeof c === "string"),
      consentNote,
    });
    revalidatePath("/customers");
    const parts = [
      `${result.created} kayıt eklendi`,
      result.updated > 0 ? `${result.updated} kayıt tamamlandı` : null,
      result.skipped > 0 ? `${result.skipped} satır atlandı` : null,
      result.invalid > 0 ? `${result.invalid} satır hatalı` : null,
    ].filter(Boolean);
    return success(`${parts.join(", ")}.`, result);
  } catch (error) {
    return toErrorState(error, { consentNote });
  }
}
