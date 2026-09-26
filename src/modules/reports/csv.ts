import "server-only";
import { localDayKey } from "@/lib/datetime";
import { CHANNELS, CHANNEL_LABELS } from "@/lib/domain";
import { CAMPAIGN_CHANNEL_LABELS } from "@/modules/campaigns/rules";
import type { ReportData } from "./service";

/**
 * Rapor verisinin CSV çıktısı.
 *
 * Türkçe Excel'de sorunsuz açılsın diye: ayraç noktalı virgül, dosya başında UTF-8 BOM
 * (çağıran ekler) ve ondalık yok — oranlar tam sayı yüzde olarak yazılır.
 * Yalnızca ölçülen veriler yazılır; boş alan boş kalır, tahmin üretilmez.
 */

export const REPORT_SETS = ["ozet", "gunluk", "etkinlikler", "pr", "saatler", "gunler", "kaynaklar", "avantajlar", "kampanyalar"] as const;
export type ReportSet = (typeof REPORT_SETS)[number];

export const REPORT_SET_LABELS: Record<ReportSet, string> = {
  ozet: "Özet",
  gunluk: "Günlük seriler",
  etkinlikler: "Etkinlikler",
  pr: "PR katkısı",
  saatler: "Saate göre giriş",
  gunler: "Güne göre giriş",
  kaynaklar: "Yeni müşteri kaynağı",
  avantajlar: "Avantaj kullanımı",
  kampanyalar: "Kampanya sonuçları",
};

export function parseReportSet(value: unknown): ReportSet {
  return typeof value === "string" && (REPORT_SETS as readonly string[]).includes(value) ? (value as ReportSet) : "ozet";
}

const SEPARATOR = ";";

/** Ayraç, tırnak veya satır sonu içeren hücre tırnaklanır; içerideki tırnak ikilenir. */
function cell(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(cell).join(SEPARATOR)).join("\r\n");
}

const percent = (ratio: number) => Math.round(ratio * 100);

function sets(data: ReportData): Record<ReportSet, (string | number)[][]> {
  const t = data.totals;
  return {
    ozet: [
      ["Ölçüm", "Bu dönem", "Önceki dönem"],
      ["Kapıdan giren kişi", t.admitted.current, t.admitted.previous],
      ["Farklı kişi", t.uniqueVisitors, ""],
      ["Tekrar ziyaret", t.returningVisits, ""],
      ["Yeni müşteri", t.newCustomers.current, t.newCustomers.previous],
      ["Etkinlik kaydı", t.registrations.current, t.registrations.previous],
      ["Davetli kişi", t.invitedPeople, ""],
      ["Davetliden giren kişi", t.registrationsAdmitted, ""],
      ["Geliş oranı (%)", percent(t.showRate), ""],
      ["Avantaj kullanımı", t.redemptions.current, t.redemptions.previous],
      ["Kaldırılan iletişim izni", t.revokedConsents, ""],
      ...CHANNELS.map((c) => [`İletişim izni — ${CHANNEL_LABELS[c]}`, data.consents[c], ""] as (string | number)[]),
    ],
    gunluk: [
      ["Gün", "Kapıdan giren kişi", "Yeni müşteri", "Etkinlik kaydı (kişi)"],
      ...data.series.visits.map((point, i) => [
        point.day,
        point.value,
        data.series.customers[i]?.value ?? 0,
        data.series.registrations[i]?.value ?? 0,
      ]),
    ],
    etkinlikler: [
      ["Etkinlik", "Mekan", "Başlangıç", "Davetli kişi", "Giren kişi", "Geliş oranı (%)", "Kapasite"],
      ...data.events.map((e) => [e.name, e.venueName, localDayKey(e.startsAt), e.people, e.admitted, percent(e.rate), e.capacity ?? ""]),
    ],
    pr: [
      ["PR", "Getirdiği kişi", "Giren kişi", "Geliş oranı (%)"],
      ...data.promoters.map((p) => [p.name, p.people, p.admitted, p.people > 0 ? percent(p.admitted / p.people) : 0]),
    ],
    saatler: [["Saat", "Giren kişi"], ...data.hourly.map((h) => [`${h.label}:00`, h.value])],
    gunler: [["Gün", "Giren kişi"], ...data.weekly.map((d) => [d.label, d.value])],
    kaynaklar: [["Kaynak", "Yeni müşteri"], ...data.sources.map((s) => [s.label, s.value])],
    avantajlar: [["Avantaj", "Kullanım"], ...data.perks.map((p) => [p.label, p.value])],
    kampanyalar: [
      ["Kanal", "İletildi", "Teslim edildi", "Okundu / açıldı", "Sorunlu"],
      ...data.campaigns.map((c) => [
        CAMPAIGN_CHANNEL_LABELS[c.channel],
        c.accepted,
        c.delivered,
        c.channel === "EMAIL" ? c.opened : c.read,
        c.problems,
      ]),
    ],
  };
}

export function reportCsv(set: ReportSet, data: ReportData): { filename: string; body: string } {
  const rows = sets(data)[set];
  return {
    filename: `circular-${set}-${data.range.fromDay}_${data.range.toDay}.csv`,
    body: toCsv(rows),
  };
}
