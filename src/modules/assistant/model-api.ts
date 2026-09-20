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

type ChatMessage = { role: "system" | "user"; content: string };

async function chat(messages: ChatMessage[], opts: { schema?: object; maxTokens: number }): Promise<string | null> {
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
        temperature: 0,
        max_completion_tokens: opts.maxTokens,
        ...(opts.schema
          ? { response_format: { type: "json_schema", json_schema: { name: "asistan_niyet", strict: true, schema: opts.schema } } }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("[assistant] model hatası", response.status, (await response.text()).slice(0, 300));
      return null;
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    if ((error as Error).name !== "AbortError") console.error("[assistant] modele ulaşılamadı", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
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
- HOWTO: panelde bir işin nasıl yapılacağı soruluyor. Bu durumda guide alanını doldur.
- CAPABILITIES: asistanın ne yapabildiği soruluyor.
- UNKNOWN: yukarıdakilerin hiçbiri değil veya panel verisiyle ilgisiz.

Kurallar:
- periodDays: soruda "bu hafta/7 gün" geçiyorsa 7, "3 ay/90 gün/çeyrek" geçiyorsa 90, aksi halde 30.
- segment: yalnızca soruda böyle bir kitle geçiyorsa doldur, yoksa "".
- channel: soruda WhatsApp/SMS/e-posta geçiyorsa doldur, yoksa "".
- person: yalnızca CUSTOMER'da, soruda geçen kişi adını veya numarayı yaz; yoksa "".
- Emin değilsen UNKNOWN döndür. Asla tahmin ederek konu uydurma.`;

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Soruyu modele sınıflandırtır. Model yoksa/başarısızsa null döner (çağıran anahtar kelime moduna düşer). */
export async function classifyQuestion(question: string): Promise<ModelIntent | null> {
  const content = await chat(
    [
      { role: "system", content: INTENT_SYSTEM },
      { role: "user", content: question },
    ],
    { schema: INTENT_SCHEMA, maxTokens: 200 },
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

const PHRASE_SYSTEM = `Sen bir CRM panelinin asistanısın. Sana bir işletme sahibinin sorusu ve panelin hesapladığı kesin sayılar veriliyor.
Görevin: bu sayıları kullanarak Türkçe, en fazla iki kısa cümlelik bir cevap yazmak.

Kurallar:
- SADECE sana verilen sayıları kullan. Yeni sayı, oran veya tahmin üretme.
- Elinde olmayan bir şey sorulduysa sayı uydurma.
- Abartılı pazarlama dili kullanma; sakin ve net yaz.
- Tavsiye verme, yorum ekleme; sorulanı cevapla.
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
    { maxTokens: 220 },
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
