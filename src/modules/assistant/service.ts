import "server-only";
import { db } from "@/lib/db";
import { assertCan, can, venueScope, type ServiceContext } from "@/lib/authz";
import { formatRelative, formatShortDate } from "@/lib/datetime";
import { createRateLimiter } from "@/lib/rate-limit";
import { formatPhone, fullName } from "@/lib/normalize";
import { CHANNELS, CHANNEL_LABELS, labelOf } from "@/lib/domain";
import { getChannelOverview } from "@/modules/campaigns/accounts";
import { getAudienceOptions, type SegmentOption } from "@/modules/campaigns/audience";
import { getEmailOverview } from "@/modules/campaigns/email-service";
import { getInstagramOverview } from "@/modules/campaigns/instagram-service";
import { CAMPAIGN_CHANNELS, CAMPAIGN_CHANNEL_LABELS, SEGMENT_COPY, type CampaignChannel, type SegmentKey } from "@/modules/campaigns/rules";
import { getSmsAccount } from "@/modules/campaigns/sms-service";
import { foldText } from "@/lib/normalize";
import { customerSearchWhere } from "@/modules/customers/service";
import { getPrOverview } from "@/modules/pr/service";
import { getReports, type Delta, type ReportData } from "@/modules/reports/service";
import { chatReply, classifyQuestion, modelReady, phraseLead, type HistoryTurn } from "./model-api";
import {
  fmt,
  GUIDES,
  locativeOf,
  pct,
  readQuestion,
  STARTER_QUESTIONS,
  type AnswerBlock,
  type AssistantAnswer,
  MAX_HISTORY_TURNS,
  PERSONAL_TOPICS,
  type AssistantTopic,
  type ChatTurn,
  type QuestionMatch,
} from "./rules";

/**
 * Asistan servisi — cevapların tamamı veritabanındaki gerçek kayıtlardan üretilir.
 *
 * Dil modeli bağlı olmadığı için metinler şablondur; sayılar rapor ve kampanya
 * servislerinden gelir. Servis hiçbir kaydı değiştirmez, hiçbir mesaj göndermez:
 * yalnızca okur ve taslak metin önerir. Yetki ve mekan kapsamı çağrılan servislerde uygulanır.
 */

export type AskInput = { question: string; venueId?: string | null; venueLabel?: string | null; history?: ChatTurn[] };

const MAX_QUESTION_LENGTH = 400;

function scopeLine(periodDays: number, venueLabel?: string | null) {
  return `Son ${periodDays} gün · ${venueLabel?.trim() || "Tüm mekanlar"}`;
}

/** Önceki dönemle karşılaştırma. Önceki dönem çok küçükken yüzde yanıltıcı olur; o durumda sayı yazılır. */
function deltaNote(d: Delta): string {
  if (d.previous >= 5) {
    const change = Math.round(((d.current - d.previous) / d.previous) * 100);
    return `önceki dönem ${fmt(d.previous)} · ${change > 0 ? "+" : ""}${change}%`;
  }
  return `önceki dönem ${fmt(d.previous)}`;
}

const note = (text: string, tone: "info" | "caution" = "info"): AnswerBlock => ({ kind: "note", tone, text });
const links = (items: { href: string; label: string }[]): AnswerBlock => ({ kind: "links", links: items });

/** Veri yoksa dürüst cevap: sayı uydurulmaz. */
function emptyAnswer(match: QuestionMatch, title: string, venueLabel: string | null | undefined, followUps: string[]): AssistantAnswer {
  return {
    topic: match.topic,
    title,
    lead: "Bu dönemde bu soruyu cevaplayacak kayıt yok.",
    scope: scopeLine(match.periodDays, venueLabel),
    blocks: [note("Kayıt biriktikçe bu soruya gerçek sayılarla cevap verebilirim. Daha uzun bir dönem sorabilirsiniz: “son 90 günde ne oldu?”")],
    followUps,
  };
}

// ─────────────────────────────────────────────── Konu cevapları

function summaryAnswer(match: QuestionMatch, r: ReportData, venueLabel?: string | null): AssistantAnswer {
  const t = r.totals;
  if (t.admitted.current === 0 && t.newCustomers.current === 0 && t.registrations.current === 0) {
    return emptyAnswer(match, "Genel durum", venueLabel, ["Son 90 günde ne oldu?", "Kaç kişiye mesaj atabilirim?"]);
  }
  const best = [...r.series.visits].sort((a, b) => b.value - a.value)[0];
  return {
    topic: match.topic,
    title: "Genel durum",
    lead: `Son ${match.periodDays} günde kapıdan ${fmt(t.admitted.current)} kişi girdi ve ${fmt(t.newCustomers.current)} yeni müşteri eklendi.`,
    scope: scopeLine(match.periodDays, venueLabel),
    blocks: [
      {
        kind: "stats",
        items: [
          { label: "Kapıdan giren kişi", value: fmt(t.admitted.current), sub: deltaNote(t.admitted) },
          { label: "Yeni müşteri", value: fmt(t.newCustomers.current), sub: deltaNote(t.newCustomers) },
          { label: "Etkinlik kaydı", value: fmt(t.registrations.current), sub: `${fmt(t.invitedPeople)} kişilik davet` },
          { label: "Avantaj kullanımı", value: fmt(t.redemptions.current), sub: deltaNote(t.redemptions) },
        ],
      },
      ...(t.invitedPeople > 0
        ? [note(`Davetli ${fmt(t.invitedPeople)} kişinin ${fmt(t.registrationsAdmitted)}'i kapıdan girdi (${pct(t.showRate)} geliş oranı).`)]
        : []),
      ...(best && best.value > 0 ? [note(`En yoğun gün ${best.label}: ${fmt(best.value)} kişi.`)] : []),
      links([{ href: `/reports?period=${match.periodDays}`, label: "Raporlarda gör" }]),
    ],
    followUps: ["En yoğun gün ve saat hangisi?", "Etkinlikler nasıl gitti?", "Kimlere mesaj atmalıyım?"],
  };
}

function visitsAnswer(match: QuestionMatch, r: ReportData, venueLabel?: string | null): AssistantAnswer {
  const t = r.totals;
  if (t.admitted.current === 0) return emptyAnswer(match, "Kapıdan giriş", venueLabel, ["Son 90 günde kaç kişi geldi?", "Etkinlikler nasıl gitti?"]);
  const series = r.series.visits;
  const today = series[series.length - 1];
  const yesterday = series[series.length - 2];
  const top = [...series].sort((a, b) => b.value - a.value).slice(0, 5).filter((d) => d.value > 0);
  const average = t.admitted.current / match.periodDays;
  return {
    topic: match.topic,
    title: "Kapıdan giriş",
    lead: `Son ${match.periodDays} günde ${fmt(t.admitted.current)} kişi girdi; bunlar ${fmt(t.uniqueVisitors)} farklı kişi.`,
    scope: scopeLine(match.periodDays, venueLabel),
    blocks: [
      {
        kind: "stats",
        items: [
          { label: "Toplam giriş", value: fmt(t.admitted.current), sub: deltaNote(t.admitted) },
          { label: "Farklı kişi", value: fmt(t.uniqueVisitors), sub: t.returningVisits > 0 ? `${fmt(t.returningVisits)} tekrar ziyaret` : "tekrar ziyaret yok" },
          { label: "Günlük ortalama", value: average.toLocaleString("tr-TR", { maximumFractionDigits: 1 }), sub: "kişi / gün" },
          { label: "Bugün", value: fmt(today?.value ?? 0), sub: yesterday ? `dün ${fmt(yesterday.value)}` : undefined },
        ],
      },
      { kind: "rows", caption: "En yoğun günler", rows: top.map((d) => ({ label: d.label, value: `${fmt(d.value)} kişi`, ratio: d.value / top[0].value })), emptyText: "Giriş kaydı yok" },
      links([{ href: `/reports?period=${match.periodDays}`, label: "Günlük grafiği aç" }]),
    ],
    followUps: ["En yoğun saat hangisi?", "Etkinlikler nasıl gitti?", "Son 90 günde kaç kişi geldi?"],
  };
}

function peakTimeAnswer(match: QuestionMatch, r: ReportData, venueLabel?: string | null): AssistantAnswer {
  const hours = r.hourly.filter((h) => h.value > 0);
  const days = r.weekly.filter((d) => d.value > 0);
  if (hours.length === 0) return emptyAnswer(match, "Yoğunluk", venueLabel, ["Son 90 günde en yoğun saat?", "Kaç kişi geldi?"]);
  const topHours = [...hours].sort((a, b) => b.value - a.value).slice(0, 5);
  const topDays = [...days].sort((a, b) => b.value - a.value);
  const peakHour = topHours[0];
  const peakDay = topDays[0];
  const total = r.totals.admitted.current;
  return {
    topic: match.topic,
    title: "Yoğunluk",
    lead: `En yoğun saat ${peakHour.label}:00 (${fmt(peakHour.value)} kişi), en yoğun gün ${peakDay.label} (${fmt(peakDay.value)} kişi).`,
    scope: scopeLine(match.periodDays, venueLabel),
    blocks: [
      { kind: "rows", caption: "Saatler", rows: topHours.map((h) => ({ label: `${h.label}:00`, value: `${fmt(h.value)} kişi`, sub: total > 0 ? pct(h.value / total) : undefined, ratio: h.value / peakHour.value })) },
      { kind: "rows", caption: "Günler", rows: topDays.map((d) => ({ label: d.label, value: `${fmt(d.value)} kişi`, ratio: d.value / peakDay.value })) },
      note("Saatler kapıda okutulan QR'ın zamanına göredir ve İstanbul saatiyle gösterilir."),
      links([{ href: `/reports?period=${match.periodDays}`, label: "Saat ve gün grafiği" }]),
    ],
    followUps: ["Kaç kişi geldi?", "Etkinlikler nasıl gitti?"],
  };
}

function newCustomersAnswer(match: QuestionMatch, r: ReportData, venueLabel?: string | null): AssistantAnswer {
  const t = r.totals;
  if (t.newCustomers.current === 0) return emptyAnswer(match, "Yeni müşteri", venueLabel, ["Son 90 günde kaç yeni müşteri eklendi?", "Müşteri nasıl eklenir?"]);
  const total = r.sources.reduce((n, s) => n + s.value, 0);
  const topSource = [...r.sources].sort((a, b) => b.value - a.value)[0];
  return {
    topic: match.topic,
    title: "Yeni müşteri",
    lead: `Son ${match.periodDays} günde ${fmt(t.newCustomers.current)} yeni müşteri eklendi; en çok ${topSource.label.toLocaleLowerCase("tr-TR")} kaynağından (${fmt(topSource.value)} kişi).`,
    scope: scopeLine(match.periodDays, venueLabel),
    blocks: [
      {
        kind: "stats",
        items: [
          { label: "Yeni müşteri", value: fmt(t.newCustomers.current), sub: deltaNote(t.newCustomers) },
          { label: "Günlük ortalama", value: (t.newCustomers.current / match.periodDays).toLocaleString("tr-TR", { maximumFractionDigits: 1 }), sub: "kişi / gün" },
          ...(t.revokedConsents > 0 ? [{ label: "Kaldırılan izin", value: fmt(t.revokedConsents), sub: "aynı dönemde" }] : []),
        ],
      },
      { kind: "rows", caption: "Kaynaklar", rows: r.sources.map((s) => ({ label: s.label, value: `${fmt(s.value)} kişi`, sub: total > 0 ? pct(s.value / total) : undefined, ratio: total > 0 ? s.value / total : 0 })) },
      links([{ href: "/customers", label: "Müşteriler" }]),
    ],
    followUps: ["Kaç kişiye mesaj atabilirim?", "Kimlere mesaj atmalıyım?"],
  };
}

function eventsAnswer(match: QuestionMatch, r: ReportData, venueLabel?: string | null): AssistantAnswer {
  if (r.events.length === 0) {
    return {
      topic: match.topic,
      title: "Etkinlikler",
      lead: `Son ${match.periodDays} günde biten etkinlik yok.`,
      scope: scopeLine(match.periodDays, venueLabel),
      blocks: [note("Rapor yalnızca bitmiş etkinlikleri sayar; süren veya yaklaşan etkinlikler Etkinlikler ekranında görünür."), links([{ href: "/events", label: "Etkinlikler" }])],
      followUps: ["Son 90 günde etkinlikler nasıl gitti?", "Etkinlik nasıl oluşturulur?"],
    };
  }
  const best = [...r.events].filter((e) => e.people > 0).sort((a, b) => b.rate - a.rate)[0];
  return {
    topic: match.topic,
    title: "Etkinlikler",
    lead: `Son ${match.periodDays} günde ${fmt(r.events.length)} etkinlik bitti${best ? `; geliş oranı en yüksek olan ${best.name} (${pct(best.rate)})` : ""}.`,
    scope: scopeLine(match.periodDays, venueLabel),
    blocks: [
      {
        kind: "rows",
        rows: r.events.map((e) => ({
          label: e.name,
          value: `${fmt(e.admitted)} / ${fmt(e.people)} kişi`,
          sub: `${formatShortDate(e.startsAt)} · ${e.venueName}${e.capacity ? ` · kapasite ${fmt(e.capacity)}` : ""} · ${pct(e.rate)} geldi`,
          ratio: e.rate,
        })),
      },
      note("Soldaki sayı kapıdan giren kişi, sağdaki davetli kişi sayısıdır."),
      links([
        { href: "/events", label: "Etkinlikler" },
        { href: `/reports?period=${match.periodDays}`, label: "Raporlar" },
      ]),
    ],
    followUps: ["Hangi PR daha çok kişi getirdi?", "En yoğun gün hangisi?"],
  };
}

async function promotersAnswer(ctx: ServiceContext, match: QuestionMatch, now: Date): Promise<AssistantAnswer> {
  if (!can(ctx.role, "pr.manage")) {
    return {
      topic: match.topic,
      title: "PR katkısı",
      lead: "PR performansını görme yetkiniz yok.",
      scope: null,
      blocks: [note("Bu veriyi işletme sahibi ve CRM yöneticisi görebilir.", "caution")],
      followUps: STARTER_QUESTIONS.slice(0, 3),
    };
  }
  const overview = await getPrOverview(ctx, now);
  const active = overview.team.filter((m) => m.stats.people > 0);
  if (active.length === 0) {
    return {
      topic: match.topic,
      title: "PR katkısı",
      lead: `Son ${overview.windowDays} günde PR kaydı olan misafir yok.`,
      scope: `Son ${overview.windowDays} gün`,
      blocks: [
        note(overview.team.length === 0 ? "Henüz PR rolünde ekip üyesi yok." : "PR'lar misafir eklediğinde katkıları burada gerçek giriş sayılarıyla görünür."),
        links([{ href: "/pr", label: "PR Yönetimi" }]),
      ],
      followUps: ["PR'a davet linki nasıl verilir?", "Etkinlikler nasıl gitti?"],
    };
  }
  const top = active[0];
  return {
    topic: match.topic,
    title: "PR katkısı",
    lead: `Son ${overview.windowDays} günde PR'lar ${fmt(overview.totals.people)} kişi getirdi, ${fmt(overview.totals.admitted)} kişi kapıdan girdi. En çok giriş ${top.name} (${fmt(top.stats.admitted)} kişi).`,
    scope: `Son ${overview.windowDays} gün`,
    blocks: [
      {
        kind: "rows",
        rows: active.map((m) => ({
          label: m.name,
          value: `${fmt(m.stats.admitted)} / ${fmt(m.stats.people)} kişi`,
          sub: `${pct(m.stats.checkInRate)} geldi${m.active ? "" : " · pasif"}${m.openTasks > 0 ? ` · ${fmt(m.openTasks)} açık talimat` : ""}`,
          ratio: m.stats.checkInRate,
        })),
      },
      note("Sayılar PR'ın beyanından değil, kapıda okutulan QR kayıtlarından gelir."),
      links([{ href: "/pr", label: "PR Yönetimi" }]),
    ],
    followUps: ["Etkinlikler nasıl gitti?", "PR'a davet linki nasıl verilir?"],
  };
}

function segmentRow(option: SegmentOption) {
  const reach = CAMPAIGN_CHANNELS.map((ch) => `${CAMPAIGN_CHANNEL_LABELS[ch]} ${fmt(option.reachableBy[ch])}`).join(" · ");
  return {
    label: option.label,
    value: `${fmt(option.total)} kişi`,
    sub: `ulaşılabilir → ${reach}${option.note ? ` · ${option.note}` : ""}`,
    ratio: option.total > 0 ? Math.max(...CAMPAIGN_CHANNELS.map((ch) => option.reachableBy[ch])) / option.total : 0,
  };
}

async function audienceAnswer(ctx: ServiceContext, match: QuestionMatch, now: Date): Promise<AssistantAnswer> {
  const options = await getAudienceOptions(ctx, now);
  const ranked = [...options.suggested].sort((a, b) => b.reachable - a.reachable);
  const focus = match.segment ? options.suggested.find((s) => s.key === match.segment) : null;
  const list = focus ? [focus, ...ranked.filter((s) => s.key !== focus.key)] : ranked;
  const withPeople = list.filter((s) => s.total > 0);

  if (withPeople.length === 0) {
    return {
      topic: match.topic,
      title: "Kitle önerisi",
      lead: "Şu an önerilen kitlelerin hiçbirinde kişi yok.",
      scope: null,
      blocks: [note("Bu kitleler gerçek kayıtlardan hesaplanır: kapı girişi, etkinlik kaydı, avantaj kullanımı ve gönderim geçmişi. Kayıt biriktikçe dolar."), links([{ href: "/customers", label: "Müşteriler" }])],
      followUps: ["Müşteri nasıl eklenir?", "Kaç kişiye mesaj atabilirim?"],
    };
  }
  const first = withPeople[0];
  return {
    topic: match.topic,
    title: "Kitle önerisi",
    lead: `${first.label}: ${fmt(first.total)} kişi, ${fmt(first.reachable)}'ine WhatsApp izniyle ulaşılabiliyor.`,
    scope: "Bugünkü kayıtlara göre",
    blocks: [
      { kind: "rows", caption: "Önerilen kitleler", rows: withPeople.map(segmentRow) },
      note("Kitleyi seçtikten sonra önizlemede kaç kişiye gideceğini ve kimlerin elendiğini görürsünüz. Gönderimi her zaman siz onaylarsınız."),
      links([
        { href: "/campaigns/new", label: "Kitleyi seçip kampanya hazırla" },
        { href: "/customers", label: "Müşteriler" },
      ]),
    ],
    followUps: [`${first.label} için mesaj taslağı hazırla`, "Kaç kişiye mesaj atabilirim?", "Kampanya nasıl gönderilir?"],
  };
}

function consentsAnswer(match: QuestionMatch, r: ReportData): AssistantAnswer {
  const total = CHANNELS.reduce((n, c) => n + r.consents[c], 0);
  if (total === 0) {
    return {
      topic: match.topic,
      title: "İletişim izinleri",
      lead: "Kayıtlı iletişim izni yok, bu yüzden şu an kimseye kampanya gönderilemez.",
      scope: "Arşivlenmemiş müşteriler",
      blocks: [
        note("İzin olmadan ticari mesaj gönderilmez. İzni müşteri kartından, kayıt formundan veya QR menüden alabilirsiniz.", "caution"),
        links([{ href: "/customers", label: "Müşteriler" }]),
      ],
      followUps: ["İletişim izni nasıl kaydedilir?", "Müşteri nasıl eklenir?"],
    };
  }
  const best = CHANNELS.map((c) => ({ c, n: r.consents[c] })).sort((a, b) => b.n - a.n)[0];
  return {
    topic: match.topic,
    title: "İletişim izinleri",
    lead: `En çok izin ${CHANNEL_LABELS[best.c]} kanalında: ${fmt(best.n)} kişi.`,
    scope: "Arşivlenmemiş müşteriler",
    blocks: [
      { kind: "stats", items: CHANNELS.map((c) => ({ label: CHANNEL_LABELS[c], value: fmt(r.consents[c]), sub: "izinli kişi" })) },
      ...(r.totals.revokedConsents > 0 ? [note(`Son ${match.periodDays} günde ${fmt(r.totals.revokedConsents)} izin kaldırıldı.`)] : []),
      note("Bu sayılar izin kaydıdır; gönderim anında iletişim bilgisi ve (ticari mesajda) İYS kontrolü ayrıca yapılır, o yüzden gerçek alıcı sayısı daha düşük olabilir."),
      links([
        { href: "/campaigns/new", label: "Kampanya hazırla" },
        { href: "/customers", label: "Müşteriler" },
      ]),
    ],
    followUps: ["Kimlere mesaj atmalıyım?", "Kanallar bağlı mı?"],
  };
}

function campaignResultsAnswer(match: QuestionMatch, r: ReportData, venueLabel?: string | null): AssistantAnswer {
  if (r.campaigns.length === 0) {
    return {
      topic: match.topic,
      title: "Kampanya sonuçları",
      lead: `Son ${match.periodDays} günde canlı kampanya gönderilmedi.`,
      scope: scopeLine(match.periodDays, venueLabel),
      blocks: [note("Test gönderimleri bu sayılara girmez; yalnızca canlı kampanyalar raporlanır."), links([{ href: "/campaigns", label: "Kampanyalar" }])],
      followUps: ["Kampanya nasıl gönderilir?", "Kanallar bağlı mı?"],
    };
  }
  const accepted = r.campaigns.reduce((n, c) => n + c.accepted, 0);
  const delivered = r.campaigns.reduce((n, c) => n + c.delivered, 0);
  return {
    topic: match.topic,
    title: "Kampanya sonuçları",
    lead: `Son ${match.periodDays} günde ${fmt(accepted)} mesaj iletildi, ${fmt(delivered)} tanesi teslim edildi.`,
    scope: scopeLine(match.periodDays, venueLabel),
    blocks: [
      {
        kind: "rows",
        rows: r.campaigns.map((c) => ({
          label: CAMPAIGN_CHANNEL_LABELS[c.channel],
          value: `${fmt(c.delivered)} / ${fmt(c.accepted)} teslim`,
          sub: `${c.channel === "EMAIL" ? `${fmt(c.opened)} açıldı` : `${fmt(c.read)} okundu`}${c.problems > 0 ? ` · ${fmt(c.problems)} sorunlu` : ""}`,
          ratio: c.accepted > 0 ? c.delivered / c.accepted : 0,
        })),
      },
      note("Durumlar sağlayıcıların bildirdiği gerçek bildirimlerdir. Kampanyanın satışa dönüşümü ölçülmediği için tahmin edilmez."),
      links([{ href: "/campaigns", label: "Kampanyalar" }]),
    ],
    followUps: ["Kimlere mesaj atmalıyım?", "Kanallar bağlı mı?"],
  };
}

function perksAnswer(match: QuestionMatch, r: ReportData, venueLabel?: string | null): AssistantAnswer {
  if (r.perks.length === 0) return emptyAnswer(match, "Avantajlar", venueLabel, ["Avantaj nasıl tanımlanır?", "Son 90 günde hangi avantaj kullanıldı?"]);
  const top = r.perks[0];
  return {
    topic: match.topic,
    title: "Avantajlar",
    lead: `Son ${match.periodDays} günde ${fmt(r.totals.redemptions.current)} avantaj kullanıldı; en çok "${top.label}" (${fmt(top.value)} kez).`,
    scope: scopeLine(match.periodDays, venueLabel),
    blocks: [
      { kind: "rows", rows: r.perks.map((p) => ({ label: p.label, value: `${fmt(p.value)} kullanım`, ratio: p.value / top.value })) },
      links([{ href: "/menu/perks", label: "Avantajlar" }]),
    ],
    followUps: ["Avantaj nasıl tanımlanır?", "Kaç kişi geldi?"],
  };
}

async function channelsAnswer(ctx: ServiceContext, match: QuestionMatch, now: Date): Promise<AssistantAnswer> {
  const [overview, sms, email, instagram] = await Promise.all([getChannelOverview(ctx, now), getSmsAccount(ctx), getEmailOverview(ctx), getInstagramOverview(ctx, now)]);
  const whatsapp = overview.account?.status === "ACTIVE" && overview.account.tokenUsable ? overview.account : null;
  const rows = [
    { label: "WhatsApp", ready: Boolean(whatsapp), detail: whatsapp ? whatsapp.displayPhoneNumber : "numara bağlı değil" },
    { label: "SMS", ready: sms?.status === "ACTIVE" && sms.passwordUsable, detail: sms?.status === "ACTIVE" ? `başlık ${sms.msgheader}` : "Netgsm bağlı değil" },
    { label: "E-posta", ready: email.provider.ready && Boolean(email.settings), detail: !email.provider.ready ? "servis yapılandırılmadı" : email.settings ? `gönderen ${email.settings.senderName}` : "gönderici ayarlanmadı" },
    { label: "Instagram", ready: Boolean(instagram.account?.tokenUsable), detail: instagram.account?.username ? `@${instagram.account.username}` : "hesap bağlı değil" },
  ];
  const readyCount = rows.filter((r) => r.ready).length;
  return {
    topic: match.topic,
    title: "Kanal durumu",
    lead: readyCount === 0 ? "Hiçbir mesaj kanalı bağlı değil; şu an kampanya gönderilemez." : `${readyCount} kanal gönderime hazır.`,
    scope: null,
    blocks: [
      { kind: "rows", rows: rows.map((r) => ({ label: r.label, value: r.ready ? "hazır" : "bağlı değil", sub: r.detail })) },
      links([
        { href: "/campaigns/whatsapp", label: "WhatsApp" },
        { href: "/campaigns/sms", label: "SMS" },
        { href: "/campaigns/email", label: "E-posta" },
        { href: "/campaigns/instagram", label: "Instagram" },
      ]),
    ],
    followUps: ["Kampanya nasıl gönderilir?", "Kimlere mesaj atmalıyım?"],
  };
}

/**
 * Belirli bir kişiyle ilgili sorular. Kişisel veriler yalnızca panelde gösterilir,
 * dil modeline gönderilmez (cevap cümlesi bu konuda modele yazdırılmaz).
 */
async function customerAnswer(ctx: ServiceContext, match: QuestionMatch, now: Date): Promise<AssistantAnswer> {
  if (!can(ctx.role, "customers.view")) {
    return {
      topic: match.topic,
      title: "Müşteri",
      lead: "Müşteri kayıtlarını görme yetkiniz yok.",
      scope: null,
      blocks: [note("Bu veriyi işletme sahibi ve CRM yöneticisi görebilir.", "caution")],
      followUps: STARTER_QUESTIONS.slice(0, 3),
    };
  }
  const search = match.person ? customerSearchWhere(match.person) : undefined;
  if (!search) {
    return {
      topic: match.topic,
      title: "Müşteri",
      lead: "Kimi sorduğunuzu anlayamadım.",
      scope: null,
      blocks: [note("Kişinin adını veya telefon numarasını yazın: “Ayşe Yılmaz en son ne zaman geldi?”"), links([{ href: "/customers", label: "Müşteriler" }])],
      followUps: ["Kimlere mesaj atmalıyım?", "Müşteri nasıl eklenir?"],
    };
  }

  const rows = await db.customer.findMany({
    where: { tenantId: ctx.tenantId, ...search },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      createdAt: true,
      archivedAt: true,
      consents: { where: { status: "GRANTED" }, select: { channel: true } },
      checkIns: { where: { event: venueScope(ctx) }, select: { checkedInAt: true }, orderBy: { checkedInAt: "desc" }, take: 1 },
      _count: {
        select: {
          checkIns: { where: { event: venueScope(ctx) } },
          registrations: { where: { accessStatus: "ACTIVE" } },
          perkRedemptions: true,
        },
      },
    },
    orderBy: { searchName: "asc" },
    take: 5,
  });

  if (rows.length === 0) {
    return {
      topic: match.topic,
      title: "Müşteri",
      lead: `“${match.person}” için kayıt bulunamadı.`,
      scope: null,
      blocks: [note("Arama ad, soyad, telefon ve e-posta üzerinde çalışır. Kişi arşivlenmiş de olabilir."), links([{ href: "/customers", label: "Müşteriler" }])],
      followUps: ["Müşteri nasıl eklenir?", "Kimlere mesaj atmalıyım?"],
    };
  }

  const describe = (c: (typeof rows)[number]) => {
    const last = c.checkIns[0]?.checkedInAt;
    const parts = [
      last ? `en son ${formatShortDate(last)} (${formatRelative(last, now)})` : "hiç gelmemiş",
      `${fmt(c._count.checkIns)} ziyaret`,
      c._count.registrations > 0 ? `${fmt(c._count.registrations)} kayıt` : null,
      c._count.perkRedemptions > 0 ? `${fmt(c._count.perkRedemptions)} avantaj` : null,
      c.consents.length > 0 ? `izin: ${c.consents.map((x) => labelOf(CHANNEL_LABELS, x.channel)).join(", ")}` : "izin yok",
      c.archivedAt ? "arşivde" : null,
    ].filter(Boolean);
    return parts.join(" · ");
  };

  const one = rows.length === 1 ? rows[0] : null;
  const lastVisit = one?.checkIns[0]?.checkedInAt ?? null;
  return {
    topic: match.topic,
    title: one ? fullName(one) : "Eşleşen kişiler",
    lead: one
      ? lastVisit
        ? `${fullName(one)} en son ${formatShortDate(lastVisit)} tarihinde geldi (${formatRelative(lastVisit, now)}); toplam ${fmt(one._count.checkIns)} ziyaret.`
        : `${fullName(one)} kayıtlı ama henüz kapıdan girişi yok.`
      : `“${match.person}” için ${fmt(rows.length)} kayıt eşleşti.`,
    scope: null,
    blocks: [
      {
        kind: "rows",
        rows: rows.map((c) => ({
          label: fullName(c),
          value: formatPhone(c.phone) || c.email || "iletişim bilgisi yok",
          sub: describe(c),
          href: `/customers/${c.id}`,
        })),
      },
      note("Kişisel bilgiler yalnızca panelde gösterilir; dil modeline gönderilmez."),
      links([{ href: "/customers", label: "Müşteriler" }]),
    ],
    followUps: ["Kimlere mesaj atmalıyım?", "Kaç kişiye mesaj atabilirim?"],
  };
}

// ─────────────────────────────────────────────── Taslak metin

/** Kitleye göre hazır metin şablonu. Dil modeli üretmez; işletme adı ve kişi adı yerleştirilir. */
const DRAFT_BODIES: Record<SegmentKey, (venue: string) => string> = {
  LAPSED_30: (v) => `Merhaba {{ad}}, uzun zamandır görüşemedik. Bu hafta ${locativeOf(v)} sizi yeniden ağırlamak isteriz.`,
  LAPSED_60: (v) => `Merhaba {{ad}}, sizi özledik. ${v} bu hafta yeni programıyla sizi bekliyor.`,
  LAPSED_90: (v) => `Merhaba {{ad}}, epeydir uğramadınız. ${locativeOf(v)} sizin için ayırdığımız masa hazır.`,
  NO_SHOW_RECENT: (v) => `Merhaba {{ad}}, geçen etkinlikte sizi göremedik. Bu haftaki programda ${locativeOf(v)} yeriniz hazır.`,
  NEW_NOT_VISITED: (v) => `Merhaba {{ad}}, aramıza hoş geldiniz. İlk ziyaretinizde ${locativeOf(v)} sizi ağırlamaktan memnuniyet duyarız.`,
  BIRTHDAY_THIS_MONTH: (v) => `Merhaba {{ad}}, doğum gününüz kutlu olsun. Bu ay ${locativeOf(v)} ikramımız sizi bekliyor.`,
  NOT_MESSAGED_60: (v) => `Merhaba {{ad}}, ${locativeOf(v)} bu haftanın programı hazır. Detaylar için bizi arayabilirsiniz.`,
  WHATSAPP_CONSENTED: (v) => `Merhaba {{ad}}, ${locativeOf(v)} bu haftanın programı hazır. Sizi aramızda görmek isteriz.`,
  SMS_CONSENTED: (v) => `Merhaba {{ad}}, ${locativeOf(v)} bu haftanın programı hazır. Sizi aramızda görmek isteriz.`,
  EMAIL_CONSENTED: (v) => `Merhaba {{ad}}, ${locativeOf(v)} bu haftanın programı hazır. Sizi aramızda görmek isteriz.`,
};

const DRAFT_HINTS: Record<CampaignChannel, string> = {
  WHATSAPP: "WhatsApp'ta serbest metin gönderilmez: bu metni şablon olarak kaydedip Meta onayına göndermeniz gerekir.",
  SMS: "SMS'te yasal alt bilgi (unvan/MERSIS ve ret bilgisi) gönderim sırasında otomatik eklenir; toplam uzunluk SMS adedini belirler.",
  EMAIL: "E-postada ayrıca bir konu başlığı yazmanız gerekir; alt bilgi ve abonelikten çıkma bağlantısı otomatik eklenir.",
};

async function draftAnswer(ctx: ServiceContext, match: QuestionMatch, tenantName: string, venueLabel: string | null | undefined, now: Date): Promise<AssistantAnswer> {
  const options = await getAudienceOptions(ctx, now);
  const segmentKey: SegmentKey = match.segment ?? [...options.suggested].sort((a, b) => b.reachable - a.reachable)[0]?.key ?? "LAPSED_30";
  const option = options.suggested.find((s) => s.key === segmentKey);
  const channel: CampaignChannel = match.channel ?? "WHATSAPP";
  const venue = venueLabel?.trim() || tenantName;
  const body = DRAFT_BODIES[segmentKey](venue);
  const reachable = option?.reachableBy[channel] ?? 0;
  const copy = SEGMENT_COPY[segmentKey];

  return {
    topic: match.topic,
    title: "Mesaj taslağı",
    lead: option
      ? `${copy.label} kitlesinde ${fmt(option.total)} kişi var; ${CAMPAIGN_CHANNEL_LABELS[channel]} ile ${fmt(reachable)} kişiye ulaşılabiliyor.`
      : `${copy.label} kitlesi için hazırladığım taslak aşağıda.`,
    scope: `${CAMPAIGN_CHANNEL_LABELS[channel]} · ${copy.label}`,
    blocks: [
      { kind: "draft", channel, body, hint: DRAFT_HINTS[channel] },
      note("Bu metin hazır bir şablondur, dil modeli yazmadı. Göndermeden önce kendi diliniz ve teklifinizle düzenleyin; {{ad}} yerine kişinin adı gelir."),
      ...(reachable === 0 ? [note("Bu kitlede bu kanaldan ulaşılabilecek kişi yok: iletişim bilgisi veya kanal izni eksik.", "caution")] : []),
      links([
        { href: `/campaigns/new?kanal=${channel === "WHATSAPP" ? "whatsapp" : channel === "SMS" ? "sms" : "eposta"}`, label: "Kampanya ekranında düzenle" },
        ...(channel === "WHATSAPP" ? [{ href: "/campaigns/templates", label: "Şablonlar" }] : []),
      ]),
    ],
    followUps: ["Kimlere mesaj atmalıyım?", "Kanallar bağlı mı?", "Kampanya nasıl gönderilir?"],
  };
}

// ─────────────────────────────────────────────── Rehber ve yetenekler

function howToAnswer(match: QuestionMatch): AssistantAnswer {
  const guide = GUIDES[match.guide ?? "CAMPAIGN_SEND"];
  return {
    topic: "HOWTO",
    title: guide.title,
    lead: "Adımlar şöyle:",
    scope: null,
    blocks: [
      { kind: "steps", steps: guide.steps },
      ...(guide.caution ? [note(guide.caution, "caution")] : []),
      links(guide.links),
    ],
    followUps: ["Neler yapabilirsin?", "Son 30 günde işler nasıl gidiyor?"],
  };
}

function capabilitiesAnswer(): AssistantAnswer {
  return {
    topic: "CAPABILITIES",
    title: "Neler yapabilirim",
    lead: "Verinizi okuyup gerçek sayılarla cevap veririm; panelde bir işi nasıl yapacağınızı adım adım anlatırım.",
    scope: null,
    blocks: [
      {
        kind: "bullets",
        items: [
          "Dönem özeti: giriş, yeni müşteri, etkinlik kaydı, avantaj kullanımı.",
          "Yoğunluk: en yoğun saat ve gün.",
          "Etkinlik ve PR performansı: davetlinin ne kadarı kapıdan girdi.",
          "Kitle önerisi: bir süredir gelmeyenler, doğum günü olanlar, kaydolup gelmeyenler.",
          "Kampanya sonuçları ve iletişim izinleri.",
          "Mesaj taslağı: kitleye uygun hazır şablon metin.",
          "Panel rehberi: guest ekleme, kampanya gönderme, QR menü, kapı girişi, avantaj, PR daveti.",
        ],
      },
      note("Kampanya göndermem, kayıt değiştirmem. Ölçülmeyen veriyi (menü görüntüleme, ciro, kampanya dönüşümü) tahmin etmem."),
    ],
    followUps: STARTER_QUESTIONS.slice(0, 3),
  };
}

/**
 * Gündelik sohbet. Cevabı dil modeli yazar; panel verisi gönderilmez ve
 * bu yüzden cevap "Sohbet" olarak işaretlenir — veriye dayanan cevaplarla karışmasın.
 */
async function chatAnswer(question: string, history: HistoryTurn[]): Promise<AssistantAnswer> {
  const reply = await chatReply(question, history);
  if (!reply) return unknownAnswer();
  return {
    topic: "CHAT",
    title: "",
    lead: reply,
    scope: "Sohbet · panel verisi kullanılmadı",
    blocks: [],
    followUps: ["Son 30 günde işler nasıl gidiyor?", "Kimlere mesaj atmalıyım?"],
  };
}

/**
 * Ölçülmeyen veriler: ciro, menü görüntüleme, kampanya dönüşümü. Circular bunları
 * toplamaz (kasa/POS bağlantısı yoktur), bu yüzden tahmin de edilmez.
 */
function unmeasuredAnswer(): AssistantAnswer {
  return {
    topic: "UNMEASURED",
    title: "Bu veri ölçülmüyor",
    lead: "Ciro, adisyon tutarı, menü görüntüleme ve kampanyanın satışa dönüşümü Circular'da toplanmıyor; kasa/POS bağlantısı yok. Bu yüzden bir rakam veremem, tahmin de etmem.",
    scope: null,
    blocks: [
      {
        kind: "bullets",
        items: [
          "Ölçülenler: kapıdan giren kişi, etkinlik kaydı ve davetli sayısı, yeni müşteri ve kaynağı, avantaj kullanımı, PR katkısı, iletişim izinleri, kampanya teslim ve okunma durumları.",
          "Ölçülmeyenler: ciro ve adisyon, kişi başı harcama, menü görüntüleme sayısı, kampanyanın satışa dönüşümü.",
        ],
      },
      note("Bunlar ileride kasa/POS entegrasyonu veya menü görüntüleme ölçümü eklenirse gelir; o zamana kadar raporlarda da yer almaz."),
      links([{ href: "/reports", label: "Ölçülen verileri gör" }]),
    ],
    followUps: ["Son 30 günde kaç kişi geldi?", "Etkinlikler nasıl gitti?", "Hangi avantajlar kullanıldı?"],
  };
}

/** Dil modeli yokken selamlaşma: kısa ve dürüst, sohbeti sürdürmeye çalışmaz. */
function greetingAnswer(question: string): AssistantAnswer {
  const words = foldText(question);
  const thanks = /tesekkur|sagol|sag ol|eyvallah/.test(words);
  return {
    topic: "CHAT",
    title: "",
    lead: thanks ? "Rica ederim. Başka bir şey sormak isterseniz buradayım." : "Merhaba. Verinizle ilgili ne sormak istersiniz?",
    scope: null,
    blocks: [],
    followUps: [...STARTER_QUESTIONS.slice(0, 3)],
  };
}

function unknownAnswer(): AssistantAnswer {
  return {
    topic: "UNKNOWN",
    title: "Bunu anlayamadım",
    lead: modelReady()
      ? "Bu soru panelde tuttuğum verilerin dışında kalıyor; tahmin yürütmek yerine sormayı tercih ederim."
      : "Henüz bir dil modeli bağlı olmadığı için yalnızca tanımlı konuları anlıyorum; tahmin yürütmek yerine sormayı tercih ederim.",
    scope: null,
    blocks: [note("Şunları sorabilirsiniz:")],
    followUps: [...STARTER_QUESTIONS],
  };
}

// ─────────────────────────────────────────────── Dil modeli katmanı

/** Ücretsiz model kotasını korur: işletme başına dakikada 20 soru. */
const modelLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

/**
 * Modele gönderilebilecek konuşma geçmişi: kişi adı içerebilen cevaplar ve onları
 * doğuran sorular çıkarılır (müşteri kartı, PR performansı).
 */
export function safeHistory(history: ChatTurn[] | undefined): HistoryTurn[] {
  const turns = (history ?? []).slice(-MAX_HISTORY_TURNS);
  const out: HistoryTurn[] = [];
  for (const turn of turns) {
    if (turn.role === "assistant" && turn.topic && PERSONAL_TOPICS.includes(turn.topic)) {
      if (out.length > 0 && out[out.length - 1].role === "user") out.pop();
      continue;
    }
    const content = turn.text.trim().slice(0, 300);
    if (content) out.push({ role: turn.role, content });
  }
  return out;
}

/** Cevap cümlesinin modele yazdırılabileceği konular: yalnızca toplu sayılar içerir. */
const PHRASABLE_TOPICS = new Set<AssistantTopic>(["SUMMARY", "VISITS", "PEAK_TIME", "NEW_CUSTOMERS", "EVENTS", "CONSENTS", "CAMPAIGN_RESULTS", "PERKS", "AUDIENCE"]);

/** Modele gönderilecek özet: etiket ve sayı çiftleri. Kişi adı veya iletişim bilgisi içermez. */
function factsOf(answer: AssistantAnswer): string {
  const lines: string[] = [];
  if (answer.scope) lines.push(`Kapsam: ${answer.scope}`);
  lines.push(answer.lead);
  for (const block of answer.blocks) {
    if (block.kind === "stats") lines.push(...block.items.map((i) => `${i.label}: ${i.value}${i.sub ? ` (${i.sub})` : ""}`));
    if (block.kind === "rows") lines.push(...block.rows.map((r) => `${r.label}: ${r.value}${r.sub ? ` (${r.sub})` : ""}`));
    if (block.kind === "note") lines.push(block.text);
  }
  return lines.join("\n");
}

/**
 * Soruyu önce anahtar kelimelerle çözer. Eşleşme zayıfsa ve dil modeli bağlıysa
 * sınıflandırmayı modele sorar; model erişilemezse anahtar kelime sonucu kullanılır.
 */
async function resolveQuestion(ctx: ServiceContext, question: string, history: HistoryTurn[]): Promise<QuestionMatch> {
  const local = readQuestion(question);
  if (local.confident || !modelReady()) return local;
  if (!modelLimiter.hit(ctx.tenantId).allowed) return local;

  const intent = await classifyQuestion(question, history);
  if (!intent) return local;
  return {
    topic: intent.topic,
    guide: intent.guide ?? local.guide,
    periodDays: intent.periodDays,
    segment: intent.segment ?? local.segment,
    channel: intent.channel ?? local.channel,
    person: intent.person ?? local.person,
    confident: true,
  };
}

// ─────────────────────────────────────────────── Giriş noktası

export async function ask(ctx: ServiceContext, input: AskInput, now = new Date()): Promise<AssistantAnswer> {
  assertCan(ctx, "assistant.use");
  const question = (input.question ?? "").slice(0, MAX_QUESTION_LENGTH);
  const history = safeHistory(input.history);
  const match = await resolveQuestion(ctx, question, history);
  const answer = await answerFor(ctx, match, input, now, history);

  // Cevap cümlesini model yazsın: yalnızca toplu sayılar gider ve sayılar doğrulanır.
  if (PHRASABLE_TOPICS.has(answer.topic) && modelReady() && modelLimiter.hit(ctx.tenantId).allowed) {
    const facts = factsOf(answer);
    const lead = await phraseLead({ question, facts });
    if (lead) return { ...answer, lead };
  }
  return answer;
}

async function answerFor(ctx: ServiceContext, match: QuestionMatch, input: AskInput, now: Date, history: HistoryTurn[]): Promise<AssistantAnswer> {
  const venueLabel = input.venueLabel ?? null;
  const question = input.question ?? "";

  if (match.topic === "HOWTO") return howToAnswer(match);
  if (match.topic === "CAPABILITIES") return capabilitiesAnswer();
  if (match.topic === "UNMEASURED") return unmeasuredAnswer();
  // Sohbet ve anlaşılmayan soru: dil modeli varsa konuşur, yoksa dürüstçe anlamadığını söyler.
  if (match.topic === "CHAT") return modelReady() ? chatAnswer(question, history) : greetingAnswer(question);
  if (match.topic === "UNKNOWN") return modelReady() ? chatAnswer(question, history) : unknownAnswer();

  if (match.topic === "PROMOTERS") return promotersAnswer(ctx, match, now);
  if (match.topic === "CHANNELS") return channelsAnswer(ctx, match, now);
  if (match.topic === "CUSTOMER") return customerAnswer(ctx, match, now);

  if (match.topic === "AUDIENCE" || match.topic === "DRAFT") {
    if (!can(ctx.role, "campaigns.manage")) {
      return {
        topic: match.topic,
        title: "Kitle ve kampanya",
        lead: "Kampanya verisini görme yetkiniz yok.",
        scope: null,
        blocks: [note("Bu bölümü işletme sahibi ve CRM yöneticisi kullanabilir.", "caution")],
        followUps: STARTER_QUESTIONS.slice(0, 3),
      };
    }
    if (match.topic === "AUDIENCE") return audienceAnswer(ctx, match, now);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true } });
    return draftAnswer(ctx, match, tenant.name, venueLabel, now);
  }

  if (!can(ctx.role, "reports.view")) {
    return {
      topic: match.topic,
      title: "Raporlar",
      lead: "Rapor verisini görme yetkiniz yok.",
      scope: null,
      blocks: [note("Bu veriyi işletme sahibi ve CRM yöneticisi görebilir.", "caution")],
      followUps: STARTER_QUESTIONS.slice(0, 3),
    };
  }

  const report = await getReports(ctx, { periodDays: match.periodDays, venueId: input.venueId ?? null }, now);
  switch (match.topic) {
    case "VISITS":
      return visitsAnswer(match, report, venueLabel);
    case "PEAK_TIME":
      return peakTimeAnswer(match, report, venueLabel);
    case "NEW_CUSTOMERS":
      return newCustomersAnswer(match, report, venueLabel);
    case "EVENTS":
      return eventsAnswer(match, report, venueLabel);
    case "CONSENTS":
      return consentsAnswer(match, report);
    case "CAMPAIGN_RESULTS":
      return campaignResultsAnswer(match, report, venueLabel);
    case "PERKS":
      return perksAnswer(match, report, venueLabel);
    default:
      return summaryAnswer(match, report, venueLabel);
  }
}
