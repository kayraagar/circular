import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import { connectSms } from "@/modules/campaigns/sms-service";
import {
  MAX_ATTEMPTS,
  confirmByHandle,
  confirmPhoneVerification,
  readVerificationHandle,
  resetVerificationRateLimits,
  startPhoneVerification,
  verificationAvailable,
} from "@/modules/verification/service";
import { makeTenant, resetDb } from "./helpers";

/**
 * Telefon doğrulama. Netgsm API'si taklit edilir (ağa çıkılmaz); gönderilen kod
 * sahte istekten okunur. Doğrulanan şey kod üretimi, saklanması, süre/deneme sınırları
 * ve müşteri kaydının işaretlenmesidir.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

const realFetch = globalThis.fetch;
/** Netgsm'e giden doğrulama SMS'leri (numara → kod). */
const sent: { no: string; msg: string }[] = [];
let counter = 0;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.hostname === "api.netgsm.com.tr") {
    if (url.pathname === "/sms/rest/v2/msgheader") return json({ code: "00", msgheaders: ["ORBITA"] });
    if (url.pathname === "/sms/rest/v2/send") {
      for (const m of body?.messages ?? []) sent.push(m);
      // Doğrulama kodu ticari ileti değildir: İYS filtresi uygulanmaz.
      assert.equal(body?.iysfilter, "0", "doğrulama SMS'i İYS filtresiyle gönderilmez");
      return json({ code: "00", jobid: `J${++counter}` });
    }
  }
  return json({ error: "beklenmeyen istek" }, 404);
}

/** Son gönderilen SMS'teki altı haneli kod. */
function lastCode(): string {
  const msg = sent.at(-1)?.msg ?? "";
  return /(\d{6})/.exec(msg)?.[1] ?? "";
}

const IP = { ip: "1.2.3.4" };

before(async () => {
  await resetDb();
  Object.assign(process.env, { CHANNEL_TOKEN_SECRET: "test-only-channel-token-secret-0123456789" });
  globalThis.fetch = fakeFetch as typeof fetch;
  A = await makeTenant("va");
  B = await makeTenant("vb");
  // Yalnızca A işletmesinin SMS hesabı bağlı.
  await connectSms(A.owner, {
    username: "8501112233",
    password: "dogru-sifre",
    msgheader: "ORBITA",
    legalFooter: "Mesaj almak istemiyorsanız B004 yazip 0850 000 00 00'a gonderin.",
  });
});

beforeEach(async () => {
  sent.length = 0;
  await resetVerificationRateLimits();
  await db.phoneVerification.deleteMany();
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.$disconnect();
});

describe("Kod gönderimi", () => {
  test("SMS hesabı bağlı değilse doğrulama sunulmaz", async () => {
    assert.equal(await verificationAvailable(B.tenant.id), false);
    assert.equal(await verificationAvailable(A.tenant.id), true);
    const result = await startPhoneVerification(B.tenant.id, "0532 900 00 01", IP);
    assert.equal(result.status, "unavailable");
    assert.equal(sent.length, 0, "kod gönderilmez");
    assert.equal(await db.phoneVerification.count(), 0, "kayıt açılmaz");
  });

  test("geçersiz numara reddedilir", async () => {
    await assert.rejects(startPhoneVerification(A.tenant.id, "12", IP), ValidationError);
  });

  test("kod düz saklanmaz", async () => {
    const result = await startPhoneVerification(A.tenant.id, "0532 900 00 02", IP);
    assert.equal(result.status, "sent");
    assert.equal(sent.length, 1);
    assert.match(lastCode(), /^\d{6}$/, "altı haneli kod");
    const row = await db.phoneVerification.findFirstOrThrow({ where: { phone: "+905329000002" } });
    assert.match(row.codeHash, /^[a-f0-9]{64}$/);
    assert.ok(!row.codeHash.includes(lastCode()), "kodun kendisi saklanmaz");
  });

  test("aynı numaraya sınırsız kod gönderilmez", async () => {
    const phone = "0532 900 00 03";
    for (let i = 0; i < 3; i += 1) await startPhoneVerification(A.tenant.id, phone, IP);
    await assert.rejects(startPhoneVerification(A.tenant.id, phone, IP), ConflictError);
  });
});

describe("Kod onayı", () => {
  test("doğru kod müşteri kaydını işaretler", async () => {
    const customer = await createCustomer(A.owner, { firstName: "Selin", lastName: "Toprak", phone: "0532 900 00 10" });
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).phoneVerifiedAt, null);

    await startPhoneVerification(A.tenant.id, "0532 900 00 10", IP);
    assert.deepEqual(await confirmPhoneVerification(A.tenant.id, "0532 900 00 10", lastCode()), { ok: true, phone: "+905329000010" });
    assert.ok((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).phoneVerifiedAt, "numara doğrulandı olarak işaretlenir");
  });

  test("yanlış kod sayılır ve sınırda kod geçersizleşir", async () => {
    await startPhoneVerification(A.tenant.id, "0532 900 00 11", IP);
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      assert.deepEqual(await confirmPhoneVerification(A.tenant.id, "0532 900 00 11", wrong), { ok: false, reason: "INVALID" });
    }
    assert.deepEqual(await confirmPhoneVerification(A.tenant.id, "0532 900 00 11", wrong), { ok: false, reason: "TOO_MANY" });
    // Doğru kod bile artık kabul edilmez.
    assert.deepEqual(await confirmPhoneVerification(A.tenant.id, "0532 900 00 11", lastCode()), { ok: false, reason: "TOO_MANY" });
  });

  test("süresi dolan kod kabul edilmez", async () => {
    await startPhoneVerification(A.tenant.id, "0532 900 00 12", IP);
    const later = new Date(Date.now() + 11 * 60_000);
    assert.deepEqual(await confirmPhoneVerification(A.tenant.id, "0532 900 00 12", lastCode(), later), { ok: false, reason: "EXPIRED" });
  });

  test("bir işletmenin kodu başka işletmede çalışmaz", async () => {
    await startPhoneVerification(A.tenant.id, "0532 900 00 13", IP);
    assert.deepEqual(await confirmPhoneVerification(B.tenant.id, "0532 900 00 13", lastCode()), { ok: false, reason: "NOT_FOUND" });
  });
});

describe("İmzalı kol", () => {
  test("kol açık kaydı gösterir, numara maskelenir", async () => {
    const started = await startPhoneVerification(A.tenant.id, "0532 900 00 20", IP);
    assert.equal(started.status, "sent");
    const state = await readVerificationHandle(started.status === "sent" ? started.handle : "");
    assert.equal(state.open, true);
    assert.ok(state.open && !state.maskedPhone.includes("900"), "tam numara gösterilmez");
  });

  test("imzası bozuk kol çalışmaz", async () => {
    const started = await startPhoneVerification(A.tenant.id, "0532 900 00 21", IP);
    assert.equal(started.status, "sent");
    const [id] = (started.status === "sent" ? started.handle : "").split(".");
    assert.deepEqual(await readVerificationHandle(`${id}.bozukimza`), { open: false });
    assert.deepEqual(await confirmByHandle(`${id}.bozukimza`, lastCode()), { ok: false, reason: "NOT_FOUND" });
  });

  test("kolla onay çalışır ve tekrar kullanılamaz", async () => {
    const started = await startPhoneVerification(A.tenant.id, "0532 900 00 22", IP);
    assert.equal(started.status, "sent");
    const handle = started.status === "sent" ? started.handle : "";
    assert.deepEqual(await confirmByHandle(handle, lastCode()), { ok: true, phone: "+905329000022" });
    assert.deepEqual(await readVerificationHandle(handle), { open: false }, "onaylanan kol kapanır");
    assert.deepEqual(await confirmByHandle(handle, lastCode()), { ok: false, reason: "NOT_FOUND" });
  });

  test("doğrulanmış numara için yeniden kod istenmez", async () => {
    await createCustomer(A.owner, { firstName: "Kaan", lastName: "Yüce", phone: "0532 900 00 30" });
    const started = await startPhoneVerification(A.tenant.id, "0532 900 00 30", IP);
    assert.equal(started.status, "sent");
    await confirmByHandle(started.status === "sent" ? started.handle : "", lastCode());
    assert.equal((await startPhoneVerification(A.tenant.id, "0532 900 00 30", IP)).status, "already_verified");
  });
});
