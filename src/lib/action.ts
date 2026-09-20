import "server-only";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { ActionState } from "./action-state";
import { FLASH_COOKIE } from "./auth/constants";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

/** Servis hatasını kullanıcıya gösterilecek form durumuna çevirir. */
export function toErrorState(error: unknown, values?: Record<string, unknown>): ActionState {
  unstable_rethrow(error); // redirect()/notFound() gibi Next.js kontrol akışlarını yutma
  const at = Date.now();
  if (error instanceof ValidationError) {
    return { status: "error", message: error.message, fieldErrors: error.fieldErrors, values, at };
  }
  if (error instanceof ConflictError) {
    return { status: "error", message: error.message, code: error.code, detail: error.detail, values, at };
  }
  if (error instanceof NotFoundError || error instanceof ForbiddenError) {
    return { status: "error", message: error.message, values, at };
  }
  console.error("[action] beklenmeyen hata", error);
  return { status: "error", message: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.", values, at };
}

export function success(message: string, data?: unknown): ActionState {
  return { status: "success", message, data, at: Date.now() };
}

/** Yönlendirme sonrası gösterilecek kısa bildirim (istemci okur ve siler). */
export async function setFlash(message: string) {
  const jar = await cookies();
  jar.set(FLASH_COOKIE, encodeURIComponent(message), { path: "/", maxAge: 20, sameSite: "lax", httpOnly: false });
}

export function formString(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}
