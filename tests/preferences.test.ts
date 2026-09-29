import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { createCustomer } from "@/modules/customers/service";
import {
  preferenceToken,
  preferenceUrl,
  readPreferences,
  resetPreferenceRateLimit,
  savePreferences,
} from "@/modules/preferences/service";
import { makeTenant, resetDb } from "./helpers";

/**
 * Tercih merkezi: kişinin kendi iletişim izinlerini yönettiği herkese açık sayfa.
 * Bağlantı imzalıdır ve sayfada kişisel veri olarak yalnızca maskeli ad bulunur.
 */

type T = Awaited<ReturnType<typeof makeTenant>>;
let A: T;
let customerId: string;
let phoneOnlyId: string;

before(async () => {
  await resetDb();
  A = await makeTenant("ta");
  const customer = await createCustomer(A.owner, {
    firstName: "Elif",
    lastName: "Şahin",
    phone: "0532 800 00 01",
    email: "elif@ornek.test",
    consentChannels: ["EMAIL", "SMS"],
    consentNote: "Kasada kağıt form",
  });
  customerId = customer.id;
  const phoneOnly = await createCustomer(A.owner, { firstName: "Mert", lastName: "Ak", phone: "0532 800 00 02" });
  phoneOnlyId = phoneOnly.id;
});

beforeEach(async () => {
  await resetPreferenceRateLimit();
});

after(async () => {
  await db.$disconnect();
});

describe("Bağlantı", () => {
  test("imzasız veya bozuk bağlantı çalışmaz", async () => {
    assert.equal(await readPreferences("uydurma"), null);
    assert.equal(await readPreferences(`${customerId}.gecersizimza`), null);
    assert.equal(await readPreferences(`${customerId}`), null);
  });

  test("başka kişinin kimliği kendi imzasıyla kullanılamaz", async () => {
    const [, signature] = preferenceToken(customerId).split(".");
    assert.equal(await readPreferences(`${phoneOnlyId}.${signature}`), null);
  });

  test("adres tercih sayfasına çıkar", () => {
    assert.ok(preferenceUrl(customerId).includes(`/tercih/${preferenceToken(customerId)}`));
  });
});

describe("Görüntüleme", () => {
  test("yalnızca maskeli ad ve kanal durumları gösterilir", async () => {
    const view = await readPreferences(preferenceToken(customerId));
    assert.ok(view);
    assert.equal(view.tenantName, "Tenant ta");
    assert.ok(!view.holder.includes("Şahin"), "tam soyadı gösterilmez");
    const dump = JSON.stringify(view);
    assert.ok(!dump.includes("elif@ornek.test"), "e-posta gösterilmez");
    assert.ok(!dump.includes("532"), "telefon gösterilmez");

    const byChannel = new Map(view.channels.map((c) => [c.channel, c]));
    assert.equal(byChannel.get("EMAIL")?.granted, true);
    assert.equal(byChannel.get("SMS")?.granted, true);
    assert.equal(byChannel.get("WHATSAPP")?.granted, false);
  });

  test("iletişim bilgisi olmayan kanal açılabilir görünmez", async () => {
    const view = await readPreferences(preferenceToken(phoneOnlyId));
    const email = view?.channels.find((c) => c.channel === "EMAIL");
    assert.equal(email?.available, false, "e-posta adresi yoksa kanal kapalıdır");
    assert.equal(view?.channels.find((c) => c.channel === "SMS")?.available, true);
  });
});

describe("Kaydetme", () => {
  test("seçilmeyen kanalın izni kaldırılır, seçilen açılır", async () => {
    const token = preferenceToken(customerId);
    const view = await savePreferences(token, ["WHATSAPP"]);
    assert.ok(view);
    const byChannel = new Map(view.channels.map((c) => [c.channel, c]));
    assert.equal(byChannel.get("WHATSAPP")?.granted, true, "yeni kanal açılır");
    assert.equal(byChannel.get("EMAIL")?.granted, false, "işaretlenmeyen kanal kapanır");
    assert.equal(byChannel.get("SMS")?.granted, false);

    const consents = await db.contactConsent.findMany({ where: { customerId } });
    const email = consents.find((c) => c.channel === "EMAIL");
    assert.equal(email?.status, "REVOKED");
    assert.equal(email?.source, "PREFERENCE_CENTER");
    assert.equal(email?.consentTextVersion, "preference-center-v1", "gösterilen metnin sürümü saklanır");
    assert.equal(consents.find((c) => c.channel === "WHATSAPP")?.recordedByUserId, null, "kişinin kendi işlemidir");

    const log = await db.activityLog.findFirst({ where: { customerId, action: "consent.revoked" }, orderBy: { createdAt: "desc" } });
    assert.ok(log, "izin değişikliği aktivite geçmişine yazılır");
    assert.ok(log!.metadata?.includes("PREFERENCE_CENTER"));
  });

  test("hepsi kapatılabilir", async () => {
    const token = preferenceToken(customerId);
    const view = await savePreferences(token, []);
    assert.ok(view?.channels.every((c) => !c.granted), "tüm kanallar kapanır");
  });

  test("iletişim bilgisi olmayan kanal açılamaz", async () => {
    const view = await savePreferences(preferenceToken(phoneOnlyId), ["EMAIL", "SMS"]);
    const byChannel = new Map(view!.channels.map((c) => [c.channel, c]));
    assert.equal(byChannel.get("EMAIL")?.granted, false, "adresi olmayan kanal açılmaz");
    assert.equal(byChannel.get("SMS")?.granted, true);
  });

  test("bilinmeyen kanal adı yok sayılır", async () => {
    const view = await savePreferences(preferenceToken(phoneOnlyId), ["SMS", "GUVERCIN"]);
    assert.equal(view?.channels.length, 3);
    assert.equal(view?.channels.find((c) => c.channel === "SMS")?.granted, true);
  });

  test("çok sayıda deneme sınırlanır", async () => {
    const token = preferenceToken(customerId);
    for (let i = 0; i < 30; i += 1) await savePreferences(token, []);
    await assert.rejects(savePreferences(token, []), ConflictError);
  });

  test("geçersiz bağlantıyla kayıt yapılmaz", async () => {
    assert.equal(await savePreferences(`${customerId}.bozuk`, ["EMAIL"]), null);
  });
});
