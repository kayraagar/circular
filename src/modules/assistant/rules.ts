import { foldText } from "@/lib/normalize";
import type { CampaignChannel, SegmentKey } from "@/modules/campaigns/rules";

/**
 * Asistanın soru anlama katmanı — sunucu ve istemci bileşenleri birlikte kullanır.
 *
 * Henüz bir dil modeli bağlı değildir: soru, tanımlı konuların anahtar kelimeleriyle
 * eşleştirilir ve cevap her zaman veritabanındaki gerçek kayıtlardan üretilir.
 * Eşleşme yoksa uydurma cevap verilmez; asistan anlamadığını söyler.
 */

// ─────────────────────────────────────────────── Konular

export const ASSISTANT_TOPICS = [
  "SUMMARY",
  "VISITS",
  "PEAK_TIME",
  "NEW_CUSTOMERS",
  "EVENTS",
  "PROMOTERS",
  "AUDIENCE",
  "CONSENTS",
  "CAMPAIGN_RESULTS",
  "DRAFT",
  "PERKS",
  "CHANNELS",
  "CUSTOMER",
  "CHAT",
  "UNMEASURED",
  "HOWTO",
  "CAPABILITIES",
  "UNKNOWN",
] as const;
export type AssistantTopic = (typeof ASSISTANT_TOPICS)[number];

/** Konu anahtar kelimeleri — hepsi katlanmış yazılır ("müşteri" değil "musteri"). */
const TOPIC_KEYWORDS: Record<Exclude<AssistantTopic, "UNKNOWN">, readonly string[]> = {
  SUMMARY: ["ozet", "genel durum", "son durum", "neler oldu", "isler nasil", "nasil gidiyor", "durum nedir", "performans"],
  VISITS: ["kac kisi geldi", "kac kisi girdi", "giris", "ziyaret", "gelen kisi", "kapidan gecen", "trafik", "kac musteri geldi"],
  PEAK_TIME: ["en yogun", "hangi saat", "hangi gun", "yogunluk", "saat dagilimi", "en iyi gun", "en iyi saat", "kalabalik"],
  NEW_CUSTOMERS: ["yeni musteri", "musteri kazanimi", "kac yeni", "nereden geliyor", "musteri kaynagi", "kayit kaynagi", "buyume"],
  EVENTS: ["etkinlik", "gece nasil", "parti nasil", "hangi etkinlik", "etkinlik performansi", "doluluk"],
  PROMOTERS: ["pr", "promoter", "pr performansi", "hangi pr", "en iyi pr", "pr ekibi", "pr katkisi"],
  AUDIENCE: ["kime mesaj", "kimlere mesaj", "hedef kitle", "segment", "kitle", "kime gonderelim", "gelmeyenler", "geri kazan", "kayip musteri", "oneri"],
  CONSENTS: ["izin", "izinli kisi", "onay", "iys", "abonelikten cikan", "kac kisiye mesaj atabilirim", "ulasabilecegim"],
  CAMPAIGN_RESULTS: ["kampanya sonucu", "kampanyalar nasil", "teslim edildi", "okundu", "kampanya performansi", "gonderdiklerim"],
  DRAFT: ["taslak", "taslak hazirla", "taslak mesaj", "mesaj yaz", "metin yaz", "ne yazayim", "mesaj hazirla", "kampanya hazirla", "metin oner"],
  PERKS: ["avantaj", "ikram", "hediye", "perk", "kullanilan avantaj"],
  CHANNELS: ["kanal durumu", "bagli mi", "whatsapp durumu", "sms durumu", "eposta durumu", "instagram durumu", "kurulum durumu", "hazir mi"],
  CUSTOMER: ["en son ne zaman", "kayitli mi", "musteri ara", "numara kayitli", "kim geldi", "bu kisi", "ne zaman geldi"],
  UNMEASURED: ["ciro", "hasilat", "gelir", "kazanc", "kar", "satis", "adisyon", "hesap tutari", "menu goruntule", "donusum", "roi", "kisi basi harcama"],
  CHAT: ["merhaba", "selam", "gunaydin", "iyi aksamlar", "iyi geceler", "nasilsin", "tesekkur", "sagol", "naber", "gorusuruz"],
  HOWTO: [],
  CAPABILITIES: ["ne yapabilirsin", "neler yapabilirsin", "ne sorabilirim", "nasil calisirsin", "kimsin", "yardim"],
};

// ─────────────────────────────────────────────── Panel rehberleri

export const GUIDE_KEYS = [
  "GUEST_ADD",
  "EVENT_CREATE",
  "CAMPAIGN_SEND",
  "MENU_QR",
  "DOOR_CHECKIN",
  "PERK_SETUP",
  "PR_INVITE",
  "CUSTOMER_ADD",
  "CONSENT_RECORD",
  "CHANNEL_CONNECT",
  "TEAM_MEMBER",
  "REPORTS_WHERE",
] as const;
export type GuideKey = (typeof GUIDE_KEYS)[number];

export type Guide = {
  key: GuideKey;
  title: string;
  steps: string[];
  links: { href: string; label: string }[];
  /** Panelde henüz olmayan bir işse dürüst uyarı */
  caution?: string;
  keywords: readonly string[];
};

export const GUIDES: Record<GuideKey, Guide> = {
  GUEST_ADD: {
    key: "GUEST_ADD",
    title: "Etkinliğe misafir (guest) eklemek",
    steps: [
      "Etkinlikler ve Guest ekranından ilgili etkinliği açın.",
      "Misafir ekle alanına ad ve telefon yazın; kayıtlı kişilerde arama sonuçlarından seçin.",
      "Kaç kişi geleceğini (parti büyüklüğü) girin ve kaydedin.",
      "Misafire giriş QR'ını paylaşın; kapıda bu QR okutulur.",
    ],
    links: [{ href: "/events", label: "Etkinlikler ve Guest" }],
    keywords: ["guest", "misafir ekle", "listeye ekle", "guest list", "davetli ekle"],
  },
  EVENT_CREATE: {
    key: "EVENT_CREATE",
    title: "Yeni etkinlik oluşturmak",
    steps: [
      "Etkinlikler ekranında Yeni etkinlik'e basın.",
      "Ad, mekan, başlangıç ve bitiş saatini girin; kapasite opsiyoneldir.",
      "Taslak olarak kaydedip hazır olduğunuzda Yayınla'ya basın.",
      "Yayına alınan etkinliğe guest eklenebilir ve kapıda giriş alınabilir.",
    ],
    links: [{ href: "/events/new", label: "Yeni etkinlik" }],
    keywords: ["etkinlik olustur", "etkinlik ekle", "yeni etkinlik", "gece olustur", "etkinlik yarat"],
  },
  CAMPAIGN_SEND: {
    key: "CAMPAIGN_SEND",
    title: "Kampanya göndermek",
    steps: [
      "Kampanyalar → Yeni kampanya ekranını açın.",
      "Kanalı seçin: WhatsApp, SMS veya e-posta. Kanal bağlı değilse önce kurulumu tamamlayın.",
      "Kitleyi seçin: önerilen kitleler, etiket/etkinlik ile toplu seçim veya tek tek seçim.",
      "Mesajı hazırlayın; önizlemede kaç kişiye gideceğini ve elenenleri görün.",
      "Önce test gönderimi yapın, sonra canlı gönderimi onaylayın.",
    ],
    links: [
      { href: "/campaigns/new", label: "Yeni kampanya" },
      { href: "/campaigns", label: "Kampanyalar" },
    ],
    keywords: ["kampanya gonder", "toplu mesaj", "mesaj gonder", "duyuru gonder", "sms gonder", "eposta gonder"],
  },
  MENU_QR: {
    key: "MENU_QR",
    title: "QR menü hazırlamak",
    steps: [
      "QR Menü ekranında menü düzenleyiciyi açın; kategori ve ürünleri girin.",
      "Tema ve kapak görselini seçin, menüyü yayınlayın.",
      "Aynı ekrandaki QR kartını yazdırıp masalara koyun.",
      "Menüdeki kayıt formundan gelen kişiler CRM'e 'QR menü' kaynağıyla düşer.",
    ],
    links: [
      { href: "/menu", label: "QR Menü" },
      { href: "/menu/builder", label: "Menü düzenleyici" },
    ],
    keywords: ["qr menu", "menu olustur", "menu ekle", "karekod", "masa qr", "menu yayinla"],
  },
  DOOR_CHECKIN: {
    key: "DOOR_CHECKIN",
    title: "Kapıda giriş doğrulamak",
    steps: [
      "Kapı görevlisi kendi hesabıyla girer ve Giriş doğrulama ekranını açar.",
      "Etkinliği seçer, misafirin QR'ını okutur.",
      "Ekranda kişi, kaç kişilik olduğu ve giriş hakkı görünür; onaylanınca giriş kaydedilir.",
      "Yanlış kaydedilen girişi yalnızca işletme sahibi geri alabilir.",
    ],
    links: [{ href: "/door", label: "Giriş doğrulama" }],
    keywords: ["kapida", "giris dogrula", "check in", "checkin", "kapi gorevlisi", "qr okut"],
  },
  PERK_SETUP: {
    key: "PERK_SETUP",
    title: "Avantaj (ikram) tanımlamak",
    steps: [
      "QR Menü → Avantajlar ekranından yeni avantaj oluşturun.",
      "Adını ve geçerli olduğu mekanı seçin.",
      "Müşteri kartından avantaj QR'ı üretin; QR kişiye özeldir.",
      "Garson kendi ekranında QR'ı okutarak avantajı kullandırır; her kullanım tek seferdir.",
    ],
    links: [
      { href: "/menu/perks", label: "Avantajlar" },
      { href: "/redeem", label: "Avantaj doğrulama" },
    ],
    keywords: ["avantaj tanimla", "ikram tanimla", "avantaj olustur", "hediye tanimla", "avantaj ekle"],
  },
  PR_INVITE: {
    key: "PR_INVITE",
    title: "PR'a davet linki vermek",
    steps: [
      "PR Yönetimi ekranında ilgili etkinliği ve PR'ı seçin.",
      "Kişiye özel davet linki ve QR üretin.",
      "PR bu linki paylaşır; misafir kendi bilgisini girerek kaydolur.",
      "Kayıt o PR'a yazılır; misafire kendi giriş QR'ı gider.",
    ],
    links: [{ href: "/pr", label: "PR Yönetimi" }],
    keywords: ["davet linki", "pr linki", "pr davet", "referral", "pr qr"],
  },
  CUSTOMER_ADD: {
    key: "CUSTOMER_ADD",
    title: "Müşteri eklemek",
    steps: [
      "Müşteriler → Yeni müşteri ekranını açın.",
      "Ad, soyad ve telefon (veya e-posta) girin; aynı numara varsa panel uyarır.",
      "Kaynağı seçin ve varsa etiket ekleyin.",
      "İletişim izinlerini kişinin beyanına göre işaretleyin.",
    ],
    links: [{ href: "/customers/new", label: "Yeni müşteri" }],
    keywords: ["musteri ekle", "kisi ekle", "rehbere ekle", "numara ekle", "musteri kaydet"],
  },
  CONSENT_RECORD: {
    key: "CONSENT_RECORD",
    title: "İletişim izni kaydetmek",
    steps: [
      "Müşteri kartındaki İletişim izinleri bölümünü açın.",
      "Kişinin açık rızası varsa kanalı (WhatsApp / SMS / e-posta) işaretleyin; her değişiklik kim ve ne zaman olarak kaydedilir.",
      "Kişi 'DUR' yazarsa veya abonelikten çıkarsa izin otomatik kaldırılır.",
      "Ticari SMS ve e-postada İYS kontrolü gönderim anında sağlayıcı tarafında yapılır.",
    ],
    links: [{ href: "/customers", label: "Müşteriler" }],
    keywords: ["izin kaydet", "izin al", "onay al", "iys nedir", "rizayi kaydet"],
  },
  CHANNEL_CONNECT: {
    key: "CHANNEL_CONNECT",
    title: "Mesaj kanalı bağlamak",
    steps: [
      "WhatsApp: Kampanyalar → WhatsApp ekranından işletme numaranızı bağlayın (Meta onayı gerekir).",
      "SMS: Kampanyalar → SMS ekranında Netgsm kullanıcı adı, şifre ve onaylı başlığınızı girin.",
      "E-posta: Kampanyalar → E-posta ekranında görünen adı ve zorunlu yasal alt bilgiyi ayarlayın.",
      "Instagram: Kampanyalar → Instagram ekranından hesabı bağlayıp DM anahtar kelime yanıtlarını tanımlayın.",
    ],
    links: [
      { href: "/campaigns/whatsapp", label: "WhatsApp" },
      { href: "/campaigns/sms", label: "SMS" },
      { href: "/campaigns/email", label: "E-posta" },
      { href: "/campaigns/instagram", label: "Instagram" },
    ],
    keywords: ["whatsapp bagla", "sms bagla", "netgsm", "brevo", "instagram bagla", "kanal bagla", "numara bagla"],
  },
  TEAM_MEMBER: {
    key: "TEAM_MEMBER",
    title: "Ekip üyesi eklemek",
    steps: [
      "Ayarlar ekranında mevcut ekip ve rolleri görebilirsiniz.",
      "Roller: işletme sahibi, CRM yöneticisi, PR, kapı görevlisi, garson.",
      "Her rol yalnızca kendi ekranını görür; kapı görevlisi ve garson panele giremez.",
    ],
    links: [{ href: "/settings", label: "Ayarlar" }],
    caution: "Panelden ekip üyesi davet etme henüz yok; yeni kullanıcı şu an kurulum komutuyla ekleniyor. Ayarlar ekranı bu aşamada salt okunurdur.",
    keywords: ["ekip ekle", "kullanici ekle", "personel ekle", "calisan ekle", "rol ver", "yetki ver"],
  },
  REPORTS_WHERE: {
    key: "REPORTS_WHERE",
    title: "Raporlara ulaşmak",
    steps: [
      "Sol menüden Raporlar'a girin.",
      "Üstten 7 / 30 / 90 günlük dönemi seçin.",
      "Giriş, yeni müşteri, etkinlik kaydı ve avantaj kullanımı grafiklerle görünür.",
      "Menü görüntüleme, ciro ve kampanya dönüşümü ölçülmediği için raporda yoktur.",
    ],
    links: [{ href: "/reports", label: "Raporlar" }],
    keywords: ["rapor nerede", "rapor nasil", "raporlari gor", "grafikleri gor", "istatistik nerede"],
  },
};

// ─────────────────────────────────────────────── Soru çözümleme

/** Katlanmış hâlleriyle soru sözcükleri (foldText: "nasıl" → "nasil"). */
const QUESTION_WORDS = ["nasil", "nerede", "nereden", "nereye"];

function wordsOf(question: string): string[] {
  return foldText(question)
    .replace(/[^a-z0-9+ ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Ünsüz yumuşaması: "taslak" → "taslağı", "kitap" → "kitabı" (katlanmış hâlde ğ = g). */
const SOFTENED: Record<string, string> = { k: "g", p: "b", t: "d" };

/** Türkçe ekleri tolere eden eşleşme: 4+ harfli anahtar kelimede önek yeter ("izin" → "izinler"). */
function hasWord(words: string[], key: string): boolean {
  if (words.includes(key)) return true;
  if (key.length < 4) return false;
  const soft = SOFTENED[key[key.length - 1]];
  const stem = soft ? key.slice(0, -1) + soft : null;
  return words.some((w) => w.startsWith(key) || (stem !== null && w.startsWith(stem)));
}

function score(words: string[], keywords: readonly string[]): number {
  let total = 0;
  for (const keyword of keywords) {
    const parts = keyword.split(" ");
    if (parts.every((p) => hasWord(words, p))) total += parts.length === 1 ? 1 : parts.length * 1.5;
  }
  return total;
}

export const ASSISTANT_PERIODS = [7, 30, 90] as const;
export type AssistantPeriod = (typeof ASSISTANT_PERIODS)[number];

/** "son 7 gün", "bu hafta", "3 ay" gibi ifadeleri dönem uzunluğuna çevirir. */
export function readPeriod(question: string): AssistantPeriod {
  const text = foldText(question);
  const days = /(\d{1,3})\s*gun/.exec(text);
  if (days) {
    const n = Number(days[1]);
    return n <= 10 ? 7 : n <= 45 ? 30 : 90;
  }
  const words = wordsOf(question);
  if (hasWord(words, "hafta")) return 7;
  if (hasWord(words, "ceyrek") || /3\s*ay/.test(text)) return 90;
  if (hasWord(words, "ay") || hasWord(words, "aylik")) return 30;
  return 30;
}

const SEGMENT_HINTS: { key: SegmentKey; keywords: readonly string[] }[] = [
  { key: "BIRTHDAY_THIS_MONTH", keywords: ["dogum gunu", "dogum"] },
  { key: "NO_SHOW_RECENT", keywords: ["kaydolup gelmeyen", "no show", "gelmedi", "kayit yapip"] },
  { key: "NEW_NOT_VISITED", keywords: ["yeni gelmemis", "henuz gelmemis", "yeni kayit"] },
  { key: "NOT_MESSAGED_60", keywords: ["mesaj atmadigimiz", "uzun suredir mesaj", "mesaj gitmeyen", "mesaj gonderilmeyen"] },
  { key: "LAPSED_30", keywords: ["gelmeyen", "kayip", "uzaklasan", "geri kazan"] },
];

/** Soruda geçen kitle ipucu; yoksa null. */
export function readSegment(question: string): SegmentKey | null {
  const words = wordsOf(question);
  const text = foldText(question);
  for (const hint of SEGMENT_HINTS) {
    if (hint.keywords.some((k) => k.split(" ").every((p) => hasWord(words, p)))) {
      if (hint.key === "LAPSED_30") {
        if (/\b90\b/.test(text)) return "LAPSED_90";
        if (/\b60\b/.test(text)) return "LAPSED_60";
      }
      return hint.key;
    }
  }
  return null;
}

/** Soruda geçen kanal; yoksa null. */
export function readChannel(question: string): CampaignChannel | null {
  const words = wordsOf(question);
  if (hasWord(words, "whatsapp") || hasWord(words, "wp")) return "WHATSAPP";
  if (hasWord(words, "sms")) return "SMS";
  if (hasWord(words, "eposta") || hasWord(words, "email") || hasWord(words, "mail") || hasWord(words, "mailing")) return "EMAIL";
  return null;
}

/** Konuşma geçmişi — istemcide tutulur, modele yalnızca kişisel veri içermeyen kısmı gider. */
export type ChatTurn = { role: "user" | "assistant"; text: string; topic?: AssistantTopic };
export const MAX_HISTORY_TURNS = 6;

/** Cevabı kişi adı içerebilen konular: geçmişte modele gönderilmez. */
export const PERSONAL_TOPICS: readonly AssistantTopic[] = ["CUSTOMER", "PROMOTERS"];

export type QuestionMatch = {
  topic: AssistantTopic;
  guide: GuideKey | null;
  periodDays: AssistantPeriod;
  segment: SegmentKey | null;
  channel: CampaignChannel | null;
  /** Soruda geçen kişi adı veya numara parçası (müşteri sorusu için) */
  person: string | null;
  /** Eşleşme güçlü mü? Zayıfsa dil modeli varsa ona sorulur. */
  confident: boolean;
};

/** Kişi adı aramasında ayıklanacak sık sözcükler. */
const PERSON_STOPWORDS = new Set([
  "en", "son", "ne", "zaman", "geldi", "gelmis", "kim", "kimdir", "bu", "su", "o", "kayitli", "mi", "mu", "var", "yok",
  "musteri", "kisi", "numara", "telefon", "ara", "arama", "bul", "hangi", "nerede", "nasil", "kac", "kere", "defa", "gun",
]);

/** Soruda geçen kişi ipucu: önce numara, sonra büyük harfle başlayan adlar. */
export function readPerson(question: string): string | null {
  const digits = question.replace(/[^\d]/g, "");
  if (digits.length >= 7) return digits;
  const names = [...question.matchAll(/\p{Lu}[\p{Ll}'’]{1,}/gu)]
    .map((m) => m[0])
    .filter((w) => !PERSON_STOPWORDS.has(foldText(w)));
  return names.length > 0 ? names.slice(0, 2).join(" ") : null;
}

/**
 * Soruyu tek bir konuya bağlar. Skor eşiğin altındaysa UNKNOWN döner —
 * asistan zorlama bir cevap üretmez.
 */
export function readQuestion(question: string): QuestionMatch {
  const words = wordsOf(question);
  const base = {
    periodDays: readPeriod(question),
    segment: readSegment(question),
    channel: readChannel(question),
    person: readPerson(question),
  };
  if (words.length === 0) return { topic: "UNKNOWN", guide: null, confident: false, ...base };

  // "nasıl / nerede" soruları rehberlere yönelir
  const guideBonus = QUESTION_WORDS.some((q) => words.includes(q)) ? 2 : 0;

  let best: { topic: AssistantTopic; guide: GuideKey | null; value: number } = { topic: "UNKNOWN", guide: null, value: 0 };
  for (const guide of Object.values(GUIDES)) {
    const value = score(words, guide.keywords);
    if (value > 0 && value + guideBonus > best.value) best = { topic: "HOWTO", guide: guide.key, value: value + guideBonus };
  }
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const value = score(words, keywords);
    if (value > best.value) best = { topic: topic as AssistantTopic, guide: null, value };
  }

  if (best.value < 1) return { topic: "UNKNOWN", guide: null, confident: false, ...base };
  // Yalnızca tek bir kısa kelimeye dayanan eşleşme zayıftır; dil modeli varsa o karar verir.
  return { topic: best.topic, guide: best.guide, confident: best.value >= 3, ...base };
}

// ─────────────────────────────────────────────── Cevap biçimi

export type AnswerBlock =
  | { kind: "stats"; items: { label: string; value: string; sub?: string }[] }
  | { kind: "rows"; caption?: string; rows: { label: string; value: string; sub?: string; ratio?: number; href?: string }[]; emptyText?: string }
  | { kind: "steps"; steps: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "draft"; channel: CampaignChannel; body: string; hint: string }
  | { kind: "note"; tone: "info" | "caution"; text: string }
  | { kind: "links"; links: { href: string; label: string }[] };

export type AssistantAnswer = {
  topic: AssistantTopic;
  title: string;
  /** Tek cümlelik cevap; sayılar gerçek kayıtlardan gelir. */
  lead: string;
  /** "Son 30 gün · Tüm mekanlar" gibi kapsam satırı */
  scope: string | null;
  blocks: AnswerBlock[];
  followUps: string[];
};

// ─────────────────────────────────────────────── Arayüz metinleri

export const ASSISTANT_INTRO =
  "Verinizden gerçek sayılarla cevap veririm: girişler, müşteriler, etkinlikler, PR ve kampanyalar. Panelde bir işi nasıl yapacağınızı da anlatırım.";

/** Başlangıç önerileri — sohbet boşken ve anlaşılmayan soruda gösterilir. */
export const STARTER_QUESTIONS = [
  "Son 30 günde işler nasıl gidiyor?",
  "En yoğun gün ve saat hangisi?",
  "Kimlere mesaj atmalıyım?",
  "Etkinlikler nasıl gitti?",
  "Kaç kişiye mesaj atabilirim?",
  "Kampanya nasıl gönderilir?",
];

/** Sayfada gösterilen yetenek listesi — her satırın karşılığı gerçek bir cevap üreticisidir. */
export const ASSISTANT_SKILLS: { title: string; example: string }[] = [
  { title: "Dönem özeti", example: "Son 30 günde işler nasıl gidiyor?" },
  { title: "Yoğunluk", example: "En yoğun gün ve saat hangisi?" },
  { title: "Etkinlik performansı", example: "Etkinlikler nasıl gitti?" },
  { title: "PR katkısı", example: "Hangi PR daha çok kişi getirdi?" },
  { title: "Kitle önerisi", example: "Kimlere mesaj atmalıyım?" },
  { title: "İletişim izinleri", example: "Kaç kişiye mesaj atabilirim?" },
  { title: "Kampanya sonuçları", example: "Kampanyalar nasıl gitti?" },
  { title: "Mesaj taslağı", example: "Gelmeyenlere mesaj taslağı hazırla" },
  { title: "Panel rehberi", example: "Kampanya nasıl gönderilir?" },
];

export const ASSISTANT_LIMITS = [
  "Yalnızca görmeye yetkili olduğunuz işletme ve mekan verisini okur.",
  "Gönderim ve kayıt değişikliği sizin onayınızla olur; asistan kendiliğinden mesaj atmaz.",
  "Ölçülmeyen veriyi (menü görüntüleme, ciro, kampanya dönüşümü) tahmin etmez.",
];

/** Dil modeli bağlıyken ve bağlı değilken gösterilen sınır satırı. */
export function modelLimitLine(ready: boolean): string {
  return ready
    ? "Dil modeline yalnızca yazdığınız soru ve cevabın toplu sayıları gider; müşteri adı, telefonu ve e-postası gönderilmez. Modelin yazdığı cümlede panelin hesaplamadığı bir sayı varsa cümle kullanılmaz."
    : "Dil modeli bağlı değildir: tanımlı konuların dışındaki soruları anlamaz, anlamadığında bunu söyler.";
}

const BACK_VOWELS = "aıouAIOU";
const VOICELESS = "fstkçşhpFSTKÇŞHP";

/**
 * Özel ada bulunma eki: "Orbita" → "Orbita'da", "Peak" → "Peak'ta", "Nova Lounge" → "Nova Lounge'de".
 * Son ünlü kalınsa -da, inceyse -de; sözcük sert ünsüzle bitiyorsa -ta / -te.
 */
export function locativeOf(name: string): string {
  const trimmed = name.trim();
  const letters = [...trimmed].filter((c) => /\p{L}/u.test(c));
  const lastVowel = [...trimmed].reverse().find((c) => /[aeıioöuüAEIİOÖUÜ]/.test(c));
  const back = lastVowel ? BACK_VOWELS.includes(lastVowel) : false;
  const hard = letters.length > 0 && VOICELESS.includes(letters[letters.length - 1]);
  return `${trimmed}'${hard ? (back ? "ta" : "te") : back ? "da" : "de"}`;
}

const nf = new Intl.NumberFormat("tr-TR");
export const fmt = (n: number) => nf.format(n);
export const pct = (ratio: number) => `%${Math.round(ratio * 100)}`;
