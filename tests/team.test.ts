import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  getTeam,
  readInvite,
  resetTeamRateLimit,
  revokeInvite,
  setMemberStatus,
  setMemberVenues,
} from "@/modules/team/service";
import { makeTenant, resetDb } from "./helpers";

/**
 * Ekip yönetimi: davet bağlantısı, rol değiştirme, mekan erişimi ve kilitlenme koruması.
 * Davet e-posta göndermez; bağlantının kendisi tek kullanımlık yetkidir.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
const NOW = new Date("2026-10-15T18:00:00.000Z");
const tokenOf = (url: string) => url.split("/ekip/")[1];

before(async () => {
  await resetDb();
  A = await makeTenant("ka");
  B = await makeTenant("kb");
});

beforeEach(() => {
  resetTeamRateLimit();
});

after(async () => {
  await db.$disconnect();
});

describe("Ekip yönetimi", () => {
  test("yetki: yalnızca işletme sahibi ekibi yönetir", async () => {
    await assert.rejects(getTeam(A.crm), ForbiddenError);
    await assert.rejects(getTeam(A.pr), ForbiddenError);
    await assert.rejects(createInvite(A.crm, { name: "Yeni Kişi", email: "yeni@ornek.test", role: "DOOR" }, NOW), ForbiddenError);
    assert.ok(await getTeam(A.owner));
  });

  test("davet: bağlantı üretilir, ham kod saklanmaz, kişi kendi şifresini belirler", async () => {
    const invite = await createInvite(A.owner, { name: "Kapı Görevlisi", email: "Kapi.Yeni@Ornek.test", role: "DOOR" }, NOW);
    assert.match(invite.url, /\/ekip\/[A-Za-z0-9_-]{43}$/);
    assert.equal(invite.email, "kapi.yeni@ornek.test", "e-posta küçük harfe normalize edilir");

    const token = tokenOf(invite.url);
    const stored = await db.teamInvite.findFirstOrThrow({ where: { tenantId: A.tenant.id } });
    assert.ok(!stored.tokenHash.includes(token), "ham kod veritabanında tutulmaz");

    const view = await readInvite(token, NOW);
    assert.deepEqual([view.role, view.hasAccount, view.tenantName], ["DOOR", false, A.tenant.name]);

    await assert.rejects(acceptInvite(token, { password: "kisa" }, NOW), ValidationError);
    const accepted = await acceptInvite(token, { password: "cokGizliSifre1" }, NOW);
    assert.equal(accepted.role, "DOOR");

    const user = await db.user.findUniqueOrThrow({ where: { email: "kapi.yeni@ornek.test" } });
    assert.equal(await verifyPassword("cokGizliSifre1", user.passwordHash), true);
    const membership = await db.membership.findFirstOrThrow({ where: { userId: user.id, tenantId: A.tenant.id } });
    assert.deepEqual([membership.role, membership.status], ["DOOR", "ACTIVE"]);

    // Tek kullanımlık: aynı bağlantı ikinci kez çalışmaz
    await assert.rejects(acceptInvite(token, { password: "cokGizliSifre1" }, NOW), ConflictError);
  });

  test("davet: süresi dolan ve iptal edilen bağlantı çalışmaz", async () => {
    const expired = await createInvite(A.owner, { name: "Geç Kalan", email: "gec@ornek.test", role: "WAITER" }, NOW);
    const later = new Date(NOW.getTime() + 8 * 24 * 3600 * 1000);
    await assert.rejects(readInvite(tokenOf(expired.url), later), ConflictError);

    const revoked = await createInvite(A.owner, { name: "Vazgeçilen", email: "vazgec@ornek.test", role: "WAITER" }, NOW);
    const pending = await db.teamInvite.findFirstOrThrow({ where: { email: "vazgec@ornek.test" } });
    await revokeInvite(A.owner, pending.id, NOW);
    await assert.rejects(readInvite(tokenOf(revoked.url), NOW), NotFoundError);

    // Aynı kişiye yeni davet üretilince eskisi geçersizleşir
    const first = await createInvite(A.owner, { name: "Tekrar", email: "tekrar@ornek.test", role: "PR" }, NOW);
    const second = await createInvite(A.owner, { name: "Tekrar", email: "tekrar@ornek.test", role: "PR" }, NOW);
    await assert.rejects(readInvite(tokenOf(first.url), NOW), NotFoundError);
    assert.ok(await readInvite(tokenOf(second.url), NOW));
  });

  test("davet: hesabı olan kişi mevcut şifresiyle katılır, yanlış şifreyle katılamaz", async () => {
    // B işletmesinin sahibi, A işletmesine CRM yöneticisi olarak davet ediliyor
    const existing = await db.user.findUniqueOrThrow({ where: { id: B.owner.userId } });
    await db.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword("mevcutSifre123") } });

    const invite = await createInvite(A.owner, { name: existing.name, email: existing.email, role: "CRM_MANAGER" }, NOW);
    const token = tokenOf(invite.url);
    assert.equal((await readInvite(token, NOW)).hasAccount, true);

    await assert.rejects(acceptInvite(token, { password: "yanlisSifre999" }, NOW), ValidationError);
    const result = await acceptInvite(token, { password: "mevcutSifre123" }, NOW);
    assert.equal(result.userId, existing.id, "yeni hesap açılmaz, mevcut hesaba üyelik eklenir");

    const memberships = await db.membership.findMany({ where: { userId: existing.id } });
    assert.equal(memberships.length, 2, "kişi iki işletmede üye olur");
    assert.equal(memberships.find((m) => m.tenantId === A.tenant.id)?.role, "CRM_MANAGER");
  });

  test("davet: zaten ekipte olan e-posta davet edilemez", async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { id: A.owner.userId } });
    await assert.rejects(createInvite(A.owner, { name: owner.name, email: owner.email, role: "DOOR" }, NOW), ConflictError);
  });

  test("kilitlenme koruması: son sahip düşürülemez, kendi erişimi kapatılamaz", async () => {
    const team = await getTeam(A.owner);
    const self = team.members.find((m) => m.isSelf)!;
    assert.equal(self.role, "OWNER_ADMIN");

    await assert.rejects(changeMemberRole(A.owner, self.membershipId, "DOOR"), ForbiddenError);
    await assert.rejects(setMemberStatus(A.owner, self.membershipId, false), ForbiddenError);

    // İkinci bir sahip ekleyip onu düşürmeyi dene: son sahip o olmadığı için serbest
    const crm = team.members.find((m) => m.role === "CRM_MANAGER")!;
    await changeMemberRole(A.owner, crm.membershipId, "OWNER_ADMIN");
    await changeMemberRole(A.owner, crm.membershipId, "CRM_MANAGER");
    const still = await db.membership.findUniqueOrThrow({ where: { id: crm.membershipId } });
    assert.equal(still.role, "CRM_MANAGER");
  });

  test("erişim kapatma oturumları da düşürür", async () => {
    const team = await getTeam(A.owner);
    const waiter = team.members.find((m) => m.role === "WAITER")!;
    await db.session.create({
      data: { tokenHash: "ekip-test-oturum", userId: waiter.userId, expiresAt: new Date(NOW.getTime() + 3600_000) },
    });
    await setMemberStatus(A.owner, waiter.membershipId, false);
    assert.equal(await db.session.count({ where: { userId: waiter.userId } }), 0, "erişim kapanınca açık oturum kalmaz");
    const updated = await db.membership.findUniqueOrThrow({ where: { id: waiter.membershipId } });
    assert.equal(updated.status, "DISABLED");
    await setMemberStatus(A.owner, waiter.membershipId, true);
  });

  test("mekan erişimi: yalnızca kendi işletmesinin mekanları atanabilir", async () => {
    const team = await getTeam(A.owner);
    const crm = team.members.find((m) => m.role === "CRM_MANAGER")!;
    await assert.rejects(setMemberVenues(A.owner, crm.membershipId, [B.venue.id]), ValidationError);

    await setMemberVenues(A.owner, crm.membershipId, [A.venue.id]);
    const after1 = await getTeam(A.owner);
    assert.deepEqual(after1.members.find((m) => m.membershipId === crm.membershipId)?.venueIds, [A.venue.id]);

    await setMemberVenues(A.owner, crm.membershipId, []);
    const after2 = await getTeam(A.owner);
    assert.deepEqual(after2.members.find((m) => m.membershipId === crm.membershipId)?.venueIds, [], "boş liste = tüm mekanlar");
  });

  test("işletme izolasyonu: başka işletmenin üyeliğine dokunulamaz", async () => {
    const otherTeam = await getTeam(B.owner);
    const otherMember = otherTeam.members.find((m) => m.role === "DOOR")!;
    await assert.rejects(changeMemberRole(A.owner, otherMember.membershipId, "WAITER"), NotFoundError);
    await assert.rejects(setMemberStatus(A.owner, otherMember.membershipId, false), NotFoundError);
    await assert.rejects(setMemberVenues(A.owner, otherMember.membershipId, []), NotFoundError);
  });
});
