import "server-only";
import { ASSISTANT_TOPICS, GUIDE_KEYS, type AssistantTopic, type GuideKey } from "./rules";
import { CAMPAIGN_CHANNELS, SEGMENT_KEYS, type CampaignChannel, type SegmentKey } from "@/modules/campaigns/rules";

/**
 * Dil modeli bağlantısı (Groq — OpenAI uyumlu uç nokta, harici kütüphane yok).
 *
 * Modele YALNIZCA şunlar gider:
 *  1. Kullanıcının yazdığı soru cümlesi (niyet çıkarımı için),
 *  2. Hazır cevabın toplu sayıları (cümleyi akıcı yazması için).
 * Müşteri adı, telefonu, e-postası veya herhangi bir kayıt listesi modele GÖNDERİLMEZ.
 * Model erişilemezse veya geçersiz cevap verirse asistan anahtar kelime moduna döner;
 * sayıları her zaman panel hesaplar.
 */

export function modelConfig() {
  const env = process.env;
  return {
    apiKey: env.GROQ_API_KEY?.trim() || null,
    model: env.ASSISTANT_MODEL?.trim() || "openai/gpt-oss-120b",
    baseUrl: (env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/+$/, ""),
    timeoutMs: Number(env.ASSISTANT_MODEL_TIMEOUT_MS) || 8000,
    /** Cevap cümlesini de modelin yazması (sayılar doğrulanır) */
    phrasing: env.ASSISTANT_MODEL_PHRASING !== "false",
  };
}

export function modelReady(): boolean {
  return modelConfig().apiKey !== null;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * gpt-oss gibi akıl yürüten modeller cevaptan önce "düşünme" tokenı üretir ve bunlar
 * max_completion_tokens bütçesinden sayılır. Bütçe düşük olursa model geçerli JSON'a
 * başlayamadan kesilir (Groq: json_validate_failed). Bu yüzden bütçe geniş,
 * düşünme derinliği düşük tutulur.
 */
type ModelMessage = { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] };

/** 429'da sağlayıcının önerdiği bekleme süresi (ms), makul bir üst sınırla. */
function retryDelayMs(response: Response, body: string): number {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 5000);
  const match = /try again in ([\d.]+)s/i.exec(body);
  const seconds = match ? Number(match[1]) : NaN;
  return Math.min(Number.isFinite(seconds) ? seconds * 1000 + 250 : 1500, 5000);
}

async function chatRaw(
  messages: ChatMessage[],
  opts: { schema?: object; maxTokens: number; tools?: object[] },
  retry = true,
): Promise<ModelMessage | null> {
  const config = modelConfig();
  if (!config.apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: opts.schema ? 0 : 0.6,
        max_completion_tokens: opts.maxTokens,
        reasoning_effort: "low",
        ...(opts.schema
          ? { response_format: { type: "json_schema", json_schema: { name: "asistan_niyet", strict: true, schema: opts.schema } } }
          : {}),
        ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      // Ücretsiz katmanın dakikalık token sınırı: kısa bir bekleyişten sonra bir kez daha denenir.
      if (response.status === 429 && retry) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, body)));
        return chatRaw(messages, opts, false);
      }
      console.error("[assistant] model hatası", response.status, body.slice(0, 300));
      return null;
    }
    const data = (await response.json()) as { choices?: { message?: ModelMessage }[] };
    return data.choices?.[0]?.message ?? null;
  } catch (error) {
    if ((error as Error).name !== "AbortError") console.error("[assistant] modele ulaşılamadı", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages: ChatMessage[], opts: { schema?: object; maxTokens: number }): Promise<string | null> {
  const message = await chatRaw(messages, opts);
  return message?.content?.trim() || null;
}

// ─────────────────────────────────────────────── Niyet çıkarımı

export type ModelIntent = {
  topic: AssistantTopic;
  guide: GuideKey | null;
  periodDays: 7 | 30 | 90;
  segment: SegmentKey | null;
  channel: CampaignChannel | null;
  /** Soruda geçen kişi adı veya numara parçası (müşteri arama için) */
  person: string | null;
};

const TOPIC_VALUES = ASSISTANT_TOPICS.filter((t) => t !== "HOWTO");

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "guide", "periodDays", "segment", "channel", "person"],
  properties: {
    topic: { type: "string", enum: [...TOPIC_VALUES, "HOWTO"] },
    guide: { type: "string", enum: ["", ...GUIDE_KEYS] },
    periodDays: { type: "integer", enum: [7, 30, 90] },
    segment: { type: "string", enum: ["", ...SEGMENT_KEYS] },
    channel: { type: "string", enum: ["", ...CAMPAIGN_CHANNELS] },
    person: { type: "string" },
  },
} as const;

const INTENT_SYSTEM = `Sen bir restoran/gece kulübü CRM panelinin soru sınıflandırıcısısın. Kullanıcının Türkçe sorusunu okuyup yalnızca etiketleyeceksin. Cevap yazmayacaksın, veri uydurmayacaksın.

Konular:
- SUMMARY: genel gidişat, dönem özeti.
- VISITS: kapıdan kaç kişi girdi, ziyaret sayısı.
- PEAK_TIME: en yoğun saat veya gün.
- NEW_CUSTOMERS: yeni müşteri sayısı, müşterilerin nereden geldiği.
- EVENTS: etkinliklerin/gecelerin performansı.
- PROMOTERS: PR'ların getirdiği misafirler.
- AUDIENCE: kime mesaj atılmalı, hangi kitle seçilmeli.
- CONSENTS: iletişim izinleri, kaç kişiye mesaj atılabilir.
- CAMPAIGN_RESULTS: gönderilmiş kampanyaların sonuçları.
- DRAFT: mesaj/kampanya metni taslağı isteniyor.
- PERKS: avantaj/ikram kullanımı.
- CHANNELS: WhatsApp/SMS/e-posta/Instagram bağlantı durumu.
- CUSTOMER: belirli bir kişi soruluyor ("Ali en son ne zaman geldi", "bu numara kayıtlı mı").
- UNMEASURED: ciro, satış tutarı, adisyon, kâr, kişi başı harcama, menü görüntüleme sayısı veya kampanya satış dönüşümü soruluyor. Bu veriler panelde ölçülmez.
- CHAT: panel verisiyle ilgisi olmayan gündelik sohbet, selamlaşma, teşekkür, genel bilgi sorusu veya fikir sorma.
- ACTION: kullanıcı bir işin YAPILMASINI istiyor. Emir kipi belirtisidir: "ekle", "oluştur", "kaydet", "gönder", "işaretle".
  Örnekler: "Ayşe'yi müşteri olarak ekle", "Ada'ya vip etiketi ekle", "Ada'nın SMS iznini kaydet",
  "cumartesi için etkinlik oluştur", "Cuma Gecesi'ne Mert'i ekle", "gelmeyenlere SMS at".
- HOWTO: panelde bir işin NASIL yapılacağı soruluyor ("nasıl eklerim", "nereden oluşturulur"). Bu durumda guide alanını doldur.
  Kullanıcı işi kendisi yapmak için yol soruyorsa HOWTO, işi senin yapmanı istiyorsa ACTION.
- CAPABILITIES: asistanın ne yapabildiği soruluyor.
- UNKNOWN: soru anlaşılmıyor veya boş. Sohbet niteliğindeyse UNKNOWN değil CHAT kullan.

Kurallar:
- periodDays: soruda "bu hafta/7 gün" geçiyorsa 7, "3 ay/90 gün/çeyrek" geçiyorsa 90, aksi halde 30.
- segment: yalnızca soruda böyle bir kitle geçiyorsa doldur, yoksa "".
- channel: soruda WhatsApp/SMS/e-posta geçiyorsa doldur, yoksa "".
- person: yalnızca CUSTOMER'da, soruda geçen kişi adını veya numarayı yaz; yoksa "".
- Emin değilsen UNKNOWN döndür. Asla tahmin ederek konu uydurma.`;

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export type HistoryTurn = { role: "user" | "assistant"; content: string };

/** Soruyu modele sınıflandırtır. Model yoksa/başarısızsa null döner (çağıran anahtar kelime moduna düşer). */
export async function classifyQuestion(question: string, history: HistoryTurn[] = []): Promise<ModelIntent | null> {
  const content = await chat(
    [
      { role: "system", content: INTENT_SYSTEM },
      ...history,
      { role: "user", content: question },
    ],
    { schema: INTENT_SCHEMA, maxTokens: 1024 },
  );
  if (!content) return null;
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    const topic = pick(raw.topic, ASSISTANT_TOPICS);
    if (!topic) return null;
    const days = Number(raw.periodDays);
    return {
      topic,
      guide: pick(raw.guide, GUIDE_KEYS),
      periodDays: days === 7 || days === 90 ? days : 30,
      segment: pick(raw.segment, SEGMENT_KEYS),
      channel: pick(raw.channel, CAMPAIGN_CHANNELS),
      person: typeof raw.person === "string" && raw.person.trim() !== "" ? raw.person.trim().slice(0, 60) : null,
    };
  } catch {
    console.error("[assistant] model geçersiz JSON döndürdü");
    return null;
  }
}

// ─────────────────────────────────────────────── Cevap cümlesi

/** "1.234" ve "1234" aynı sayıdır; karşılaştırma için sadeleştirilir. */
function numberForms(text: string): string[] {
  return (text.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,]/g, "").replace(/^0+(?=\d)/, ""));
}

/**
 * Modelin cümlesinde, kendisine verilmeyen bir sayı varsa cümle reddedilir.
 * Böylece model "geçen aya göre iki katı" gibi uydurma bir rakam üretemez.
 */
export function usesOnlyGivenNumbers(text: string, given: string): boolean {
  const allowed = new Set(numberForms(given));
  return numberForms(text).every((n) => allowed.has(n));
}

const CHAT_SYSTEM = `Sen Circular adlı bir restoran/kafe/gece kulübü CRM panelinin asistanısın. Karşındaki kişi işletme sahibi veya pazarlama yöneticisi.

Gündelik sohbet edebilirsin: selamlaşma, hâl hatır, genel sorular, fikir alışverişi. Kısa ve doğal konuş.

Kurallar:
- İşletmenin verisi elinde YOK. Müşteri sayısı, giriş, ciro gibi bir şey sorulursa sayı uydurma; panelden bakabileceğini söyle ve nasıl soracağını örnekle ("son 30 günde kaç kişi geldi?" gibi).
- Hukuki, mali veya tıbbi tavsiye verme.
- En fazla üç kısa cümle. Madde işareti, başlık ve emoji kullanma.
- Türkçe yaz ve kullanıcıya siz diye hitap et.`;

/** Gündelik sohbet cevabı. Panel verisi gönderilmez; model de veri uydurmamakla yükümlüdür. */
export async function chatReply(question: string, history: HistoryTurn[] = []): Promise<string | null> {
  const content = await chat(
    [
      { role: "system", content: CHAT_SYSTEM },
      ...history,
      { role: "user", content: question },
    ],
    { maxTokens: 700 },
  );
  if (!content) return null;
  const text = content.replace(/\n{3,}/g, "\n\n").trim();
  return text.length >= 2 && text.length <= 1200 ? text : null;
}

const PHRASE_SYSTEM = `Sen bir CRM panelinin asistanısın. Sana bir işletme sahibinin sorusu ve panelin hesapladığı kesin sayılar veriliyor.
Görevin: bu sayıları kullanarak Türkçe, en fazla iki kısa cümlelik bir cevap yazmak.

Kurallar:
- SADECE sana verilen sayıları kullan. Yeni sayı, oran veya tahmin üretme.
- Elinde olmayan bir şey sorulduysa sayı uydurma.
- Abartılı pazarlama dili kullanma; sakin ve net yaz.
- Tavsiye verme, yorum ekleme; sorulanı cevapla.
- Bu bir OKUMA cevabıdır: hiçbir şey yapılmadı. "Kaydedildi", "gönderildi", "eklendi", "oluşturuldu" gibi
  bir işlem yapıldığı izlenimi veren ifadeler KULLANMA; yalnızca mevcut durumu anlat.
- Madde işareti, başlık veya emoji kullanma.`;

/**
 * Hazır cevabın giriş cümlesini modele yazdırır. Yalnızca toplu sayılar gönderilir;
 * kişi adı veya iletişim bilgisi içeren konularda çağrılmaz.
 */
export async function phraseLead(input: { question: string; facts: string }): Promise<string | null> {
  const config = modelConfig();
  if (!config.phrasing || !config.apiKey) return null;
  const content = await chat(
    [
      { role: "system", content: PHRASE_SYSTEM },
      { role: "user", content: `Soru: ${input.question}\n\nPanelin hesapladığı veriler:\n${input.facts}` },
    ],
    { maxTokens: 512 },
  );
  if (!content) return null;
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > 400) return null;
  if (!usesOnlyGivenNumbers(text, input.facts)) {
    console.warn("[assistant] model verilmeyen sayı kullandı, hazır cümle korundu");
    return null;
  }
  return text;
}

// ─────────────────────────────────────────────── İşlem planlama (araç çağrısı)

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ActionPlan = { kind: "tool"; name: string; args: Record<string, unknown> } | { kind: "ask"; text: string };

const ACTION_SYSTEM = (today: string) => `Sen Circular adlı restoran/gece kulübü CRM panelinin asistanısın ve panelde işlem yapabilirsin.
Bugünün tarihi: ${today} (Europe/Istanbul).

Kullanıcı bir işin YAPILMASINI istiyorsa uygun aracı çağır.

Kurallar:
- Eksik bilgi varsa aracı ÇAĞIRMA; tek cümleyle eksik bilgiyi sor. Değer uydurma.
- Telefon, ad, tarih gibi bilgileri kullanıcının yazdığından al; tahmin etme.
- Tarihleri "YYYY-MM-DDTHH:mm" biçiminde ve bugünün tarihine göre hesapla.
- İletişim izni kaydederken iznin nasıl alındığı yazılmamışsa aracı çağırma, bunu sor.
- Kullanıcı yalnızca bilgi soruyorsa (kaç kişi geldi, nasıl yapılır) araç çağırma; kısaca bunu panelin gösterebileceğini söyle.
- ONAY SORMA. Gerekli bilgiler tamsa aracı doğrudan çağır; gönderim onayını panel ayrıca kullanıcıdan alır.
- Özet çıkarma, plan anlatma, "ister misiniz" diye sorma; ya aracı çağır ya da eksik bilgiyi sor.`;

/** Kullanıcının isteğini bir araç çağrısına çevirir. Eksik bilgi varsa soru döner. */
export async function planAction(question: string, history: HistoryTurn[], tools: ToolSpec[], today: string): Promise<ActionPlan | null> {
  const message = await chatRaw(
    [
      { role: "system", content: ACTION_SYSTEM(today) },
      ...history,
      { role: "user", content: question },
    ],
    {
      maxTokens: 1024,
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
    },
  );
  if (!message) return null;

  const call = message.tool_calls?.[0]?.function;
  if (call?.name) {
    try {
      const args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      return { kind: "tool", name: call.name, args };
    } catch {
      console.error("[assistant] araç argümanları okunamadı");
      return null;
    }
  }
  const text = message.content?.replace(/\s+/g, " ").trim();
  return text && text.length >= 2 ? { kind: "ask", text: text.slice(0, 400) } : null;
}
