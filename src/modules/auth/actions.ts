"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, updateSessionScope } from "@/lib/auth/session";
import { checkLoginRateLimit, clearLoginAttempts, recordFailedLogin } from "@/lib/auth/rate-limit";
import { getAppContext } from "@/lib/context";
import { formString } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { isOneOf, ROLES } from "@/lib/domain";
import { homePathForRole, safeNextPath } from "@/lib/routes";

const loginSchema = z.object({
  email: z.email("Geçerli bir e-posta adresi girin.").max(254),
  password: z.string().min(1, "Şifre gerekli.").max(200),
});

const GENERIC_FAILURE = "E-posta veya şifre hatalı.";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = formString(formData, "email").trim().toLowerCase();
  const values = { email };
  const parsed = loginSchema.safeParse({ email, password: formString(formData, "password") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Lütfen alanları kontrol edin.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values,
      at: Date.now(),
    };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const key = `${ip}|${email}`;
  const limit = checkLoginRateLimit(key);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSec / 60));
    return { status: "error", message: `Çok fazla deneme yapıldı. ${minutes} dakika sonra tekrar deneyin.`, values, at: Date.now() };
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    await burnPasswordCheck(parsed.data.password);
    recordFailedLogin(key);
    return { status: "error", message: GENERIC_FAILURE, values, at: Date.now() };
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    recordFailedLogin(key);
    return { status: "error", message: GENERIC_FAILURE, values, at: Date.now() };
  }
  clearLoginAttempts(key);

  const membership = await db.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE", tenant: { status: "ACTIVE" } },
    orderBy: { createdAt: "asc" },
  });
  await createSession(user.id, membership?.tenantId ?? null, h.get("user-agent"));
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const next = safeNextPath(formString(formData, "next"));
  if (!membership || !isOneOf(ROLES, membership.role)) redirect("/no-access");
  redirect(next ?? homePathForRole(membership.role));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/** Aktif işletmeyi değiştirir. Üyelik sunucuda doğrulanır; mekan seçimi sıfırlanır. */
export async function switchTenantAction(formData: FormData) {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  const tenantId = formString(formData, "tenantId");
  const target = ctx.memberships.find((m) => m.tenantId === tenantId);
  if (!target) redirect(homePathForRole(ctx.membership.role));
  await updateSessionScope(ctx.sessionId, { activeTenantId: target.tenantId, activeVenueId: null });
  revalidatePath("/", "layout");
  redirect(homePathForRole(target.role));
}

/** Aktif mekan filtresi (boş = tüm mekanlar). Mekan, aktif tenant'ta ve erişilebilir olmalı. */
export async function switchVenueAction(formData: FormData) {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  const venueId = formString(formData, "venueId");
  const valid = venueId === "" || ctx.venues.some((v) => v.id === venueId);
  if (valid) await updateSessionScope(ctx.sessionId, { activeVenueId: venueId || null });
  revalidatePath("/", "layout");
}
