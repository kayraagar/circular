"use server";

import { requireServiceContext } from "@/lib/context";
import { assertCan, can } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { ask, type AskInput } from "./service";
import { toolByName, type ToolResult } from "./tools";
import type { AssistantAnswer } from "./rules";

/**
 * Asistan Server Action'ları. Soru sorma salt okunurdur; işlem çalıştırma yalnızca
 * asistanın önerdiği araçlarla ve kullanıcının kendi yetkisiyle yapılır.
 * Yetki, doğrulama ve tenant kapsamı servis katmanında uygulanır.
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

/** Onay kutusundaki işlemi çalıştırır. Yetki ve doğrulama yine servis katmanında yapılır. */
export async function runAssistantToolAction(input: { tool: string; args: Record<string, unknown> }): Promise<ToolResult> {
  try {
    const ctx = await requireServiceContext();
    assertCan(ctx, "assistant.use");
    const tool = toolByName(input.tool);
    if (!tool) return { ok: false, message: "Bu işlem tanınmıyor." };
    if (!can(ctx.role, tool.permission)) return { ok: false, message: "Bu işlem için yetkiniz yok." };
    return await tool.run(ctx, input.args ?? {}, new Date());
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.message };
    console.error("[assistant] işlem hatası", error);
    return { ok: false, message: "İşlem tamamlanamadı. Lütfen tekrar deneyin." };
  }
}
