"use server";

import { revalidatePath } from "next/cache";
import { getSession, requireServiceContext } from "@/lib/context";
import { formString, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { redeemPerkPass } from "@/modules/perks/service";
import { formatDateTime } from "@/lib/datetime";
import { findPassByToken } from "./internal";
import {
  extendEntryWindow,
  getOrIssueEntryPass,
  manualCheckIn,
  membershipContext,
  redeemEntryPass,
  undoCheckIn,
  type EntryPassResult,
} from "./service";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

function failure(error: unknown): { ok: false; message: string } {
  const state = toErrorState(error);
  return { ok: false, message: state.status === "error" ? state.message : "İşlem tamamlanamadı." };
}

/** Guest listesi: giriş QR'ını getirir / oluşturur / yeniler. */
export async function entryPassAction(registrationId: string, reissue: boolean): Promise<Result<EntryPassResult>> {
  try {
    const ctx = await requireServiceContext();
    const data = await getOrIssueEntryPass(ctx, registrationId, { reissue });
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

/**
 * /q doğrulama sayfası için bağlam: oturumdaki kullanıcının, QR'ın ait olduğu tenant'taki üyeliği.
 * (Aktif işletme farklı olsa bile doğru tenant'ın yetkileri uygulanır; üye değilse "bulunamadı".)
 */
async function staffContextForToken(token: string) {
  const session = await getSession();
  if (!session) throw new ForbiddenError("Oturumunuz sona erdi. Lütfen yeniden giriş yapın.");
  const pass = await findPassByToken(token);
  if (!pass) throw new NotFoundError("QR bulunamadı.");
  const ctx = await membershipContext(session.userId, pass.tenantId);
  if (!ctx) throw new NotFoundError("QR bulunamadı.");
  return ctx;
}

export async function redeemPassAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = formString(formData, "token");
  const purpose = formString(formData, "purpose");
  const admittedCount = formString(formData, "admittedCount");
  try {
    const ctx = await staffContextForToken(token);
    if (purpose === "PERK_REDEMPTION") {
      const result = await redeemPerkPass(ctx, token);
      revalidatePath(`/q/${token}`);
      return success("Avantaj kullanımı onaylandı.", { remaining: result.remaining });
    }
    const checkIn = await redeemEntryPass(ctx, token, { admittedCount });
    revalidatePath(`/q/${token}`);
    return success(`Giriş onaylandı · ${checkIn.admittedCount} kişi`, { admittedCount: checkIn.admittedCount });
  } catch (error) {
    return toErrorState(error, { admittedCount });
  }
}

/** Kapı ekranı: yanlış kaydedilen girişi geri alır (işletme sahibi). */
export async function undoCheckInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const eventId = formString(formData, "eventId");
  try {
    const ctx = await requireServiceContext();
    const result = await undoCheckIn(ctx, formString(formData, "registrationId"));
    revalidatePath(`/door/${eventId}`);
    revalidatePath(`/events/${eventId}`);
    return success(result.passRestored ? "Giriş geri alındı; QR yeniden geçerli." : "Giriş geri alındı.");
  } catch (error) {
    return toErrorState(error);
  }
}

/** Kapı ekranı: giriş penceresini uzatır (geç gelen guest'ler için). */
export async function extendEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const eventId = formString(formData, "eventId");
  try {
    const ctx = await requireServiceContext();
    const result = await extendEntryWindow(ctx, eventId, formString(formData, "minutes"));
    revalidatePath("/door");
    revalidatePath(`/door/${eventId}`);
    revalidatePath(`/events/${eventId}`);
    return success(`Giriş ${formatDateTime(result.closesAt)} saatine kadar açık.`);
  } catch (error) {
    return toErrorState(error);
  }
}

/** Kapı ekranı: QR'sız manuel giriş. */
export async function manualCheckInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const eventId = formString(formData, "eventId");
  const admittedCount = formString(formData, "admittedCount");
  try {
    const ctx = await requireServiceContext();
    const checkIn = await manualCheckIn(ctx, formString(formData, "registrationId"), { admittedCount });
    revalidatePath(`/door/${eventId}`);
    return success(`Giriş kaydedildi · ${checkIn.admittedCount} kişi`);
  } catch (error) {
    return toErrorState(error, { admittedCount });
  }
}
