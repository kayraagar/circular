import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import type { ServiceContext } from "@/lib/authz";
import { toLocalInputValue } from "@/lib/datetime";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createEvent } from "@/modules/events/service";
import { addGuestToEvent } from "@/modules/guests/service";
import { manualCheckIn } from "@/modules/passes/service";
import { closePrTask, createPrTask, getPrOverview, listMyPrTasks, listPrTasks, markPrTask } from "@/modules/pr/service";
import { recipientState, targetProgress } from "@/modules/pr/tasks";
import { eventInput, localIn, makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;
let pr2: ServiceContext;
let prOtherVenue: ServiceContext;
let event: { id: string };

const code = (c: string) => (e: unknown) => e instanceof ConflictError && e.code === c;

async function addPr(tenant: T, email: string, name: string, venueId?: string): Promise<ServiceContext> {
  const user = await db.user.create({ data: { email, name, passwordHash: "x" } });
  const m = await db.membership.create({
    data: { userId: user.id, tenantId: tenant.tenant.id, role: "PR", ...(venueId ? { venueAccess: { create: { venueId } } } : {}) },
  });
  return { tenantId: tenant.tenant.id, userId: user.id, membershipId: m.id, role: "PR", venueIds: venueId ? [venueId] : null };
}

before(async () => {
  await resetDb();
  A = await makeTenant("pa");
  B = await makeTenant("pb");
  pr2 = await addPr(A, "pr2@pa.test", "Ece PR");
  const otherVenue = await db.venue.create({ data: { tenantId: A.tenant.id, name: "Bahçe", slug: "pa-bahce", type: "CAFE" } });
  prOtherVenue = await addPr(A, "pr3@pa.test", "Bahçe PR", otherVenue.id);
  event = await createEvent(A.owner, eventInput(A.venue.id, { name: "Cuma Gecesi", startsAt: localIn(24), endsAt: localIn(30) }));
});

after(async () => {
  await db.$disconnect();
});

describe("kurallar", () => {
  test("alıcı durumu ve hedef ilerlemesi", () => {
    assert.equal(recipientState({ readAt: null, completedAt: null }), "UNREAD");
    assert.equal(recipientState({ readAt: new Date(), completedAt: null }), "READ");
    assert.equal(recipientState({ readAt: null, completedAt: new Date() }), "DONE");
    assert.equal(targetProgress(5, 20), 0.25);
    assert.equal(targetProgress(25, 20), 1);
    assert.equal(targetProgress(3, null), 0);
  });
});

describe("talimat verme", () => {
  test("doğrulama ve roller", async () => {
    const base = { kind: "ANNOUNCEMENT", title: "Liste 22:00'de kapanıyor", audience: "ALL" };
    await assert.rejects(createPrTask(A.pr, base), ForbiddenError, "PR talimat veremez");
    await assert.rejects(createPrTask(A.door, base), ForbiddenError);
    await assert.rejects(createPrTask(A.owner, { ...base, kind: "EMIR" }), ValidationError);
    await assert.rejects(createPrTask(A.owner, { ...base, title: "X" }), ValidationError);
    await assert.rejects(createPrTask(A.owner, { ...base, kind: "GUEST_TARGET", guestTarget: "20" }), ValidationError, "hedef için etkinlik zorunlu");
    await assert.rejects(createPrTask(A.owner, { ...base, kind: "GUEST_TARGET", eventId: event.id }), ValidationError, "hedef sayısı zorunlu");
    await assert.rejects(createPrTask(A.owner, { ...base, kind: "GUEST_TARGET", eventId: event.id, guestTarget: "0" }), ValidationError);
    await assert.rejects(createPrTask(A.owner, { ...base, dueAt: toLocalInputValue(new Date(Date.now() - 3600_000)) }), ValidationError, "geçmiş son tarih");
    const bEvent = await createEvent(B.owner, eventInput(B.venue.id));
    await assert.rejects(createPrTask(A.owner, { ...base, eventId: bEvent.id }), ValidationError, "başka işletmenin etkinliği");
    const draft = await createEvent(A.owner, eventInput(A.venue.id, { status: "DRAFT" }));
    await assert.rejects(createPrTask(A.owner, { ...base, eventId: draft.id }), ValidationError, "taslak etkinlik");
    await assert.rejects(createPrTask(A.owner, { ...base, audience: "SELECTED", membershipIds: [] }), ValidationError);
    await assert.rejects(createPrTask(A.owner, { ...base, audience: "SELECTED", membershipIds: [B.pr.membershipId] }), ValidationError, "başka işletmenin PR'ı");
    await assert.rejects(createPrTask(A.owner, { ...base, audience: "SELECTED", membershipIds: [A.crm.membershipId] }), ValidationError, "PR olmayan üye");
  });

  test("tüm PR'lara duyuru; PR yalnızca kendisine verileni görür", async () => {
    const created = await createPrTask(A.crm, { kind: "ANNOUNCEMENT", title: "Kıyafet kuralı hatırlatması", body: "Spor ayakkabı yok.", audience: "ALL" });
    assert.equal(created.recipientCount, 3);

    const mine = await listMyPrTasks(A.pr);
    const task = mine.find((t) => t.taskId === created.id);
    assert.equal(task?.state, "UNREAD");
    assert.equal(task?.body, "Spor ayakkabı yok.");
    assert.equal((await listMyPrTasks(B.pr)).length, 0);

    assert.equal(await markPrTask(A.pr, created.id, "read"), "READ");
    assert.equal(await markPrTask(A.pr, created.id, "read"), "READ", "tekrar okundu işaretlemek sorun çıkarmaz");
    await assert.rejects(markPrTask(A.pr, created.id, "done"), code("NOT_COMPLETABLE"));
    await assert.rejects(markPrTask(B.pr, created.id, "read"), NotFoundError);
    await assert.rejects(markPrTask(A.owner, created.id, "read"), ForbiddenError, "yönetim PR adına işaretleyemez");

    const list = await listPrTasks(A.owner, { status: "OPEN" });
    const view = list.find((t) => t.id === created.id);
    assert.equal(view?.summary.total, 3);
    assert.equal(view?.summary.read, 1);
    assert.equal(view?.recipients.find((r) => r.membershipId === A.pr.membershipId)?.state, "READ");
    assert.equal((await listPrTasks(B.owner, { status: "OPEN" })).length, 0);
    await assert.rejects(listPrTasks(A.pr, { status: "OPEN" }), ForbiddenError);
  });

  test("misafir hedefi: mekana erişemeyen PR alıcı olmaz, ilerleme gerçek kayıtlardan hesaplanır", async () => {
    const all = await createPrTask(A.owner, {
      kind: "GUEST_TARGET",
      title: "Cuma için 4'er kişi",
      eventId: event.id,
      guestTarget: "4",
      dueAt: localIn(20),
      audience: "ALL",
    });
    assert.equal(all.recipientCount, 2, "Bahçe'ye kısıtlı PR bu etkinliği alamaz");
    await assert.rejects(
      createPrTask(A.owner, { kind: "GUEST_TARGET", title: "Tek kişiye", eventId: event.id, guestTarget: "4", audience: "SELECTED", membershipIds: [prOtherVenue.membershipId] }),
      ValidationError,
    );

    const g1 = await addGuestToEvent(A.pr, event.id, { firstName: "Bir", lastName: "Misafir", phone: "0532 800 00 01", partySize: "3" });
    await addGuestToEvent(A.pr, event.id, { firstName: "İki", lastName: "Misafir", phone: "0532 800 00 02", partySize: "2" });
    await addGuestToEvent(pr2, event.id, { firstName: "Üç", lastName: "Misafir", phone: "0532 800 00 03", partySize: "1" });

    const view = (await listPrTasks(A.owner, { status: "OPEN" })).find((t) => t.id === all.id)!;
    const mineProgress = view.recipients.find((r) => r.membershipId === A.pr.membershipId)?.progress;
    assert.deepEqual(mineProgress, { people: 5, admitted: 0, ratio: 1 });
    assert.equal(view.recipients.find((r) => r.membershipId === pr2.membershipId)?.progress?.people, 1);
    assert.equal(view.summary.reachedTarget, 1);

    const restricted = await listPrTasks({ ...A.crm, venueIds: prOtherVenue.venueIds }, { status: "OPEN" });
    assert.equal(restricted.some((t) => t.id === all.id), false, "mekan kısıtlı yönetici başka mekanın hedefini görmez");
    assert.ok(restricted.some((t) => t.kind === "ANNOUNCEMENT"), "etkinliksiz talimatlar görünür");
    await assert.rejects(closePrTask({ ...A.crm, venueIds: prOtherVenue.venueIds }, all.id), NotFoundError);

    await assert.rejects(markPrTask(A.pr, all.id, "done"), code("NOT_COMPLETABLE"), "hedef beyanla tamamlanmaz");
    const portal = (await listMyPrTasks(pr2)).find((t) => t.taskId === all.id);
    assert.deepEqual(portal?.progress, { people: 1, admitted: 0, ratio: 0.25 });
    assert.equal((await listMyPrTasks(prOtherVenue)).some((t) => t.taskId === all.id), false);

    // Gerçek giriş ilerlemeye yansır (giriş penceresini açmak için etkinliği şimdiye çek)
    await db.event.update({ where: { id: event.id }, data: { startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 5 * 3600_000) } });
    await manualCheckIn(A.door, g1.registrationId, { admittedCount: 3 });
    const after = (await listPrTasks(A.owner, { status: "OPEN" })).find((t) => t.id === all.id)!;
    assert.equal(after.recipients.find((r) => r.membershipId === A.pr.membershipId)?.progress?.admitted, 3);
  });

  test("görev tamamlanır; kapatılan talimat PR portalından kalkar", async () => {
    const todo = await createPrTask(A.owner, { kind: "TODO", title: "Story paylaşımı yapın", audience: "SELECTED", membershipIds: [A.pr.membershipId] });
    assert.equal(todo.recipientCount, 1);
    assert.equal((await listMyPrTasks(pr2)).some((t) => t.taskId === todo.id), false, "seçilmeyen PR görmez");

    assert.equal(await markPrTask(A.pr, todo.id, "done"), "DONE");
    assert.equal(await markPrTask(A.pr, todo.id, "done"), "DONE");
    const recipient = await db.prTaskRecipient.findFirstOrThrow({ where: { taskId: todo.id } });
    assert.ok(recipient.readAt, "tamamlanan talimat okunmuş sayılır");
    assert.equal(await db.activityLog.count({ where: { action: "pr_task.completed", entityId: todo.id } }), 1, "tamamlama bir kez kaydedilir");

    await assert.rejects(closePrTask(B.owner, todo.id), NotFoundError);
    await assert.rejects(closePrTask(A.pr, todo.id), ForbiddenError);
    await closePrTask(A.owner, todo.id);
    await closePrTask(A.owner, todo.id);
    assert.equal((await listMyPrTasks(A.pr)).some((t) => t.taskId === todo.id), false);
    await assert.rejects(markPrTask(A.pr, todo.id, "read"), code("TASK_CLOSED"));
    const closed = await listPrTasks(A.owner, { status: "CLOSED" });
    assert.equal(closed.find((t) => t.id === todo.id)?.summary.done, 1, "geçmiş korunur");
  });
});

describe("genel bakış ve veritabanı koruması", () => {
  test("ekip performansı yalnızca kendi işletmesinden ve gerçek kayıtlardan", async () => {
    const overview = await getPrOverview(A.owner);
    assert.equal(overview.totals.activePrs, 3);
    const mine = overview.team.find((m) => m.membershipId === A.pr.membershipId);
    assert.equal(mine?.stats.people, 5);
    assert.equal(mine?.stats.admitted, 3);
    assert.ok((mine?.openTasks ?? 0) >= 2);
    assert.ok(overview.totals.openTasks >= 2);
    assert.ok(overview.events.some((e) => e.id === event.id));

    const other = await getPrOverview(B.owner);
    assert.equal(other.team.some((m) => m.membershipId === A.pr.membershipId), false);
    await assert.rejects(getPrOverview(A.pr), ForbiddenError);
  });

  test("başka işletmenin PR'ı talimata bağlanamaz (composite FK)", async () => {
    const task = await db.prTask.findFirstOrThrow({ where: { tenantId: A.tenant.id } });
    await assert.rejects(db.prTaskRecipient.create({ data: { tenantId: A.tenant.id, taskId: task.id, membershipId: B.pr.membershipId } }));
  });
});
