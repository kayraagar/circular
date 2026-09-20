"use server";

import { requireServiceContext } from "@/lib/context";
import { AppError } from "@/lib/errors";
import { ask, type AskInput } from "./service";
import type { AssistantAnswer } from "./rules";

/**
 * Asistan Server Action'ı. Yalnızca okur: kayıt değiştirmez, mesaj göndermez.
 * Yetki ve tenant kapsamı servis katmanında uygulanır.
 */

export type AskResult = { ok: true; answer: AssistantAnswer } | { ok: false; message: string };

export async function askAssistantAction(input: AskInput): Promise<AskResult> {
  try {
    const ctx = await requireServiceContext();
    return { ok: true, answer: await ask(ctx, input) };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.message };
    console.error("[assistant] beklenmeyen hata", error);
    return { ok: false, message: "Cevabı hazırlarken bir sorun oldu. Lütfen tekrar deneyin." };
  }
}
