import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import { createEvent } from "@/modules/events/service";
import { connectSms } from "@/modules/campaigns/sms-service";
import { venueSignup, resetVenuePageRateLimit } from "@/modules/venue-page/service";
import {
  confirmMemberCode,
  endMemberSession,
  parseIdentifier,
  readMemberSession,
  requestMemberCode,
  resetMemberRateLimits,
} from "@/modules/member/service";
import { getMemberArea } from "@/modules/member/area";
import { eventInput, makeTenant, resetDb } from "./helpers";

/**
 * Üyelik alanı: şifresiz giriş ve kişinin kendi verisi.
 * Netgsm taklit edilir; gönderilen kod sahte istekten okunur.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

const realFetch = globalThis.fetch;
const sent: { no: string; msg: string }[] = [];
const IP = { ip: "4.4.4.4" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.hostname === "api.netgsm.com.tr") {
    if (url.pathname === "/sms/rest/v2/msgheader") return json({ code: "00", msgheaders: ["ORBITA"] });
    if (url.pathname === "/sms/rest/v2/send") {
      for (const m of body?.messages ?? []) sent.push(m);
      return json({ code: "00", jobid: "J1" });
    }
  }
  return json({ error: "beklenmeyen istek" }, 404);
}

const lastCode = () => /(\d{6})/.exec(sent.at(-1)?.msg ?? "")?.[1] ?? "";

before(async () => {
  await resetDb();
  Object.assign(process.env, { CHANNEL_TOKEN_SECRET: "test-only-channel-token-secret-0123456789" });
  globalThis.fetch = fakeFetch as typeof fetch;
  A = await makeTenant("ua");
  B = await makeTenant("ub");
  await connectSms(A.owner, { username: "8501112233", password: "dogru-sifre", msgheader: "ORBITA", legalFooter: "B004 yazip gonderin." });
  await createEvent(A.owner, eventInput(A.venue.id, { name: "Üye Gecesi", capacity: "20" }));
  await createCustomer(A.owner, { firstName: "Ayla", lastName: "Deniz", phone: "0532 950 00 01", email: "ayla@ornek.test" });
});

beforeEach(async () => {
  sent.length = 0;
  await resetMemberRateLimits();
  await resetVenuePageRateLimit();
  await db.memberLoginCode.deleteMany();
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.$disconnect();
});

describe("Kimlik ayrıştırma", () => {
  test("telefon ve e-posta ayırt edilir", () => {
    assert.deepEqual(parseIdentifier("0532 950 00 01"), { channel: "SMS", destination: "+905329500001" });
    assert.deepEqual(parseIdentifier("  AYLA@Ornek.Test "), { channel: "EMAIL", destination: "ayla@ornek.test" });
  });

  test("geçersiz değer reddedilir", () => {
    assert.throws(() => parseIdentifier("abc"), ValidationError);
    assert.throws(() => parseIdentifier("bozuk@"), ValidationError);
  });
});

describe("Giriş kodu", () => {
  test("kayıtlı olmayan numara için de aynı cevap döner", async () => {
    const result = await requestMemberCode(A.venue.slug, "0532 950 99 99", IP);
    assert.equal(result.deliverable, true, "SMS kanalı bağlı");
    assert.equal(sent.length, 0, "kayıt yoksa kod gönderilmez");
    assert.equal(await db.memberLoginCode.count(), 0, "kayıt yoksa kod satırı açılmaz");
  });

  test("kayıtlı numaraya kod gider ve düz saklanmaz", async () => {
    await requestMemberCode(A.venue.slug, "0532 950 00 01", IP);
    assert.equal(sent.length, 1);
    const row = await db.memberLoginCode.findFirstOrThrow({ where: { destination: "+905329500001" } });
    assert.match(row.codeHash, /^[a-f0-9]{64}$/);
    assert.ok(!row.codeHash.includes(lastCode()));
    assert.equal(row.channel, "SMS");
  });

  test("e-posta servisi bağlı değilse bildirilir", async () => {
    const result = await requestMemberCode(A.venue.slug, "ayla@ornek.test", IP);
    assert.equal(result.deliverable, false, "testlerde Brevo kapalı");
    assert.equal(sent.length, 0);
  });

  test("bilinmeyen mekan reddedilir", async () => {
    await assert.rejects(requestMemberCode("olmayan", "0532 950 00 01", IP), NotFoundError);
  });

  test("çok sayıda istek sınırlanır", async () => {
    for (let i = 0; i < 5; i += 1) await requestMemberCode(A.venue.slug, "0532 950 00 01", IP);
    await assert.rejects(requestMemberCode(A.venue.slug, "0532 950 00 01", IP), ConflictError);
  });
});

describe("Oturum", () => {
  test("doğru kod oturum açar, numarayı doğrulanmış sayar", async () => {
    await requestMemberCode(A.venue.slug, "0532 950 00 01", IP);
    const result = await confirmMemberCode(A.venue.slug, "0532 950 00 01", lastCode());
    assert.equal(result.ok, true);

    const ctx = await readMemberSession(result.ok ? result.token : "");
    assert.ok(ctx);
    assert.equal(ctx.tenantId, A.tenant.id);

    const customer = await db.customer.findUniqueOrThrow({ where: { id: ctx.customerId } });
    assert.equal(customer.firstName, "Ayla");
    assert.ok(customer.phoneVerifiedAt, "SMS ile giriş numarayı doğrular");
  });

  test("yanlış kod oturum açmaz, kod tek kullanımlıktır", async () => {
    await requestMemberCode(A.venue.slug, "0532 950 00 01", IP);
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    assert.deepEqual(await confirmMemberCode(A.venue.slug, "0532 950 00 01", wrong), { ok: false, reason: "INVALID" });

    const ok = await confirmMemberCode(A.venue.slug, "0532 950 00 01", code);
    assert.equal(ok.ok, true);
    assert.deepEqual(await confirmMemberCode(A.venue.slug, "0532 950 00 01", code), { ok: false, reason: "NOT_FOUND" });
  });

  test("bir mekanın kodu başka işletmede çalışmaz", async () => {
    await requestMemberCode(A.venue.slug, "0532 950 00 01", IP);
    assert.deepEqual(await confirmMemberCode(B.venue.slug, "0532 950 00 01", lastCode()), { ok: false, reason: "NOT_FOUND" });
  });

  test("süresi dolan oturum okunamaz ve çıkış oturumu kapatır", async () => {
    await requestMemberCode(A.venue.slug, "0532 950 00 01", IP);
    const result = await confirmMemberCode(A.venue.slug, "0532 950 00 01", lastCode());
    assert.equal(result.ok, true);
    const token = result.ok ? result.token : "";

    assert.ok(await readMemberSession(token), "süresi dolmadan geçerli");
    // Süresi dolan oturum okunmaz ve satırı silinir.
    const before = await db.memberSession.count();
    assert.equal(await readMemberSession(token, new Date(Date.now() + 40 * 864e5)), null, "süresi dolan oturum geçersiz");
    assert.equal(await db.memberSession.count(), before - 1, "süresi dolan oturum satırı silinir");

    // Çıkış da oturumu kapatır.
    await requestMemberCode(A.venue.slug, "0532 950 00 01", IP);
    const again = await confirmMemberCode(A.venue.slug, "0532 950 00 01", lastCode());
    assert.equal(again.ok, true);
    const second = again.ok ? again.token : "";
    assert.ok(await readMemberSession(second));
    await endMemberSession(second);
    assert.equal(await readMemberSession(second), null, "çıkıştan sonra oturum yok");
  });

  test("uydurma token oturum vermez", async () => {
    assert.equal(await readMemberSession("uydurma-token"), null);
    assert.equal(await readMemberSession(undefined), null);
  });
});

describe("Üyelik alanı içeriği", () => {
  test("kişi yalnızca kendi kaydını görür", async () => {
    // Mekan sayfasından etkinliğe kaydolan yeni bir kişi (QR'ı olur).
    const signup = await venueSignup(
      A.venue.slug,
      {
        firstName: "Üye",
        lastName: "Kişi",
        phone: "0532 950 00 20",
        eventId: (await db.event.findFirstOrThrow({ where: { name: "Üye Gecesi" } })).id,
        partySize: "2",
        consents: ["SMS"],
      },
      { ip: "4.4.4.5" },
    );
    assert.equal(signup.status, "created");

    await requestMemberCode(A.venue.slug, "0532 950 00 20", { ip: "4.4.4.6" });
    const login = await confirmMemberCode(A.venue.slug, "0532 950 00 20", lastCode());
    assert.equal(login.ok, true);
    const ctx = await readMemberSession(login.ok ? login.token : "");
    assert.ok(ctx);

    const area = await getMemberArea(ctx);
    assert.ok(area);
    assert.equal(area.name, "Üye Kişi");
    assert.equal(area.passes.length, 1, "kendi giriş QR'ı listelenir");
    assert.equal(area.passes[0].subtitle, "Giriş QR'ı");
    assert.equal(area.registrations.length, 1);
    assert.equal(area.registrations[0].partySize, 2);
    assert.equal(area.consents.find((c) => c.channel === "SMS")?.granted, true);
    assert.equal(area.consents.find((c) => c.channel === "EMAIL")?.granted, false);
    assert.equal(area.venues.length, 1);

    // Başkasının kaydı görünmez.
    const other = await db.customer.findFirstOrThrow({ where: { phone: "+905329500001" } });
    assert.notEqual(ctx.customerId, other.id);
  });

  test("anonimleştirilmiş kayıt üyelik alanını açamaz", async () => {
    const customer = await db.customer.findFirstOrThrow({ where: { phone: "+905329500020" } });
    await db.customer.update({ where: { id: customer.id }, data: { anonymizedAt: new Date() } });
    const session = await db.memberSession.findFirstOrThrow({ where: { customerId: customer.id } });
    assert.equal(await getMemberArea({ customerId: customer.id, tenantId: A.tenant.id, sessionId: session.id }), null);
  });
});
