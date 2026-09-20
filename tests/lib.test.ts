import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { foldText, formatPhone, normalizeEmail, normalizePhone, phoneSearchDigits } from "@/lib/normalize";
import { formatDateTime, parseLocalDateTime, toLocalInputValue } from "@/lib/datetime";
import { attendanceState } from "@/modules/events/attendance";
import { safeNextPath } from "@/lib/routes";
import { can } from "@/lib/authz";

describe("normalizasyon", () => {
  test("TR telefon biçimleri aynı E.164 değerine iner", () => {
    for (const v of ["0532 123 45 67", "5321234567", "+90 (532) 123-45-67", "00905321234567"]) {
      assert.deepEqual(normalizePhone(v), { ok: true, e164: "+905321234567" }, v);
    }
    assert.deepEqual(normalizePhone("12"), { ok: false });
    assert.equal(normalizePhone("  "), null);
    assert.equal(formatPhone("+905321234567"), "0532 123 45 67");
  });

  test("Türkçe katlama büyük/küçük İ-ı sorununu çözer", () => {
    assert.equal(foldText("  ŞULE   YILDIZ "), "sule yildiz");
    assert.equal(foldText("İpek Işık"), "ipek isik");
    assert.equal(foldText("Çağrı Öğüt"), "cagri ogut");
  });

  test("e-posta ve telefon araması", () => {
    assert.equal(normalizeEmail(" Ayse@Example.COM "), "ayse@example.com");
    assert.equal(phoneSearchDigits("0532 12"), "53212");
    assert.equal(phoneSearchDigits("ab"), null);
  });
});

describe("tarih/saat (Europe/Istanbul)", () => {
  test("form girdisi Istanbul saati olarak UTC'ye çevrilir", () => {
    const d = parseLocalDateTime("2026-09-20T22:00");
    assert.equal(d?.toISOString(), "2026-09-20T19:00:00.000Z");
    assert.equal(toLocalInputValue(d), "2026-09-20T22:00");
    assert.equal(formatDateTime(d!).includes("22:00"), true);
  });
  test("geçersiz tarihler reddedilir", () => {
    assert.equal(parseLocalDateTime("2026-02-31T10:00"), null);
    assert.equal(parseLocalDateTime("yarın"), null);
  });
});

describe("katılım durumu", () => {
  const past = { endsAt: new Date(Date.now() - 3600_000), entryClosesAt: null };
  const future = { endsAt: new Date(Date.now() + 3600_000), entryClosesAt: null };
  test("check-in ölçülmüyorken geçmiş etkinlikte no-show uydurulmaz", () => {
    assert.equal(attendanceState({ accessStatus: "ACTIVE" }, past, new Date(), false), "NOT_TRACKED");
  });
  test("no-show yalnızca giriş süresi bittikten sonra", () => {
    assert.equal(attendanceState({ accessStatus: "ACTIVE" }, future, new Date(), true), "EXPECTED");
    assert.equal(attendanceState({ accessStatus: "ACTIVE" }, past, new Date(), true), "NO_SHOW");
    assert.equal(attendanceState({ accessStatus: "ACTIVE", checkInCount: 1 }, past, new Date(), true), "CHECKED_IN");
    assert.equal(attendanceState({ accessStatus: "CANCELLED" }, past, new Date(), true), "CANCELLED");
  });
});

describe("güvenlik yardımcıları", () => {
  test("açık yönlendirme engellenir", () => {
    assert.equal(safeNextPath("/customers"), "/customers");
    assert.equal(safeNextPath("//evil.example"), null);
    assert.equal(safeNextPath("https://evil.example"), null);
    assert.equal(safeNextPath("/\\evil"), null);
  });
  test("rol haritası", () => {
    assert.equal(can("OWNER_ADMIN", "customers.archive"), true);
    assert.equal(can("CRM_MANAGER", "customers.archive"), false);
    assert.equal(can("DOOR", "customers.view"), false);
    assert.equal(can("WAITER", "events.view"), false);
  });
});
