import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanText, normalizeEmail } from "@/lib/normalize";
import { isOneOf, ROLES, ROLE_LABELS, labelOf, type Role } from "@/lib/domain";
import { createRateLimiter } from "@/lib/rate-limit";
import { absoluteUrl } from "@/modules/passes/token";
import { logActivity } from "@/modules/activity/service";

/**
 * Ekip yönetimi.
 *
 * Davet akışı e-posta göndermez: işletme sahibi tek kullanımlık bir link üretir ve kendi
 * kanalıyla iletir. Linkin ham kodu veritabanında saklanmaz (yalnızca SHA-256 özeti);
 * kod 256 bit rastgeledir, süresi dolar ve bir kez kullanılır.
 *
 * Kilitlenme koruması: işletmede her zaman en az bir aktif sahip kalır. Kullanıcı kendi
 * rolünü değiştiremez ve kendi erişimini kapatamaz.
 */

export const INVITE_TTL_DAYS = 7;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function invitePath(token: string) {
  return `/ekip/${token}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Davet linkini deneyerek şifre kırmayı engeller (mevcut hesaplarda şifre sorulur). */
const acceptLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 8 });
export function resetTeamRateLimit() {
  acceptLimiter.reset();
}

// ─────────────────────────────────────────────── Okuma

export type TeamMember = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  isSelf: boolean;
  lastLoginAt: Date | null;
  venueIds: string[];
  venueNames: string[];
};

export type PendingInvite = {
  id: string;
  name: string;
  email: string;
  role: Role;
  venueNames: string[];
  expiresAt: Date;
  expired: boolean;
  createdAt: Date;
};

export async function getTeam(ctx: ServiceContext, now = new Date()) {
  assertCan(ctx, "team.manage");
  const [members, invites, venues] = await Promise.all([
    db.membership.findMany({
      where: { tenantId: ctx.tenantId },
      include: { user: { select: { name: true, email: true, lastLoginAt: true } }, venueAccess: { include: { venue: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    db.teamInvite.findMany({
      where: { tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    db.venue.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const venueName = new Map(venues.map((v) => [v.id, v.name]));

  return {
    venues,
    members: members
      .filter((m) => isOneOf(ROLES, m.role))
      .map<TeamMember>((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role as Role,
        active: m.status === "ACTIVE",
        isSelf: m.id === ctx.membershipId,
        lastLoginAt: m.user.lastLoginAt,
        venueIds: m.venueAccess.map((v) => v.venue.id),
        venueNames: m.venueAccess.map((v) => v.venue.name),
      })),
    invites: invites
      .filter((i) => isOneOf(ROLES, i.role))
      .map<PendingInvite>((i) => ({
        id: i.id,
        name: i.name,
        email: i.email,
        role: i.role as Role,
        venueNames: i.venueIds.map((id) => venueName.get(id) ?? "—"),
        expiresAt: i.expiresAt,
        expired: i.expiresAt < now,
        createdAt: i.createdAt,
      })),
  };
}

// ─────────────────────────────────────────────── Ortak doğrulamalar

async function findMembership(ctx: ServiceContext, membershipId: string) {
  const membership = await db.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenantId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!membership) throw new NotFoundError("Ekip üyesi bulunamadı.");
  return membership;
}

/** İşletmede en az bir aktif sahip kalmalı; aksi halde kimse ayarlara giremez. */
async function assertNotLastOwner(tenantId: string, membershipId: string) {
  const others = await db.membership.count({
    where: { tenantId, role: "OWNER_ADMIN", status: "ACTIVE", id: { not: membershipId } },
  });
  if (others === 0) throw new ConflictError("İşletmede en az bir aktif sahip kalmalı.", "LAST_OWNER");
}

async function validVenueIds(tenantId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const found = await db.venue.findMany({ where: { tenantId, id: { in: unique } }, select: { id: true } });
  if (found.length !== unique.length) throw new ValidationError({ venueIds: ["Seçilen mekanlardan biri bu işletmeye ait değil."] });
  return found.map((v) => v.id);
}

// ─────────────────────────────────────────────── Davet

const inviteSchema = z.object({
  name: z.string().trim().min(2, "Ad soyad yazın.").max(80, "Ad en fazla 80 karakter olabilir."),
  email: z.email("Geçerli bir e-posta adresi girin.").max(254),
  role: z.string().trim(),
  venueIds: z.array(z.string()).default([]),
});

export type InviteCreated = { id: string; email: string; url: string; expiresAt: Date };

export async function createInvite(ctx: ServiceContext, raw: unknown, now = new Date()): Promise<InviteCreated> {
  assertCan(ctx, "team.manage");
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const { role } = parsed.data;
  if (!isOneOf(ROLES, role)) throw new ValidationError({ role: ["Geçerli bir rol seçin."] });
  const email = normalizeEmail(parsed.data.email);
  if (!email) throw new ValidationError({ email: ["Geçerli bir e-posta adresi girin."] });
  const name = cleanText(parsed.data.name);
  const venueIds = await validVenueIds(ctx.tenantId, parsed.data.venueIds);

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    const member = await db.membership.findUnique({ where: { userId_tenantId: { userId: existing.id, tenantId: ctx.tenantId } } });
    if (member) throw new ConflictError("Bu e-posta zaten ekipte.", "ALREADY_MEMBER");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 3600 * 1000);

  const invite = await db.$transaction(async (tx) => {
    // Aynı kişiye yeni link üretilince eskisi geçersizleşir.
    await tx.teamInvite.updateMany({
      where: { tenantId: ctx.tenantId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const created = await tx.teamInvite.create({
      data: { tenantId: ctx.tenantId, email, name, role, venueIds, tokenHash: hashToken(token), invitedByUserId: ctx.userId, expiresAt },
    });
    await logActivity(tx, ctx, {
      action: "team.invited",
      entityType: "team_invite",
      entityId: created.id,
      metadata: { email, name, role, roleLabel: labelOf(ROLE_LABELS, role) },
    });
    return created;
  });

  return { id: invite.id, email, url: absoluteUrl(invitePath(token)), expiresAt };
}

export async function revokeInvite(ctx: ServiceContext, inviteId: string, now = new Date()) {
  assertCan(ctx, "team.manage");
  const invite = await db.teamInvite.findFirst({ where: { id: inviteId, tenantId: ctx.tenantId } });
  if (!invite) throw new NotFoundError("Davet bulunamadı.");
  if (invite.acceptedAt) throw new ConflictError("Bu davet zaten kullanıldı.", "ALREADY_ACCEPTED");
  await db.$transaction(async (tx) => {
    await tx.teamInvite.update({ where: { id: invite.id }, data: { revokedAt: now } });
    await logActivity(tx, ctx, { action: "team.invite_revoked", entityType: "team_invite", entityId: invite.id, metadata: { email: invite.email } });
  });
}

// ─────────────────────────────────────────────── Üyelik düzenleme

export async function changeMemberRole(ctx: ServiceContext, membershipId: string, role: string) {
  assertCan(ctx, "team.manage");
  if (!isOneOf(ROLES, role)) throw new ValidationError({ role: ["Geçerli bir rol seçin."] });
  const membership = await findMembership(ctx, membershipId);
  if (membership.id === ctx.membershipId) throw new ForbiddenError("Kendi rolünüzü değiştiremezsiniz.");
  if (membership.role === "OWNER_ADMIN" && role !== "OWNER_ADMIN") await assertNotLastOwner(ctx.tenantId, membership.id);
  if (membership.role === role) return;

  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: membership.id }, data: { role } });
    await logActivity(tx, ctx, {
      action: "team.role_changed",
      entityType: "membership",
      entityId: membership.id,
      metadata: { name: membership.user.name, email: membership.user.email, role, roleLabel: labelOf(ROLE_LABELS, role) },
    });
  });
}

export async function setMemberStatus(ctx: ServiceContext, membershipId: string, active: boolean) {
  assertCan(ctx, "team.manage");
  const membership = await findMembership(ctx, membershipId);
  if (membership.id === ctx.membershipId) throw new ForbiddenError("Kendi erişiminizi kapatamazsınız.");
  if (!active && membership.role === "OWNER_ADMIN") await assertNotLastOwner(ctx.tenantId, membership.id);
  const status = active ? "ACTIVE" : "DISABLED";
  if (membership.status === status) return;

  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: membership.id }, data: { status } });
    // Erişim kapatılınca açık oturumlar da düşsün (her istekte üyelik doğrulanır, bu ek güvencedir).
    if (!active) await tx.session.deleteMany({ where: { userId: membership.userId } });
    await logActivity(tx, ctx, {
      action: "team.status_changed",
      entityType: "membership",
      entityId: membership.id,
      metadata: { name: membership.user.name, email: membership.user.email, status },
    });
  });
}

export async function setMemberVenues(ctx: ServiceContext, membershipId: string, venueIds: string[]) {
  assertCan(ctx, "team.manage");
  const membership = await findMembership(ctx, membershipId);
  const valid = await validVenueIds(ctx.tenantId, venueIds);
  const names = valid.length
    ? (await db.venue.findMany({ where: { id: { in: valid } }, select: { name: true }, orderBy: { name: "asc" } })).map((v) => v.name)
    : [];

  await db.$transaction(async (tx) => {
    await tx.membershipVenue.deleteMany({ where: { membershipId: membership.id } });
    if (valid.length > 0) {
      await tx.membershipVenue.createMany({ data: valid.map((venueId) => ({ membershipId: membership.id, venueId, tenantId: ctx.tenantId })) });
    }
    await logActivity(tx, ctx, {
      action: "team.venues_changed",
      entityType: "membership",
      entityId: membership.id,
      metadata: { name: membership.user.name, venues: names.length > 0 ? names.join(", ") : "tüm mekanlar" },
    });
  });
}

// ─────────────────────────────────────────────── Daveti kabul etme (herkese açık)

export type InviteView = {
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  tenantName: string;
  venueNames: string[];
  /** Bu e-postayla hesap varsa kişi mevcut şifresiyle katılır. */
  hasAccount: boolean;
  expiresAt: Date;
};

async function loadInvite(token: string, now: Date) {
  if (!TOKEN_RE.test(token)) throw new NotFoundError("Davet bağlantısı geçersiz.");
  const invite = await db.teamInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { tenant: { select: { name: true, status: true } } },
  });
  if (!invite || invite.revokedAt) throw new NotFoundError("Davet bağlantısı geçersiz veya iptal edilmiş.");
  if (invite.acceptedAt) throw new ConflictError("Bu davet daha önce kullanıldı.", "ALREADY_ACCEPTED");
  if (invite.expiresAt < now) throw new ConflictError("Davetin süresi dolmuş. İşletme sahibinden yeni bağlantı isteyin.", "EXPIRED");
  if (invite.tenant.status !== "ACTIVE") throw new ConflictError("İşletme şu anda aktif değil.", "TENANT_INACTIVE");
  if (!isOneOf(ROLES, invite.role)) throw new NotFoundError("Davet bağlantısı geçersiz.");
  return invite;
}

export async function readInvite(token: string, now = new Date()): Promise<InviteView> {
  const invite = await loadInvite(token, now);
  const user = await db.user.findUnique({ where: { email: invite.email }, select: { id: true } });
  const venues = invite.venueIds.length
    ? (await db.venue.findMany({ where: { id: { in: invite.venueIds } }, select: { name: true }, orderBy: { name: "asc" } })).map((v) => v.name)
    : [];
  return {
    name: invite.name,
    email: invite.email,
    role: invite.role as Role,
    roleLabel: labelOf(ROLE_LABELS, invite.role),
    tenantName: invite.tenant.name,
    venueNames: venues,
    hasAccount: Boolean(user),
    expiresAt: invite.expiresAt,
  };
}

const acceptSchema = z.object({ password: z.string().min(1, "Şifre gerekli.").max(200) });
const MIN_PASSWORD = 10;

export type AcceptResult = { userId: string; tenantId: string; role: Role };

export async function acceptInvite(token: string, raw: unknown, now = new Date()): Promise<AcceptResult> {
  const invite = await loadInvite(token, now);
  const limit = acceptLimiter.hit(invite.tokenHash, now.getTime());
  if (!limit.allowed) throw new ConflictError("Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.", "RATE_LIMITED");

  const parsed = acceptSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(z.flattenError(parsed.error).fieldErrors);
  const password = parsed.data.password;

  const existing = await db.user.findUnique({ where: { email: invite.email } });
  if (existing) {
    // Hesabı olan kişi mevcut şifresiyle katılır; davet linki tek başına erişim vermez.
    if (!existing.isActive || !(await verifyPassword(password, existing.passwordHash))) {
      throw new ValidationError({ password: ["E-posta veya şifre hatalı."] });
    }
  } else if (password.length < MIN_PASSWORD) {
    throw new ValidationError({ password: [`Şifre en az ${MIN_PASSWORD} karakter olmalı.`] });
  }

  const role = invite.role as Role;
  const result = await db.$transaction(async (tx) => {
    const user =
      existing ??
      (await tx.user.create({ data: { email: invite.email, name: invite.name, passwordHash: await hashPassword(password) } }));

    const membership = await tx.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId: invite.tenantId } },
      create: { userId: user.id, tenantId: invite.tenantId, role, status: "ACTIVE" },
      update: { role, status: "ACTIVE" },
    });

    await tx.membershipVenue.deleteMany({ where: { membershipId: membership.id } });
    if (invite.venueIds.length > 0) {
      const venues = await tx.venue.findMany({ where: { tenantId: invite.tenantId, id: { in: invite.venueIds } }, select: { id: true } });
      if (venues.length > 0) {
        await tx.membershipVenue.createMany({ data: venues.map((v) => ({ membershipId: membership.id, venueId: v.id, tenantId: invite.tenantId })) });
      }
    }

    await tx.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: now, acceptedUserId: user.id } });
    await logActivity(tx, { tenantId: invite.tenantId, userId: user.id }, {
      action: "team.joined",
      entityType: "membership",
      entityId: membership.id,
      metadata: { name: user.name, email: user.email, role, roleLabel: labelOf(ROLE_LABELS, role) },
    });
    return { userId: user.id, tenantId: invite.tenantId, role };
  });

  acceptLimiter.reset(invite.tokenHash);
  return result;
}
