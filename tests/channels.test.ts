import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer, setConsent } from "@/modules/customers/service";
import { summarizeAudience } from "@/modules/campaigns/audience";
import { getCampaignDetail, previewCampaign, processCampaign } from "@/modules/campaigns/campaign-service";
import { addEmailTestRecipient, emailSendBlock, handleBrevoWebhook, saveEmailSettings, startEmailCampaign, startEmailTest, validateEmailContent } from "@/modules/campaigns/email-service";
import {
  completeInstagramOAuth,
  connectInstagramManually,
  createAutoReply,
  deleteAutoReply,
  disconnectInstagram,
  handleInstagramWebhook,
  instagramAuthorizeUrl,
  matchRule,
  setAutoReplyActive,
} from "@/modules/campaigns/instagram-service";
import { smsSegments } from "@/modules/campaigns/rules";
import { open } from "@/modules/campaigns/secret-box";
import { connectSms, refreshSmsStatuses, smsSendBlock, startSmsCampaign, startSmsTest, validateSmsBody } from "@/modules/campaigns/sms-service";
import { resolveUnsubscribe, unsubscribeByToken, unsubscribeToken } from "@/modules/campaigns/unsubscribe";
import { addTestRecipient } from "@/modules/campaigns/accounts";
import { POST as brevoPost } from "@/app/api/webhooks/brevo/route";
import { POST as instagramPost } from "@/app/api/webhooks/instagram/route";
import { POST as oneClickPost } from "@/app/api/abonelik/[token]/route";
import { makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

// ─────────────────────────────────────────────── Sahte sağlayıcılar

type Call = { host: string; method: string; path: string; body: any; headers: Headers; query: URLSearchParams };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
const netgsm = { headers: ["ORBITA", "ORBITAKLB"], sendCode: "00", report: [] as { jobid: string; number: string; status: number }[] };
const brevo = { status: 201 };
let counter = 0;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? "GET";
  const raw = init?.body;
  const body = raw instanceof URLSearchParams ? Object.fromEntries(raw) : raw ? JSON.parse(String(raw)) : null;
  const headers = new Headers(init?.headers);
  calls.push({ host: url.hostname, method, path: url.pathname, body, headers, query: url.searchParams });

  if (url.hostname === "api.netgsm.com.tr") {
    const auth = Buffer.from((headers.get("authorization") ?? "").slice(6), "base64").toString();
    if (auth !== "8501112233:dogru-sifre") return json({ code: "30", description: "invalid" }, 406);
    if (url.pathname === "/sms/rest/v2/msgheader") return json({ code: "00", msgheaders: netgsm.headers });
    if (url.pathname === "/sms/rest/v2/send") return json(netgsm.sendCode === "00" ? { code: "00", jobid: `J${++counter}`, description: "ok" } : { code: netgsm.sendCode }, netgsm.sendCode === "00" ? 200 : 406);
    if (url.pathname === "/sms/rest/v2/report") return json({ code: "00", jobs: netgsm.report });
  }
  if (url.hostname === "api.brevo.com") {
    if (brevo.status !== 201) return json({ code: "unauthorized", message: "Key not found" }, brevo.status);
    return json({ messageId: `<m${++counter}@smtp-relay.brevo.com>` }, 201);
  }
  if (url.hostname === "api.instagram.com" && url.pathname === "/oauth/access_token") {
    return json({ data: [{ access_token: "IG-short-token-0000000000", user_id: "900", permissions: "instagram_business_basic" }] });
  }
  if (url.hostname === "graph.instagram.com") {
    if (url.pathname === "/access_token") return json({ access_token: "IG-long-token-111111111111", token_type: "bearer", expires_in: 5184000 });
    if (url.pathname === "/refresh_access_token") return json({ access_token: "IG-refreshed-token-2222222222", token_type: "bearer", expires_in: 5184000 });
    if (url.pathname.endsWith("/me")) {
      const token = (headers.get("authorization") ?? "").slice(7);
      return json(token.includes("other") ? { user_id: "17841400000000002", username: "baska" } : { user_id: "17841400000000001", username: "orbita" });
    }
    if (url.pathname.endsWith("/me/subscribed_apps")) return json({ success: true });
    if (url.pathname.endsWith("/messages")) return json({ recipient_id: body?.recipient?.id, message_id: `mid.out.${++counter}` });
  }
  return json({ error: { message: `beklenmeyen istek ${method} ${url.href}` } }, 404);
}

const conflict = (code: string) => (e: unknown) => e instanceof ConflictError && e.code === code;
const byHost = (host: string, path?: string) => calls.filter((c) => c.host === host && (!path || c.path === path));

const ENV = {
  CHANNEL_TOKEN_SECRET: "test-only-channel-token-secret-0123456789",
  INSTAGRAM_APP_SECRET: "test-instagram-secret",
  INSTAGRAM_APP_ID: "ig-app-1",
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "ig-dogrulama",
};

const c: Record<string, { id: string; phone: string | null; email: string | null }> = {};

before(async () => {
  await resetDb();
  Object.assign(process.env, ENV);
  globalThis.fetch = fakeFetch as typeof fetch;
  A = await makeTenant("ca");
  B = await makeTenant("cb");
  const add = async (key: string, firstName: string, phone: string, email: string, channels: string[]) => {
    const created = await createCustomer(A.owner, { firstName, lastName: "Kanal", phone, email, consentChannels: channels, consentNote: "Kasa formu" });
    c[key] = { id: created.id, phone: created.phone, email: created.email };
  };
  await add("ali", "Ali", "0532 200 00 01", "ali@ornek.test", ["SMS", "EMAIL"]);
  await add("berk", "Berk", "0532 200 00 02", "", ["SMS"]);
  await add("cem", "Cem", "+49 1512 3456789", "cem@ornek.test", ["SMS", "EMAIL"]);
  await add("deniz", "Deniz", "0532 200 00 04", "deniz@ornek.test", []);
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.$disconnect();
});

describe("SMS (Netgsm)", () => {
  test("bağlantı: yalnızca işletme sahibi, başlık Netgsm'de onaylı olmalı, şifre şifreli saklanır", async () => {
    const input = { username: "8501112233", password: "dogru-sifre", msgheader: "orbita", legalFooter: "Orbita Ltd. MERSIS: 0123456789012345 · Ret için 0800 000 00 00" };
    await assert.rejects(connectSms(A.crm, input), ForbiddenError);
    await assert.rejects(connectSms(A.owner, { ...input, password: "yanlis" }), conflict("NETGSM_ERROR"));
    await assert.rejects(connectSms(A.owner, { ...input, msgheader: "BASKA" }), (e: unknown) => e instanceof ValidationError && /ORBITA, ORBITAKLB/.test(e.fieldErrors.msgheader?.[0] ?? ""));
    await assert.rejects(connectSms(A.owner, { ...input, legalFooter: "kısa" }), ValidationError);
    assert.deepEqual(await smsSendBlock(A.tenant.id), { code: "NO_SMS_ACCOUNT", message: "Netgsm SMS hesabı bağlı değil." });

    const account = await connectSms(A.owner, input);
    assert.equal(account.msgheader, "ORBITA", "Netgsm'deki yazımla kaydedilir");
    assert.ok(account.passwordEnc && !account.passwordEnc.includes("dogru"));
    assert.equal(open(account.passwordEnc), "dogru-sifre");
    assert.equal(await smsSendBlock(A.tenant.id), null);
    // Şifre boş bırakılırsa kayıtlı şifre kullanılır
    const updated = await connectSms(A.owner, { ...input, password: "", msgheader: "ORBITAKLB" });
    assert.equal(updated.msgheader, "ORBITAKLB");
  });

  test("kitle: SMS izni ve Türkiye numarası gerekir; metin ve SMS adedi kuralları", async () => {
    const s = await summarizeAudience(A.crm, { kind: "SEGMENT", key: "SMS_CONSENTED" }, new Date(), "SMS");
    assert.deepEqual([s.total, s.reachable, s.sendable, s.exclusions.FOREIGN_NUMBER], [3, 3, 2, 1], "Cem'in numarası yurt dışı");
    const all = await summarizeAudience(A.crm, { kind: "SELECTED", customerIds: Object.values(c).map((x) => x.id) }, new Date(), "SMS");
    assert.equal(all.exclusions.NO_CONSENT, 1, "Deniz'in SMS izni yok");
    const preview = await previewCampaign(A.crm, { audience: { kind: "SEGMENT", key: "SMS_CONSENTED" }, channel: "SMS" });
    assert.deepEqual([preview.channel, preview.sendable, preview.liveBlock, preview.estimatedCostMicroUsd], ["SMS", 2, null, 0]);

    assert.throws(() => validateSmsBody("hi"), ValidationError);
    assert.throws(() => validateSmsBody("Merhaba {{isim}} bu cuma bekleriz"), ValidationError);
    assert.equal(validateSmsBody("  Merhaba {{ad}}, bu cuma bekleriz  "), "Merhaba {{ad}}, bu cuma bekleriz");
    assert.deepEqual(smsSegments("ş".repeat(155)), { segments: 1, unicode: false, length: 155 });
    assert.equal(smsSegments("a".repeat(156)).segments, 2);
    assert.equal(smsSegments("Merhaba 🎉").unicode, true);
  });

  test("canlı gönderim: İYS filtresiyle, kişiye özel metin + yasal bilgi; gönderim anında izin yeniden kontrol edilir", async () => {
    const campaign = await startSmsCampaign(A.crm, { audience: { kind: "SEGMENT", key: "SMS_CONSENTED" }, body: "Merhaba {{ad}}, cuma DJ gecesi!" });
    assert.equal(campaign.recipientCount, 2);
    await setConsent(A.owner, { customerId: c.berk.id, channel: "SMS", grant: false });
    const before = byHost("api.netgsm.com.tr", "/sms/rest/v2/send").length;
    await processCampaign(campaign.id);
    const sends = byHost("api.netgsm.com.tr", "/sms/rest/v2/send").slice(before);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].body.iysfilter, "11");
    assert.equal(sends[0].body.encoding, "TR");
    assert.equal(sends[0].body.msgheader, "ORBITAKLB");
    assert.deepEqual(sends[0].body.messages, [{ msg: "Merhaba Ali, cuma DJ gecesi!\nOrbita Ltd. MERSIS: 0123456789012345 · Ret için 0800 000 00 00", no: "5322000001" }]);

    const detail = await getCampaignDetail(A.crm, campaign.id);
    assert.equal(detail.channel, "SMS");
    assert.equal(detail.status, "COMPLETED");
    assert.deepEqual([detail.counts.ACCEPTED, detail.counts.SKIPPED], [1, 1]);
    assert.equal(detail.messages.find((m) => m.status === "SKIPPED")?.skipReason, "NO_CONSENT");
    assert.equal(detail.content.body, "Merhaba {{ad}}, cuma DJ gecesi!");
  });

  test("teslim raporu Netgsm'den okunur; İYS reddi 'gönderilmedi' olur; başka işletme sorgulayamaz", async () => {
    await addTestRecipient(A.owner, { label: "Selin Müdür", phone: "0532 999 00 01", confirmed: "on" });
    await addTestRecipient(A.owner, { label: "Yurt dışı", phone: "+49 1512 0000000", confirmed: "on" });
    const test = await startSmsTest(A.crm, { body: "Deneme {{ad}}" });
    assert.equal(test.recipientCount, 1, "SMS testi yalnızca Türkiye numaralarına");
    await processCampaign(test.id);
    const sent = byHost("api.netgsm.com.tr", "/sms/rest/v2/send").at(-1)!;
    assert.equal(sent.body.iysfilter, "0");
    assert.match(sent.body.messages[0].msg, /^TEST: Deneme Selin\n/);

    const live = await startSmsCampaign(A.owner, { audience: { kind: "SELECTED", customerIds: [c.ali.id] }, body: "Tekrar merhaba" });
    await processCampaign(live.id);
    const msg = await db.campaignMessage.findFirstOrThrow({ where: { campaignId: live.id } });
    netgsm.report = [{ jobid: msg.providerMessageId!, number: "905322000001", status: 16 }];
    await assert.rejects(refreshSmsStatuses(B.owner, live.id), NotFoundError);
    assert.deepEqual(await refreshSmsStatuses(A.crm, live.id), { updated: 1 });
    const after16 = await db.campaignMessage.findUniqueOrThrow({ where: { id: msg.id } });
    assert.deepEqual([after16.status, after16.skipReason], ["SKIPPED", "IYS_NOT_APPROVED"]);

    const testMsg = await db.campaignMessage.findFirstOrThrow({ where: { campaignId: test.id } });
    netgsm.report = [{ jobid: testMsg.providerMessageId!, number: "5329990001", status: 1 }];
    await refreshSmsStatuses(A.crm, test.id);
    assert.equal((await db.campaignMessage.findUniqueOrThrow({ where: { id: testMsg.id } })).status, "DELIVERED");
  });

  test("hesap ayarı hatasında (İYS markası yok) mesajlar başarısız olur ve tekrar denenmez", async () => {
    netgsm.sendCode = "51";
    const campaign = await startSmsCampaign(A.owner, { audience: { kind: "SELECTED", customerIds: [c.ali.id] }, body: "Kampanya" });
    await processCampaign(campaign.id);
    const m = await db.campaignMessage.findFirstOrThrow({ where: { campaignId: campaign.id } });
    assert.equal(m.status, "FAILED");
    assert.equal(m.errorCode, "NETGSM_51");
    assert.match(m.errorMessage ?? "", /İYS/);
    netgsm.sendCode = "00";
    await assert.rejects(startSmsCampaign(B.owner, { audience: { kind: "SEGMENT", key: "SMS_CONSENTED" }, body: "Kampanya" }), conflict("NO_SMS_ACCOUNT"));
  });
});

describe("E-posta (Brevo)", () => {
  test("kurulum: servis ve gönderici ayarları olmadan gönderim kapalı; ayarları yalnızca sahip değiştirir", async () => {
    assert.equal((await emailSendBlock(A.tenant.id))?.code, "EMAIL_NOT_CONFIGURED");
    process.env.BREVO_API_KEY = "xkeysib-test";
    process.env.BREVO_SENDER_EMAIL = "Kampanya@Mail.Circular.Test";
    process.env.BREVO_WEBHOOK_TOKEN = "brevo-gizli-anahtar";
    assert.equal((await emailSendBlock(A.tenant.id))?.code, "NO_EMAIL_SETTINGS");
    const settings = { senderName: "Orbita Kulüp", replyTo: "info@orbita.test", legalFooter: "Orbita Ltd. · Moda Cad. 1, İstanbul · MERSIS 0123456789012345" };
    await assert.rejects(saveEmailSettings(A.crm, settings), ForbiddenError);
    await assert.rejects(saveEmailSettings(A.owner, { ...settings, replyTo: "gecersiz" }), ValidationError);
    await saveEmailSettings(A.owner, settings);
    assert.equal(await emailSendBlock(A.tenant.id), null);

    assert.throws(() => validateEmailContent({ subject: "Cuma", body: "Bu cuma bekliyoruz.", ctaLabel: "Liste", ctaUrl: "javascript:alert(1)" }), ValidationError);
    assert.throws(() => validateEmailContent({ subject: "Cu", body: "Bu cuma bekliyoruz." }), ValidationError);
  });

  test("gönderim: Circular adresinden işletme adıyla, yasal bilgi ve tek tıkla abonelikten çıkma ile", async () => {
    const s = await summarizeAudience(A.crm, { kind: "SEGMENT", key: "EMAIL_CONSENTED" }, new Date(), "EMAIL");
    assert.deepEqual([s.total, s.sendable], [2, 2]);
    const campaign = await startEmailCampaign(A.crm, {
      audience: { kind: "SEGMENT", key: "EMAIL_CONSENTED" },
      subject: "Cuma gecesi",
      body: "Merhaba {{ad}},\n\nBu cuma <b>DJ</b> gecesi var.",
      ctaLabel: "Listeye yazıl",
      ctaUrl: "https://orbita.test/liste",
    });
    const before = byHost("api.brevo.com").length;
    await processCampaign(campaign.id);
    const requests = byHost("api.brevo.com").slice(before);
    assert.equal(requests.length, 2);
    const toAli = requests.find((r) => r.body.to[0].email === "ali@ornek.test")!;
    assert.deepEqual(toAli.body.sender, { name: "Orbita Kulüp", email: "kampanya@mail.circular.test" });
    assert.deepEqual(toAli.body.replyTo, { email: "info@orbita.test" });
    assert.equal(toAli.headers.get("api-key"), "xkeysib-test");
    const html: string = toAli.body.htmlContent;
    assert.match(html, /Merhaba Ali,/);
    assert.match(html, /&lt;b&gt;DJ&lt;\/b&gt;/, "metin HTML olarak kaçırılır");
    assert.match(html, /MERSIS 0123456789012345/);
    assert.match(html, /href="https:\/\/orbita\.test\/liste"/);
    const aliMsg = await db.campaignMessage.findFirstOrThrow({ where: { campaignId: campaign.id, customerId: c.ali.id } });
    assert.match(html, new RegExp(`/abonelik/${aliMsg.id}\\.`));
    assert.match(toAli.body.headers["List-Unsubscribe"], new RegExp(`/api/abonelik/${aliMsg.id}\\.`));
    assert.equal(toAli.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.equal(aliMsg.status, "ACCEPTED");
    assert.match(aliMsg.providerMessageId ?? "", /@smtp-relay\.brevo\.com>$/);
  });

  test("Brevo bildirimleri: anahtar zorunlu; teslim, açılma, tıklama, geri dönme ve spam şikâyeti işlenir", async () => {
    const msgs = await db.campaignMessage.findMany({ where: { campaign: { channel: "EMAIL", mode: "LIVE" } }, orderBy: { createdAt: "asc" } });
    const ali = msgs.find((m) => m.customerId === c.ali.id)!;
    const cem = msgs.find((m) => m.customerId === c.cem.id)!;
    const post = (body: unknown, auth?: string) =>
      brevoPost(new NextRequest("http://test.local/api/webhooks/brevo", { method: "POST", body: JSON.stringify(body), headers: auth ? { authorization: auth } : {} }));
    const event = (m: typeof ali, e: string, extra: Record<string, unknown> = {}) => ({ event: e, email: m.toEmail, "message-id": m.providerMessageId, ts_event: 1790000000, ...extra });

    assert.equal((await post(event(ali, "delivered"))).status, 401);
    assert.equal((await post(event(ali, "delivered"), "Bearer yanlis")).status, 401);
    assert.equal((await post(event(ali, "delivered"), "Bearer brevo-gizli-anahtar")).status, 200);
    await handleBrevoWebhook([event(ali, "unique_opened"), event(ali, "click"), event(cem, "hard_bounce", { reason: "Mailbox does not exist" })]);
    await handleBrevoWebhook(event(ali, "delivered", { email: "baska@ornek.test" })); // e-posta eşleşmezse yok sayılır
    await handleBrevoWebhook({ event: "delivered", "message-id": "<yok@x>" });

    const aliAfter = await db.campaignMessage.findUniqueOrThrow({ where: { id: ali.id } });
    assert.equal(aliAfter.status, "DELIVERED");
    assert.ok(aliAfter.openedAt && aliAfter.clickedAt);
    const cemAfter = await db.campaignMessage.findUniqueOrThrow({ where: { id: cem.id } });
    assert.deepEqual([cemAfter.status, cemAfter.errorMessage], ["FAILED", "Mailbox does not exist"]);
    // Kalıcı teslim hatasında adres susturulur; aynı adrese bir daha gönderilmez.
    const cemConsent = await db.contactConsent.findUniqueOrThrow({ where: { customerId_channel: { customerId: c.cem.id, channel: "EMAIL" } } });
    assert.equal(cemConsent.status, "REVOKED", "hard bounce sonrası e-posta izni kaldırılır");
    const bounceLog = await db.activityLog.findFirstOrThrow({ where: { customerId: c.cem.id, action: "consent.revoked" } });
    assert.match(bounceLog.metadata ?? "", /HARD_BOUNCE/);
    const detail = await getCampaignDetail(A.crm, ali.campaignId);
    assert.deepEqual(detail.engagement, { opened: 1, clicked: 1 });

    await handleBrevoWebhook(event(ali, "spam"));
    assert.equal((await db.contactConsent.findUniqueOrThrow({ where: { customerId_channel: { customerId: c.ali.id, channel: "EMAIL" } } })).status, "REVOKED");
    const log = await db.activityLog.findFirstOrThrow({ where: { customerId: c.ali.id, action: "consent.revoked" } });
    assert.equal(log.actorUserId, null);
    assert.match(log.metadata ?? "", /SPAM_COMPLAINT/);
  });

  test("abonelikten çıkma bağlantısı: imzalı, tek tıkla ve sayfadan çalışır, tekrar edilebilir", async () => {
    const cem = await db.campaignMessage.findFirstOrThrow({ where: { customerId: c.cem.id, campaign: { channel: "EMAIL" } } });
    // Önceki test hard bounce ile izni kaldırdı; bu test çıkış bağlantısını izinli bir kişiyle dener.
    await db.contactConsent.update({
      where: { customerId_channel: { customerId: c.cem.id, channel: "EMAIL" } },
      data: { status: "GRANTED", revokedAt: null },
    });
    await db.activityLog.deleteMany({ where: { customerId: c.cem.id, action: "consent.revoked" } });
    const token = unsubscribeToken(cem.id);
    assert.equal(await resolveUnsubscribe(`${cem.id}.bozuk-imza-000000000000`), null);
    assert.equal(await resolveUnsubscribe(unsubscribeToken("baskamesaj0000000000000")), null);
    assert.deepEqual(await resolveUnsubscribe(token), { tenantName: "Tenant ca", test: false, alreadyRevoked: false });

    const res = await oneClickPost(new NextRequest(`http://test.local/api/abonelik/${token}`, { method: "POST", body: "List-Unsubscribe=One-Click" }), {
      params: Promise.resolve({ token }),
    });
    assert.equal(res.status, 200);
    assert.equal((await db.contactConsent.findUniqueOrThrow({ where: { customerId_channel: { customerId: c.cem.id, channel: "EMAIL" } } })).status, "REVOKED");
    assert.deepEqual(await unsubscribeByToken(token), { ok: true });
    assert.equal(await db.activityLog.count({ where: { customerId: c.cem.id, action: "consent.revoked" } }), 1, "ikinci çağrı yeni kayıt oluşturmaz");
    assert.equal((await resolveUnsubscribe(token))?.alreadyRevoked, true);
  });

  test("test e-postası ve Brevo anahtar hatasında gönderimin durması", async () => {
    await addEmailTestRecipient(A.crm, { label: "Selin Müdür", email: "selin@orbita.test", confirmed: "on" });
    await addEmailTestRecipient(A.crm, { label: "Kasa", email: "kasa@orbita.test", confirmed: "on" });
    await assert.rejects(addEmailTestRecipient(A.crm, { label: "Onaysız", email: "x@orbita.test" }), ValidationError);
    const test = await startEmailTest(A.crm, { subject: "Deneme", body: "Merhaba {{ad}}, deneme." });
    brevo.status = 401;
    await processCampaign(test.id);
    const failed = await db.campaignMessage.findMany({ where: { campaignId: test.id } });
    assert.ok(failed.every((m) => m.status === "FAILED" && m.errorCode === "BREVO_unauthorized"));
    assert.equal(byHost("api.brevo.com").filter((r) => r.body.subject === "[TEST] Deneme").length <= 2, true);
    brevo.status = 201;
    const again = await startEmailTest(A.crm, { subject: "Deneme 2", body: "Merhaba {{ad}}, deneme." });
    await processCampaign(again.id);
    const req = byHost("api.brevo.com").at(-1)!;
    assert.equal(req.body.subject, "[TEST] Deneme 2");
    assert.match(req.body.htmlContent, /Bu bir test e-postasıdır/);
  });
});

describe("Instagram DM otomasyonu", () => {
  const sign = (raw: string) => `sha256=${createHmac("sha256", "test-instagram-secret").update(raw).digest("hex")}`;
  const dm = (from: string, text: string, mid: string, extra: Record<string, unknown> = {}) => ({
    object: "instagram",
    entry: [{ id: "17841400000000001", time: 1, messaging: [{ sender: { id: from }, recipient: { id: "17841400000000001" }, timestamp: 1, message: { mid, text, ...extra } }] }],
  });

  test("anahtar kelime eşleşmesi Türkçe karakter ve noktalamaya duyarsız", () => {
    const rules = [
      { id: "r2", keywords: "liste", matchType: "CONTAINS", replyText: "", createdAt: new Date(2) },
      { id: "r1", keywords: "menu,fiyat", matchType: "EXACT", replyText: "", createdAt: new Date(1) },
    ];
    assert.equal(matchRule("Menü!", rules)?.id, "r1");
    assert.equal(matchRule("  FİYAT ", rules)?.id, "r1");
    assert.equal(matchRule("menü var mı", rules), null, "tam eşleşme kuralı cümle içinde çalışmaz");
    assert.equal(matchRule("cuma liste var mı?", rules)?.id, "r2");
    assert.equal(matchRule("listeye yazıl", rules), null, "kelime içinde geçmesi yetmez");
  });

  test("bağlantı: yetkilendirme adresi imzalı state taşır; dönüşte token 60 günlük olur ve DM bildirimine abone olunur", async () => {
    await assert.rejects(instagramAuthorizeUrl(A.crm), ForbiddenError);
    const url = new URL(await instagramAuthorizeUrl(A.owner));
    assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
    assert.equal(url.searchParams.get("scope"), "instagram_business_basic,instagram_business_manage_messages");
    assert.equal(url.searchParams.get("redirect_uri"), "http://test.local/api/instagram/callback");
    const state = url.searchParams.get("state")!;
    await assert.rejects(completeInstagramOAuth(A.owner, { code: "kod#_", state: state.replace(/.$/, "x") }), conflict("INVALID_STATE"));
    await assert.rejects(completeInstagramOAuth(B.owner, { code: "kod#_", state }), conflict("INVALID_STATE"), "başka işletmenin state'i kullanılamaz");

    const account = await completeInstagramOAuth(A.owner, { code: "kod#_", state });
    assert.deepEqual([account.igUserId, account.username, account.connectionMethod], ["17841400000000001", "orbita", "OAUTH"]);
    assert.equal(open(account.accessTokenEnc), "IG-long-token-111111111111");
    const exchange = byHost("api.instagram.com").at(-1)!;
    assert.equal(exchange.body.code, "kod", "kodun sonundaki #_ çıkarılır");
    assert.ok(byHost("graph.instagram.com").some((r) => r.path.endsWith("/me/subscribed_apps") && r.query.get("subscribed_fields") === "messages"));

    process.env.INSTAGRAM_MANUAL_CONNECT = "true";
    await assert.rejects(connectInstagramManually(B.owner, { accessToken: "IG-long-token-111111111111" }), conflict("INSTAGRAM_IN_USE"));
  });

  test("kurallar: yetki, çakışan anahtar kelime ve bayt sınırı", async () => {
    await assert.rejects(createAutoReply(A.door, { keywords: "menü", matchType: "EXACT", replyText: "x" }), ForbiddenError);
    const menu = await createAutoReply(A.crm, { keywords: "Menü, fiyat", matchType: "EXACT", replyText: "Menümüz: {menu}" });
    assert.equal(menu.keywords, "menu,fiyat");
    await assert.rejects(createAutoReply(A.crm, { keywords: "FİYAT", matchType: "EXACT", replyText: "x" }), ValidationError, "aynı kelime başka kuralda");
    await assert.rejects(createAutoReply(A.crm, { keywords: "uzun", matchType: "EXACT", replyText: "ş".repeat(600) }), ValidationError, "1000 bayt sınırı");
    const list = await createAutoReply(A.crm, { keywords: "liste", matchType: "CONTAINS", replyText: "Üye olun: {kayit}" });
    await setAutoReplyActive(A.crm, list.id, false);
    await assert.rejects(setAutoReplyActive(B.crm, list.id, true), NotFoundError);
    await setAutoReplyActive(A.crm, list.id, true);
    const temp = await createAutoReply(A.crm, { keywords: "gecici", matchType: "EXACT", replyText: "Geçici yanıt" });
    await deleteAutoReply(A.crm, temp.id);
    assert.equal(await db.activityLog.count({ where: { tenantId: A.tenant.id, action: "instagram.rule_changed" } }), 6, "ekle ×3, kapat, aç, sil");
  });

  test("DM bildirimi: imza, otomatik yanıt, tekrar eden bildirim ve 10 dakikalık tekrar sınırı", async () => {
    const post = (payload: unknown, signed = true) => {
      const raw = JSON.stringify(payload);
      return instagramPost(new NextRequest("http://test.local/api/webhooks/instagram", { method: "POST", body: raw, headers: signed ? { "x-hub-signature-256": sign(raw) } : {} }));
    };
    const sendsBefore = byHost("graph.instagram.com").filter((r) => r.path.endsWith("/messages")).length;
    assert.equal((await post(dm("555", "menü", "mid.1"), false)).status, 401);
    assert.equal((await post(dm("555", "menü", "mid.1"))).status, 200);
    assert.equal((await post(dm("555", "menü", "mid.1"))).status, 200, "aynı mesaj tekrar gelir");
    await handleInstagramWebhook(dm("555", "Menü?", "mid.2")); // 10 dk içinde aynı kişi
    await handleInstagramWebhook(dm("777", "cuma liste var mı", "mid.3"));
    await handleInstagramWebhook(dm("17841400000000001", "menü", "mid.4")); // hesabın kendi mesajı
    await handleInstagramWebhook(dm("888", "menü", "mid.5", { is_echo: true }));
    await handleInstagramWebhook(dm("999", "merhaba", "mid.6")); // kural yok

    const replies = byHost("graph.instagram.com").filter((r) => r.path.endsWith("/messages")).slice(sendsBefore);
    assert.deepEqual(replies.map((r) => r.body.recipient.id), ["555", "777"]);
    assert.equal(replies[0].path, "/v26.0/17841400000000001/messages");
    assert.equal(replies[0].body.message.text, "Menümüz: http://test.local/m/ca");
    assert.equal(replies[1].body.message.text, "Üye olun: http://test.local/m/ca/katil");
    assert.equal(replies[0].headers.get("authorization"), "Bearer IG-long-token-111111111111");

    const logs = await db.instagramReplyLog.findMany({ where: { tenantId: A.tenant.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(logs.map((l) => l.status), ["SENT", "COOLDOWN", "SENT"]);
    // Ham kimlik saklanmamalı. Özetin İÇİNDE "555" aramak yanlış olur: rastgele bir SHA-256
    // hex dizisi bu üçlüyü tesadüfen içerebilir ve test ara sıra düşerdi.
    assert.ok(
      logs.every((l) => /^[a-f0-9]{64}$/.test(l.senderHash) && l.senderHash !== "555" && l.senderHash !== "777"),
      "kişi kimliği düz saklanmaz",
    );
    const menuRule = await db.instagramAutoReply.findFirstOrThrow({ where: { tenantId: A.tenant.id, keywords: "menu,fiyat" } });
    assert.equal(menuRule.replyCount, 1);
  });

  test("süresi dolmak üzere olan token yenilenir; bağlantı kesilince yanıt verilmez", async () => {
    await db.instagramAccount.update({ where: { tenantId: A.tenant.id }, data: { tokenExpiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000) } });
    await handleInstagramWebhook(dm("1234", "fiyat", "mid.7"));
    assert.ok(byHost("graph.instagram.com", "/refresh_access_token").length >= 1);
    const account = await db.instagramAccount.findUniqueOrThrow({ where: { tenantId: A.tenant.id } });
    assert.equal(open(account.accessTokenEnc), "IG-refreshed-token-2222222222");
    assert.equal(byHost("graph.instagram.com").filter((r) => r.path.endsWith("/messages")).at(-1)?.headers.get("authorization"), "Bearer IG-refreshed-token-2222222222");

    await assert.rejects(disconnectInstagram(A.crm), ForbiddenError);
    await disconnectInstagram(A.owner);
    const before = byHost("graph.instagram.com").filter((r) => r.path.endsWith("/messages")).length;
    await handleInstagramWebhook(dm("4321", "fiyat", "mid.8"));
    assert.equal(byHost("graph.instagram.com").filter((r) => r.path.endsWith("/messages")).length, before);
  });
});
