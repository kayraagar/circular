import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { localDayKey } from "@/lib/datetime";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createCustomer, setConsent, setCustomerArchived } from "@/modules/customers/service";
import { addTestRecipient, completeEmbeddedSignup, connectWhatsAppManually, disconnectWhatsApp, getChannelOverview } from "@/modules/campaigns/accounts";
import { getAudienceOptions, searchAudienceCustomers, summarizeAudience, type AudienceSpec } from "@/modules/campaigns/audience";
import { getCampaignDetail, listCampaigns, previewCampaign, processCampaign, startLiveCampaign, startTestCampaign } from "@/modules/campaigns/campaign-service";
import { setIysGatewayForTesting } from "@/modules/campaigns/iys";
import { OPT_OUT_PAYLOAD, isOptOutText, isStatusAdvance, templateNameFrom } from "@/modules/campaigns/rules";
import { open } from "@/modules/campaigns/secret-box";
import { createTemplate, refreshTemplateStatus, validateTemplateInput } from "@/modules/campaigns/templates";
import { handleWhatsAppWebhook, verifyWhatsAppSignature } from "@/modules/campaigns/webhook";
import { GET as webhookGet, POST as webhookPost } from "@/app/api/webhooks/whatsapp/route";
import { makeTenant, resetDb } from "./helpers";

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let B: T;

// ─────────────────────────────────────────────── Sahte Meta Graph API

type Call = { method: string; path: string; body: Record<string, any> | null; auth: string | null };
const calls: Call[] = [];
const failingPhones = new Set<string>();
const realFetch = globalThis.fetch;
let wamidCounter = 0;
let templateCounter = 0;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeGraph(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.hostname, "graph.facebook.com");
  const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const headers = new Headers(init?.headers);
  calls.push({ method, path, body, auth: headers.get("authorization") });

  if (path === "oauth/access_token") return Promise.resolve(json({ access_token: "EAAG-signup-business-token-000111" }));
  if (path.endsWith("/subscribed_apps")) return Promise.resolve(json({ success: true }));
  if (path.endsWith("/register")) return Promise.resolve(json({ success: true }));
  if (path.endsWith("/message_templates")) return Promise.resolve(json({ id: `90${++templateCounter}`, status: "PENDING", category: "MARKETING" }));
  if (path.endsWith("/messages")) {
    if (failingPhones.has(body?.to)) return Promise.resolve(json({ error: { message: "Recipient phone number not in allowed list", code: 131030 } }, 400));
    return Promise.resolve(json({ messages: [{ id: `wamid.${++wamidCounter}` }] }));
  }
  if (method === "GET" && url.searchParams.get("fields") === "status,rejected_reason") return Promise.resolve(json({ status: "APPROVED", rejected_reason: "NONE" }));
  if (method === "GET" && url.searchParams.get("fields")?.includes("display_phone_number")) {
    return Promise.resolve(json({ display_phone_number: `+90 850 000 ${path.slice(-4)}`, verified_name: "Test İşletme", quality_rating: "GREEN" }));
  }
  return Promise.resolve(json({ error: { message: `beklenmeyen istek ${method} ${path}` } }, 404));
}

const sends = () => calls.filter((c) => c.path.endsWith("/messages"));
const conflict = (code: string) => (e: unknown) => e instanceof ConflictError && e.code === code;

const APP_SECRET = "test-meta-app-secret";
const ENV = {
  CHANNEL_TOKEN_SECRET: "test-only-channel-token-secret-0123456789",
  WHATSAPP_MANUAL_CONNECT: "true",
  META_APP_SECRET: APP_SECRET,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "dogrulama-123",
};

function sign(body: string) {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

const DAY = 24 * 3600 * 1000;
const c: Record<string, { id: string; phone: string | null }> = {};
let templateId = "";

before(async () => {
  await resetDb();
  Object.assign(process.env, ENV);
  globalThis.fetch = fakeGraph as typeof fetch;
  A = await makeTenant("ka");
  B = await makeTenant("kb");
});

after(async () => {
  globalThis.fetch = realFetch;
  setIysGatewayForTesting(null);
  await db.$disconnect();
});

describe("WhatsApp kampanyaları", () => {
  test("bağlantı: yalnızca işletme sahibi bağlar, token şifreli saklanır, numara başka işletmeye bağlanamaz", async () => {
    const input = { wabaId: "100200300", phoneNumberId: "5550001111", accessToken: "EAAG-manual-test-token-abcdef" };
    await assert.rejects(connectWhatsAppManually(A.crm, input), ForbiddenError);
    process.env.WHATSAPP_MANUAL_CONNECT = "false";
    await assert.rejects(connectWhatsAppManually(A.owner, input), conflict("MANUAL_CONNECT_DISABLED"));
    process.env.WHATSAPP_MANUAL_CONNECT = "true";
    await assert.rejects(connectWhatsAppManually(A.owner, { ...input, wabaId: "abc" }), ValidationError);

    const view = await connectWhatsAppManually(A.owner, input);
    assert.equal(view.status, "ACTIVE");
    assert.equal(view.displayPhoneNumber, "+90 850 000 1111");
    const row = await db.whatsAppAccount.findUniqueOrThrow({ where: { tenantId: A.tenant.id } });
    assert.ok(row.accessTokenEnc && !row.accessTokenEnc.includes("EAAG"), "token düz metin saklanmaz");
    assert.equal(open(row.accessTokenEnc), input.accessToken);
    assert.equal(calls.at(-1)?.auth, `Bearer ${input.accessToken}`);

    await assert.rejects(connectWhatsAppManually(B.owner, { ...input, wabaId: "999888777" }), conflict("PHONE_IN_USE"));

    // Embedded Signup: Meta uygulaması tanımlı değilse kapalı
    const signup = { code: "AQD-short-lived-code", wabaId: "700800900", phoneNumberId: "5550002222" };
    await assert.rejects(completeEmbeddedSignup(B.owner, signup), conflict("META_NOT_CONFIGURED"));
    process.env.META_APP_ID = "123456";
    process.env.WHATSAPP_ES_CONFIG_ID = "654321";
    const before = calls.length;
    const b = await completeEmbeddedSignup(B.owner, signup);
    assert.equal(b.connectionMethod, "EMBEDDED_SIGNUP");
    const flow = calls.slice(before).map((x) => `${x.method} ${x.path}`);
    assert.deepEqual(flow, ["GET oauth/access_token", "POST 700800900/subscribed_apps", "POST 5550002222/register", "GET 5550002222"]);
    assert.match(calls[before + 2].body?.pin, /^\d{6}$/);
    const bRow = await db.whatsAppAccount.findUniqueOrThrow({ where: { tenantId: B.tenant.id } });
    assert.match(open(bRow.registrationPinEnc) ?? "", /^\d{6}$/);
  });

  test("şablon: kurallar doğrulanır, Meta'ya pazarlama şablonu olarak gider, onay bildirimle gelir", async () => {
    assert.equal(templateNameFrom("Hafta Sonu İndirimi!"), "hafta_sonu_indirimi");
    const good = { name: "Cuma Daveti", headerText: "Bu Cuma", bodyText: "Merhaba {{ad}}, bu cuma seni bekliyoruz.", footerText: "Almak istemiyorsanız DUR yazın.", optOutLabel: "Abonelikten çık" };
    assert.deepEqual(validateTemplateInput(good).errors, {});
    assert.ok(validateTemplateInput({ ...good, bodyText: "Merhaba {{isim}}, bu cuma bekliyoruz." }).errors.bodyText);
    assert.ok(validateTemplateInput({ ...good, bodyText: "{{ad}} bu cuma seni bekliyoruz." }).errors.bodyText);
    assert.ok(validateTemplateInput({ ...good, bodyText: "Bu cuma seni bekliyoruz {{ad}}." }).errors.bodyText);
    assert.ok(validateTemplateInput({ ...good, footerText: "" }).errors.footerText, "ret bilgisi zorunlu");
    assert.ok(validateTemplateInput({ ...good, headerText: "Merhaba {{ad}}" }).errors.headerText);

    await assert.rejects(createTemplate(A.door, good), ForbiddenError);
    const template = await createTemplate(A.crm, good);
    assert.equal(template.status, "PENDING");
    assert.equal(template.name, "cuma_daveti");
    const req = calls.at(-1)!;
    assert.equal(req.path, "100200300/message_templates");
    assert.equal(req.body?.category, "MARKETING");
    assert.equal(req.body?.parameter_format, "named");
    assert.deepEqual(req.body?.components.map((x: { type: string }) => x.type), ["HEADER", "BODY", "FOOTER", "BUTTONS"]);
    assert.deepEqual(req.body?.components[1].example, { body_text_named_params: [{ param_name: "ad", example: "Ayşe" }] });
    assert.deepEqual(req.body?.components[3].buttons, [{ type: "QUICK_REPLY", text: "Abonelikten çık" }]);
    await assert.rejects(createTemplate(A.crm, good), ValidationError, "aynı ad");

    // Başka hesabın bildirimi şablonu değiştiremez
    const notify = (wabaId: string) => ({
      object: "whatsapp_business_account",
      entry: [{ id: wabaId, changes: [{ field: "message_template_status_update", value: { event: "APPROVED", message_template_id: Number(template.metaTemplateId), reason: "NONE" } }] }],
    });
    assert.equal((await handleWhatsAppWebhook(notify("700800900"))).templates, 0);
    assert.equal((await db.messageTemplate.findUniqueOrThrow({ where: { id: template.id } })).status, "PENDING");
    assert.equal((await handleWhatsAppWebhook(notify("100200300"))).templates, 1);
    assert.equal((await db.messageTemplate.findUniqueOrThrow({ where: { id: template.id } })).status, "APPROVED");
    templateId = template.id;

    const second = await createTemplate(A.owner, { ...good, name: "Doğum Günü" });
    assert.equal((await refreshTemplateStatus(A.owner, second.id)).status, "APPROVED");
    await assert.rejects(refreshTemplateStatus(B.owner, second.id), NotFoundError);
  });

  test("kitleler gerçek kayıtlardan hesaplanır; arşiv ve diğer işletme hariç", async () => {
    const venue = A.venue.id;
    const add = async (key: string, firstName: string, phone: string | null, extra: Record<string, unknown> = {}) => {
      const created = await createCustomer(A.owner, { firstName, lastName: "Kitle", phone: phone ?? "", email: phone ? "" : `${key}@ornek.test`, ...extra });
      c[key] = { id: created.id, phone: created.phone };
    };
    const consent = { consentChannels: ["WHATSAPP"], consentNote: "Kasa formu" };
    const month = localDayKey(new Date()).slice(5, 7);
    await add("ali", "Ali", "0532 100 00 01", consent);
    await add("berk", "Berk", "0532 100 00 02", consent);
    await add("cem", "Cem", "0532 100 00 03");
    await add("deniz", "Deniz", null);
    await add("ece", "Ece", "0532 100 00 05", { ...consent, birthDate: `1995-${month}-10` });
    await add("fatih", "Fatih", "0532 100 00 06", consent);
    await add("filiz", "Filiz", "0532 100 00 07", consent);
    await setCustomerArchived(A.owner, c.fatih.id, true);
    const other = await createCustomer(B.owner, { firstName: "Başka", lastName: "İşletme", phone: "0532 100 00 01", consentChannels: ["WHATSAPP"], consentNote: "Form" });

    const now = Date.now();
    const pastEvent = await db.event.create({ data: { tenantId: A.tenant.id, venueId: venue, name: "Eski Gece", status: "PUBLISHED", startsAt: new Date(now - 46 * DAY), endsAt: new Date(now - 45 * DAY) } });
    const recentEvent = await db.event.create({ data: { tenantId: A.tenant.id, venueId: venue, name: "Yakın Gece", status: "PUBLISHED", startsAt: new Date(now - 4 * DAY), endsAt: new Date(now - 3 * DAY) } });
    const visit = async (customerId: string, eventId: string, at: Date) => {
      const reg = await db.eventRegistration.create({ data: { tenantId: A.tenant.id, eventId, customerId, channel: "STAFF" } });
      await db.checkIn.create({ data: { tenantId: A.tenant.id, eventId, registrationId: reg.id, customerId, method: "MANUAL", checkedInAt: at } });
    };
    await visit(c.ali.id, pastEvent.id, new Date(now - 45 * DAY));
    await visit(c.berk.id, recentEvent.id, new Date(now - 3 * DAY));
    await db.eventRegistration.create({ data: { tenantId: A.tenant.id, eventId: recentEvent.id, customerId: c.filiz.id, channel: "STAFF" } });
    const perk = await db.perk.create({ data: { tenantId: A.tenant.id, name: "Hoş geldin içeceği" } });
    const pass = await db.pass.create({ data: { tenantId: A.tenant.id, purpose: "PERK_REDEMPTION", tokenHash: "kitle-test", customerId: c.cem.id, perkId: perk.id } });
    await db.perkRedemption.create({ data: { tenantId: A.tenant.id, perkId: perk.id, passId: pass.id, customerId: c.cem.id, redeemedAt: new Date(now - 100 * DAY) } });
    const tag = await db.tag.create({ data: { tenantId: A.tenant.id, name: "VIP", nameKey: "vip" } });
    for (const k of ["ali", "berk", "deniz"]) await db.customerTag.create({ data: { tenantId: A.tenant.id, tagId: tag.id, customerId: c[k].id } });

    const sum = (spec: AudienceSpec) => summarizeAudience(A.crm, spec);
    const seg = (key: string) => sum({ kind: "SEGMENT", key } as AudienceSpec);

    assert.deepEqual(await seg("LAPSED_30"), { channel: "WHATSAPP", label: "30 gündür gelmeyenler", key: "LAPSED_30", total: 2, reachable: 1, sendable: 1, sendableTr: 1, exclusions: { NO_CONSENT: 1 } });
    assert.equal((await seg("LAPSED_60")).total, 1, "yalnızca 100 gün önce gelen Cem");
    assert.equal((await seg("LAPSED_90")).reachable, 0);
    const fresh = await seg("NEW_NOT_VISITED");
    assert.deepEqual([fresh.total, fresh.reachable, fresh.exclusions.NO_PHONE], [3, 2, 1], "Deniz, Ece, Filiz");
    assert.equal((await seg("BIRTHDAY_THIS_MONTH")).total, 1);
    assert.equal((await seg("NO_SHOW_RECENT")).total, 1, "Filiz kaydolup gelmedi");
    assert.equal((await seg("WHATSAPP_CONSENTED")).total, 4, "arşivdeki Fatih hariç");
    assert.equal((await seg("NOT_MESSAGED_60")).total, 6);
    assert.equal((await sum({ kind: "TAG", tagId: tag.id })).reachable, 2);
    assert.equal((await sum({ kind: "EVENT", eventId: pastEvent.id })).total, 1);
    const selected = await sum({ kind: "SELECTED", customerIds: [c.berk.id, c.deniz.id, other.id] });
    assert.deepEqual([selected.total, selected.reachable], [2, 1], "başka işletmenin müşterisi seçilemez");
    await assert.rejects(summarizeAudience(B.crm, { kind: "TAG", tagId: tag.id }), NotFoundError);
    await assert.rejects(summarizeAudience(A.door, { kind: "SEGMENT", key: "LAPSED_30" }), ForbiddenError);

    const found = await searchAudienceCustomers(A.crm, "Cem");
    assert.deepEqual(found.map((r) => [r.name, r.reachable, r.reason]), [["Cem Kitle", false, "NO_CONSENT"]]);
    const options = await getAudienceOptions(A.crm);
    assert.equal(options.suggested.find((s) => s.key === "NOT_MESSAGED_60")?.note?.startsWith("Henüz canlı gönderim yok"), true);
    assert.deepEqual(options.tags, [{ id: tag.id, name: "VIP", customerCount: 3 }]);
  });

  test("İYS bağlı değilken canlı gönderim kapalı; onaylı şablon test numaralarına gönderilir", async () => {
    const audience = { kind: "SEGMENT", key: "WHATSAPP_CONSENTED" };
    const preview = await previewCampaign(A.crm, { audience });
    assert.equal(preview.sendable, 4);
    assert.equal(preview.estimatedCostMicroUsd, 4 * 10900);
    assert.equal(preview.liveBlock?.code, "IYS_NOT_CONFIGURED");
    await assert.rejects(startLiveCampaign(A.crm, { templateId, audience }), conflict("IYS_NOT_CONFIGURED"));
    await assert.rejects(startTestCampaign(A.crm, { templateId }), conflict("NO_TEST_RECIPIENTS"));

    await assert.rejects(addTestRecipient(A.crm, { label: "Mekan telefonu", phone: "0532 999 00 01" }), ValidationError, "onay kutusu zorunlu");
    await assert.rejects(addTestRecipient(A.crm, { label: "Mekan", phone: "12", confirmed: "on" }), ValidationError);
    await addTestRecipient(A.crm, { label: "Selin Müdür", phone: "0532 999 00 01", confirmed: "on" });
    await addTestRecipient(A.owner, { label: "Kasa", phone: "0532 999 00 02", confirmed: "on" });
    for (let i = 3; i <= 5; i++) await addTestRecipient(A.owner, { label: `Ekip ${i}`, phone: `0532 999 00 0${i}`, confirmed: "on" });
    await assert.rejects(addTestRecipient(A.owner, { label: "Fazla", phone: "0532 999 00 09", confirmed: "on" }), conflict("TEST_LIMIT"));

    const pending = await db.messageTemplate.create({
      data: { tenantId: A.tenant.id, accountId: (await db.whatsAppAccount.findUniqueOrThrow({ where: { tenantId: A.tenant.id } })).id, wabaId: "100200300", name: "beklemede", bodyText: "Merhaba", footerText: "DUR yazın", optOutLabel: "Çık" },
    });
    await assert.rejects(startTestCampaign(A.crm, { templateId: pending.id }), conflict("TEMPLATE_NOT_APPROVED"));
    await assert.rejects(startTestCampaign(B.owner, { templateId }), NotFoundError);

    failingPhones.add("+905329990002");
    const campaign = await startTestCampaign(A.crm, { templateId });
    assert.equal(campaign.mode, "TEST");
    const sendsBefore = sends().length;
    await processCampaign(campaign.id);
    const requests = sends().slice(sendsBefore);
    assert.equal(requests.length, 5);
    const first = requests.find((r) => r.body?.to === "+905329990001")!;
    assert.equal(first.path, "5550001111/messages");
    assert.deepEqual(first.body?.template, {
      name: "cuma_daveti",
      language: { code: "tr" },
      components: [
        { type: "body", parameters: [{ type: "text", parameter_name: "ad", text: "Selin" }] },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: OPT_OUT_PAYLOAD }] },
      ],
    });
    const detail = await getCampaignDetail(A.crm, campaign.id);
    assert.equal(detail.status, "COMPLETED");
    assert.equal(detail.counts.ACCEPTED, 4);
    assert.equal(detail.counts.FAILED, 1);
    assert.match(detail.messages.find((m) => m.status === "FAILED")?.errorMessage ?? "", /allowed list/);
    failingPhones.clear();
  });

  test("İYS bağlıyken canlı gönderim: gönderim anında izin ve İYS yeniden kontrol edilir, mesaj bir kez gider", async () => {
    setIysGatewayForTesting({
      configured: true,
      name: "Test entegratör",
      checkMessageConsents: async (_tenantId, phones) => new Map(phones.map((p) => [p, p === c.berk.phone ? "RET" : "ONAY"] as const)),
    });
    const audience = { kind: "SEGMENT", key: "WHATSAPP_CONSENTED" };
    assert.equal((await previewCampaign(A.crm, { audience })).liveBlock, null);
    const campaign = await startLiveCampaign(A.crm, { templateId, audience, name: "Cuma daveti" });
    assert.equal(campaign.recipientCount, 4);
    assert.equal(await db.activityLog.count({ where: { tenantId: A.tenant.id, action: "campaign.sent", entityId: campaign.id } }), 1);

    await setConsent(A.owner, { customerId: c.ece.id, channel: "WHATSAPP", grant: false });
    const sendsBefore = sends().length;
    await Promise.all([processCampaign(campaign.id), processCampaign(campaign.id)]);
    await processCampaign(campaign.id);
    const requests = sends().slice(sendsBefore);
    assert.deepEqual(requests.map((r) => r.body?.to).sort(), [c.ali.phone, c.filiz.phone].sort(), "her mesaj yalnızca bir kez gönderilir");
    assert.equal(requests.find((r) => r.body?.to === c.ali.phone)?.body?.template.components[0].parameters[0].text, "Ali");

    const detail = await getCampaignDetail(A.crm, campaign.id);
    assert.deepEqual([detail.counts.ACCEPTED, detail.counts.SKIPPED], [2, 2]);
    assert.deepEqual(detail.messages.filter((m) => m.status === "SKIPPED").map((m) => m.skipReason).sort(), ["IYS_NOT_APPROVED", "NO_CONSENT"]);
    assert.equal((await listCampaigns(A.crm))[0].counts.ACCEPTED, 2);
    await assert.rejects(getCampaignDetail(B.owner, campaign.id), NotFoundError);
    assert.equal((await summarizeAudience(A.crm, { kind: "SEGMENT", key: "NOT_MESSAGED_60" })).total, 4, "mesaj iletilen Ali ve Filiz çıktı");
  });

  test("webhook: imza, sırasız durumlar, ücret bilgisi, ret yanıtı ve işletme izolasyonu", async () => {
    assert.equal(isStatusAdvance("READ", "DELIVERED"), false);
    assert.equal(isOptOutText("  Dur! "), true);
    assert.equal(isOptOutText("Durum ne?"), false);

    const aliMsg = await db.campaignMessage.findFirstOrThrow({ where: { customerId: c.ali.id, status: "ACCEPTED" } });
    const filizMsg = await db.campaignMessage.findFirstOrThrow({ where: { customerId: c.filiz.id, status: "ACCEPTED" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = (phoneNumberId: string, value: Record<string, unknown>) => ({
      object: "whatsapp_business_account",
      entry: [{ id: "100200300", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
    });
    const status = (id: string, s: string, extra: Record<string, unknown> = {}) => ({ id, status: s, timestamp: ts, recipient_id: "905321000001", ...extra });

    // İmza
    const body = JSON.stringify(payload("5550001111", { statuses: [status(aliMsg.wamid!, "delivered", { pricing: { billable: true, pricing_model: "PMP", category: "marketing" } })] }));
    assert.equal(verifyWhatsAppSignature(body, sign(body), APP_SECRET), true);
    assert.equal(verifyWhatsAppSignature(body, sign(body + " "), APP_SECRET), false);
    const post = (raw: string, signature: string | null) =>
      webhookPost(new NextRequest("http://test.local/api/webhooks/whatsapp", { method: "POST", body: raw, headers: signature ? { "x-hub-signature-256": signature } : {} }));
    assert.equal((await post(body, null)).status, 401);
    assert.equal((await post(body, "sha256=00")).status, 401);
    assert.equal((await post(body, sign(body))).status, 200);

    let ali = await db.campaignMessage.findUniqueOrThrow({ where: { id: aliMsg.id } });
    assert.deepEqual([ali.status, ali.billable, ali.pricingCategory], ["DELIVERED", true, "marketing"]);
    await handleWhatsAppWebhook(payload("5550001111", { statuses: [status(aliMsg.wamid!, "sent")] }));
    assert.equal((await db.campaignMessage.findUniqueOrThrow({ where: { id: aliMsg.id } })).status, "DELIVERED", "geç gelen 'sent' geri almaz");
    await handleWhatsAppWebhook(payload("5550001111", { statuses: [status(aliMsg.wamid!, "read")] }));
    ali = await db.campaignMessage.findUniqueOrThrow({ where: { id: aliMsg.id } });
    assert.equal(ali.status, "READ");

    // Başka işletmenin numarasından gelen bildirim A'nın mesajını değiştiremez
    const foreign = await handleWhatsAppWebhook(payload("5550002222", { statuses: [status(filizMsg.wamid!, "failed", { errors: [{ code: 131050, title: "x" }] })] }));
    assert.equal(foreign.statuses, 0);
    assert.equal((await db.campaignMessage.findUniqueOrThrow({ where: { id: filizMsg.id } })).status, "ACCEPTED");
    await handleWhatsAppWebhook(payload("5550001111", { statuses: [status(filizMsg.wamid!, "failed", { errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Alıcı WhatsApp kullanmıyor" } }] })] }));
    const filiz = await db.campaignMessage.findUniqueOrThrow({ where: { id: filizMsg.id } });
    assert.deepEqual([filiz.status, filiz.errorCode, filiz.errorMessage], ["FAILED", "131026", "Alıcı WhatsApp kullanmıyor"]);

    // Ret yanıtları
    const inbound = (from: string, message: Record<string, unknown>) => ({ from, id: `wamid.in.${from}`, timestamp: ts, ...message });
    const aliDigits = c.ali.phone!.slice(1);
    // Aynı telefon B işletmesinde de kayıtlı: B'nin numarasına gelen ret yalnızca B'deki kaydı etkiler
    assert.equal((await handleWhatsAppWebhook(payload("5550002222", { messages: [inbound(aliDigits, { type: "button", button: { payload: OPT_OUT_PAYLOAD, text: "Abonelikten çık" } })] }))).optOuts, 1);
    assert.equal((await db.contactConsent.findUniqueOrThrow({ where: { customerId_channel: { customerId: c.ali.id, channel: "WHATSAPP" } } })).status, "GRANTED");
    assert.equal((await db.contactConsent.findFirstOrThrow({ where: { tenantId: B.tenant.id, channel: "WHATSAPP" } })).status, "REVOKED");

    const optOut = payload("5550001111", { messages: [inbound(aliDigits, { type: "button", button: { payload: OPT_OUT_PAYLOAD, text: "Abonelikten çık" } })] });
    assert.equal((await handleWhatsAppWebhook(optOut)).optOuts, 1);
    assert.equal((await handleWhatsAppWebhook(optOut)).optOuts, 0, "tekrar eden bildirim ikinci kayıt oluşturmaz");
    const aliConsent = await db.contactConsent.findUniqueOrThrow({ where: { customerId_channel: { customerId: c.ali.id, channel: "WHATSAPP" } } });
    assert.equal(aliConsent.status, "REVOKED");
    const log = await db.activityLog.findMany({ where: { tenantId: A.tenant.id, action: "consent.revoked", customerId: c.ali.id } });
    assert.equal(log.length, 1);
    assert.equal(log[0].actorUserId, null);
    assert.match(log[0].metadata ?? "", /WHATSAPP_REPLY/);

    const berkDigits = c.berk.phone!.slice(1);
    await handleWhatsAppWebhook(payload("5550001111", { messages: [inbound(berkDigits, { type: "text", text: { body: "Durum ne, cuma açık mısınız?" } })] }));
    assert.equal((await db.contactConsent.findUniqueOrThrow({ where: { customerId_channel: { customerId: c.berk.id, channel: "WHATSAPP" } } })).status, "GRANTED");
    await handleWhatsAppWebhook(payload("5550001111", { messages: [inbound(berkDigits, { type: "text", text: { body: "DUR" } })] }));
    assert.equal((await db.contactConsent.findUniqueOrThrow({ where: { customerId_channel: { customerId: c.berk.id, channel: "WHATSAPP" } } })).status, "REVOKED");
    // Kanal izni olmayan Cem için ret satırı oluşturulur (sonradan yanlışlıkla izin sayılmaz)
    await handleWhatsAppWebhook(payload("5550001111", { messages: [inbound(c.cem.phone!.slice(1), { type: "text", text: { body: "stop" } })] }));
    assert.equal((await db.contactConsent.findUniqueOrThrow({ where: { customerId_channel: { customerId: c.cem.id, channel: "WHATSAPP" } } })).source, "OPT_OUT_REPLY");

    // Meta abonelik doğrulaması
    const verify = (token: string) => webhookGet(new NextRequest(`http://test.local/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`));
    assert.equal(await (await verify("dogrulama-123")).text(), "42");
    assert.equal((await verify("yanlis")).status, 403);

    const overview = await getChannelOverview(A.crm);
    assert.equal(overview.usage.accepted, 6, "4 test + 2 canlı");
    assert.equal(overview.usage.billable, 1);
    assert.equal(overview.iys.configured, true);
  });

  test("bağlantı kesilince token silinir, sıradaki mesajlar gönderilmez", async () => {
    setIysGatewayForTesting(null);
    const queued = await startTestCampaign(A.crm, { templateId });
    await assert.rejects(disconnectWhatsApp(A.crm), ForbiddenError);
    await disconnectWhatsApp(A.owner);
    const row = await db.whatsAppAccount.findUniqueOrThrow({ where: { tenantId: A.tenant.id } });
    assert.deepEqual([row.status, row.accessTokenEnc], ["DISCONNECTED", null]);

    const sendsBefore = sends().length;
    await processCampaign(queued.id);
    assert.equal(sends().length, sendsBefore);
    const detail = await getCampaignDetail(A.crm, queued.id);
    assert.equal(detail.counts.FAILED, 5);
    await assert.rejects(startTestCampaign(A.crm, { templateId }), conflict("NO_ACCOUNT"));
    assert.equal((await getChannelOverview(A.crm)).account?.tokenUsable, false);
  });
});
