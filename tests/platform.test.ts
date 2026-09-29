import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import {
  endSupportAccessByAdmin,
  expireSupportAccess,
  getPlatformSummary,
  grantSupportAccess,
  listSupportGrants,
  listTenants,
  setTenantStatus,
} from "@/modules/platform/service";
import { makeTenant, resetDb } from "./helpers";

/**
 * Platform konsolu. Yetki tenant rolünden değil `isPlatformAdmin`'den gelir.
 * Destek erişimi gerekçeli, süreli ve işletmenin kendi aktivite geçmişine yazılır.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
let admin: { id: string; isPlatformAdmin: boolean };
const outsider = { id: "", isPlatformAdmin: false };

before(async () => {
  await resetDb();
  A = await makeTenant("fa");
  B = await makeTenant("fb");
  const user = await db.user.create({
    data: { email: "platform@circular.test", name: "Platform Yöneticisi", passwordHash: "x", isPlatformAdmin: true },
  });
  admin = { id: user.id, isPlatformAdmin: true };
  outsider.id = A.owner.userId;
  await createCustomer(A.owner, { firstName: "Sayı", lastName: "Testi", phone: "0532 990 00 01" });
});

after(async () => {
  await db.$disconnect();
});

describe("Yetki", () => {
  test("platform yöneticisi olmayan hiçbir şeyi göremez", async () => {
    await assert.rejects(listTenants(outsider), ForbiddenError);
    await assert.rejects(getPlatformSummary(outsider), ForbiddenError);
    await assert.rejects(listSupportGrants(outsider), ForbiddenError);
    await assert.rejects(setTenantStatus(outsider, { tenantId: A.tenant.id, reason: "olmaz olmaz" }, true), ForbiddenError);
    await assert.rejects(grantSupportAccess(outsider, { tenantId: A.tenant.id, reason: "olmaz olmaz", hours: 1 }), ForbiddenError);
  });
});

describe("İşletme listesi", () => {
  test("sayılar gösterilir, müşteri bilgisi gösterilmez", async () => {
    const rows = await listTenants(admin);
    const row = rows.find((r) => r.id === A.tenant.id);
    assert.ok(row);
    assert.equal(row.venues, 1);
    assert.equal(row.customers, 1);
    assert.equal(row.status, "ACTIVE");
    assert.ok(!JSON.stringify(rows).includes("Sayı"), "müşteri adı listeye sızmaz");

    const summary = await getPlatformSummary(admin);
    assert.ok(summary.tenants >= 2);
    assert.equal(summary.suspended, 0);
  });
});

describe("Askıya alma", () => {
  test("gerekçe zorunludur", async () => {
    await assert.rejects(setTenantStatus(admin, { tenantId: B.tenant.id, reason: "kısa" }, true), ValidationError);
    await assert.rejects(setTenantStatus(admin, { tenantId: "olmayan", reason: "geçerli gerekçe" }, true), NotFoundError);
  });

  test("askıya alınca oturumlar düşer, veri kalır", async () => {
    await db.session.create({ data: { tokenHash: "askida-oturum", userId: B.owner.userId, expiresAt: new Date(Date.now() + 864e5) } });
    const customersBefore = await db.customer.count({ where: { tenantId: B.tenant.id } });

    await setTenantStatus(admin, { tenantId: B.tenant.id, reason: "Ödeme gecikmesi" }, true);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: B.tenant.id } });
    assert.equal(tenant.status, "SUSPENDED");
    assert.equal(await db.session.count({ where: { userId: B.owner.userId } }), 0, "açık oturumlar düşer");
    assert.equal(await db.customer.count({ where: { tenantId: B.tenant.id } }), customersBefore, "veri silinmez");

    const log = await db.activityLog.findFirst({ where: { action: "platform.tenant_suspended", tenantId: B.tenant.id } });
    assert.ok(log, "askıya alma işletmenin aktivite geçmişine yazılır");
  });

  test("askı kaldırılır", async () => {
    await setTenantStatus(admin, { tenantId: B.tenant.id, reason: "Ödeme alındı" }, false);
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: B.tenant.id } })).status, "ACTIVE");
  });
});

describe("Destek erişimi", () => {
  test("gerekçesiz veya çok uzun süreli erişim açılmaz", async () => {
    await assert.rejects(grantSupportAccess(admin, { tenantId: A.tenant.id, reason: "kısa", hours: 2 }), ValidationError);
    await assert.rejects(grantSupportAccess(admin, { tenantId: A.tenant.id, reason: "Destek talebi #1", hours: 99 }), ValidationError);
  });

  test("erişim gerçek üyelik açar ve işletmenin geçmişine yazılır", async () => {
    const grant = await grantSupportAccess(admin, { tenantId: A.tenant.id, reason: "Destek talebi #1 — kampanya gitmiyor", hours: 2 });
    assert.ok(grant.expiresAt > new Date());

    const membership = await db.membership.findFirstOrThrow({ where: { userId: admin.id, tenantId: A.tenant.id } });
    assert.equal(membership.role, "OWNER_ADMIN");
    assert.equal(membership.status, "ACTIVE");

    const log = await db.activityLog.findFirst({ where: { action: "platform.support_access_granted", tenantId: A.tenant.id } });
    assert.ok(log, "işletme kimin baktığını görür");
    assert.ok(log!.metadata?.includes("Destek talebi #1"));

    const rows = await listTenants(admin);
    assert.equal(rows.find((r) => r.id === A.tenant.id)?.supportAccess?.userName, "Platform Yöneticisi");
  });

  test("aynı işletmede ikinci açık erişim verilmez", async () => {
    await assert.rejects(grantSupportAccess(admin, { tenantId: A.tenant.id, reason: "İkinci deneme", hours: 1 }), ConflictError);
  });

  test("erişim elle kapatılınca üyelik de kapanır", async () => {
    const open = await db.supportAccessGrant.findFirstOrThrow({ where: { tenantId: A.tenant.id, endedAt: null } });
    await endSupportAccessByAdmin(admin, open.id);

    const membership = await db.membership.findFirstOrThrow({ where: { userId: admin.id, tenantId: A.tenant.id } });
    assert.equal(membership.status, "DISABLED", "erişim bitince üyelik kapanır");
    assert.ok(await db.activityLog.findFirst({ where: { action: "platform.support_access_ended", tenantId: A.tenant.id } }));
  });

  test("süresi dolan erişim kendiliğinden kapanır", async () => {
    await grantSupportAccess(admin, { tenantId: A.tenant.id, reason: "Süre dolma testi", hours: 1 });
    const closed = await expireSupportAccess(new Date(Date.now() + 2 * 3600_000));
    assert.equal(closed, 1);

    const membership = await db.membership.findFirstOrThrow({ where: { userId: admin.id, tenantId: A.tenant.id } });
    assert.equal(membership.status, "DISABLED");
    const grants = await listSupportGrants(admin);
    assert.ok(grants.every((g) => g.endedAt !== null), "açık erişim kalmaz");
    // Otomatik kapanma denetim kaydında ayrı işaretlenir.
    const log = await db.activityLog.findFirst({ where: { action: "platform.support_access_ended" }, orderBy: { createdAt: "desc" } });
    assert.ok(log!.metadata?.includes('"automatic":true'));
  });
});
