import "server-only";
import { metaConfig } from "./config";

/**
 * WhatsApp Business Platform (Cloud API) istemcisi — yalnızca fetch, ek kütüphane yok.
 * Her çağrı işletmenin kendi token'ıyla yapılır; token loglanmaz ve hata mesajlarına eklenmez.
 */

export class GraphError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

type GraphErrorBody = { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string; error_data?: { details?: string } } };

const REQUEST_TIMEOUT_MS = 15_000;

async function graph<T>(path: string, init: { method?: "GET" | "POST"; token?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const { graphVersion } = metaConfig();
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GraphError("Meta'ya bağlanılamadı. Biraz sonra tekrar deneyin.", "NETWORK", 0);
  }

  const payload = (await response.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!response.ok || payload.error) {
    const e = payload.error ?? {};
    const detail = e.error_user_msg || e.error_data?.details || e.message || "Meta isteği reddetti.";
    throw new GraphError(detail.slice(0, 300), String(e.code ?? response.status), response.status);
  }
  return payload;
}

// ─────────────────────────────────────────────── Bağlantı

export type PhoneNumberInfo = { displayPhoneNumber: string; verifiedName: string | null; qualityRating: string | null };

export async function getPhoneNumber(phoneNumberId: string, token: string): Promise<PhoneNumberInfo> {
  const r = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(encodeURIComponent(phoneNumberId), {
    token,
    query: { fields: "display_phone_number,verified_name,quality_rating" },
  });
  if (!r.display_phone_number) throw new GraphError("Numara bilgisi alınamadı.", "NO_PHONE", 200);
  return { displayPhoneNumber: r.display_phone_number, verifiedName: r.verified_name ?? null, qualityRating: r.quality_rating ?? null };
}

/** Embedded Signup'tan dönen kısa ömürlü kodu işletme token'ına çevirir (kod ~30 sn geçerlidir). */
export async function exchangeSignupCode(code: string): Promise<string> {
  const { appId, appSecret } = metaConfig();
  if (!appId || !appSecret) throw new GraphError("Meta uygulaması yapılandırılmamış.", "NOT_CONFIGURED", 0);
  const r = await graph<{ access_token?: string }>("oauth/access_token", { query: { client_id: appId, client_secret: appSecret, code } });
  if (!r.access_token) throw new GraphError("Meta token vermedi.", "NO_TOKEN", 200);
  return r.access_token;
}

/** Uygulamayı işletmenin WhatsApp hesabının bildirimlerine (webhook) abone eder. */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  await graph(`${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "POST", token });
}

/** Numarayı Cloud API'ye kaydeder; PIN iki adımlı doğrulama PIN'i olur. */
export async function registerPhoneNumber(phoneNumberId: string, token: string, pin: string): Promise<void> {
  await graph(`${encodeURIComponent(phoneNumberId)}/register`, { method: "POST", token, body: { messaging_product: "whatsapp", pin } });
}

// ─────────────────────────────────────────────── Şablonlar

export type TemplateDraft = {
  name: string;
  language: string;
  headerText: string | null;
  bodyText: string;
  footerText: string;
  optOutLabel: string;
  usesName: boolean;
  sampleName: string;
};

export async function createMarketingTemplate(wabaId: string, token: string, t: TemplateDraft): Promise<{ id: string; status: string }> {
  const components: unknown[] = [];
  if (t.headerText) components.push({ type: "HEADER", format: "TEXT", text: t.headerText });
  components.push({
    type: "BODY",
    text: t.bodyText,
    ...(t.usesName ? { example: { body_text_named_params: [{ param_name: "ad", example: t.sampleName }] } } : {}),
  });
  components.push({ type: "FOOTER", text: t.footerText });
  components.push({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: t.optOutLabel }] });

  const r = await graph<{ id?: string; status?: string }>(`${encodeURIComponent(wabaId)}/message_templates`, {
    method: "POST",
    token,
    body: { name: t.name, language: t.language, category: "MARKETING", parameter_format: "named", components },
  });
  if (!r.id) throw new GraphError("Meta şablon kimliği vermedi.", "NO_TEMPLATE_ID", 200);
  return { id: r.id, status: (r.status ?? "PENDING").toUpperCase() };
}

export async function getTemplateStatus(templateId: string, token: string): Promise<{ status: string; rejectedReason: string | null }> {
  const r = await graph<{ status?: string; rejected_reason?: string }>(encodeURIComponent(templateId), {
    token,
    query: { fields: "status,rejected_reason" },
  });
  const reason = r.rejected_reason && r.rejected_reason !== "NONE" ? r.rejected_reason : null;
  return { status: (r.status ?? "PENDING").toUpperCase(), rejectedReason: reason };
}

// ─────────────────────────────────────────────── Gönderim

export async function sendTemplateMessage(input: {
  phoneNumberId: string;
  token: string;
  to: string; // E.164
  templateName: string;
  language: string;
  firstName: string | null; // şablon {{ad}} kullanıyorsa
  optOutPayload: string;
}): Promise<{ wamid: string }> {
  const components: unknown[] = [];
  if (input.firstName !== null) {
    components.push({ type: "body", parameters: [{ type: "text", parameter_name: "ad", text: input.firstName }] });
  }
  components.push({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: input.optOutPayload }] });

  const r = await graph<{ messages?: { id?: string }[] }>(`${encodeURIComponent(input.phoneNumberId)}/messages`, {
    method: "POST",
    token: input.token,
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "template",
      template: { name: input.templateName, language: { code: input.language }, components },
    },
  });
  const wamid = r.messages?.[0]?.id;
  if (!wamid) throw new GraphError("Meta mesaj kimliği vermedi.", "NO_MESSAGE_ID", 200);
  return { wamid };
}
