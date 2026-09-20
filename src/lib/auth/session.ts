import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE } from "./constants";

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Oturum oluşturur. Cookie yalnızca rastgele token taşır; DB'de token'ın hash'i durur.
 * DB sızıntısında aktif oturum ele geçirilemez.
 */
export async function createSession(userId: string, activeTenantId: string | null, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, activeTenantId, expiresAt, userAgent: userAgent?.slice(0, 250) },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, email: true, isActive: true, isPlatformAdmin: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function updateSessionScope(sessionId: string, data: { activeTenantId?: string; activeVenueId?: string | null }) {
  await db.session.update({ where: { id: sessionId }, data });
}
