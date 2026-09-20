import "server-only";
import { DEFAULT_GRAPH_VERSION } from "./config";

/**
 * Instagram API (Instagram girişi ile) istemcisi — yalnızca fetch.
 * Instagram'da toplu gönderim yoktur; yalnızca kişinin yazdığı mesaja 24 saat içinde yanıt verilebilir.
 */

export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];
const REQUEST_TIMEOUT_MS = 15_000;

export function instagramConfig() {
  const env = process.env;
  const base = (env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return {
    appId: env.INSTAGRAM_APP_ID?.trim() || null,
    appSecret: env.INSTAGRAM_APP_SECRET?.trim() || null,
    webhookVerifyToken: env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() || null,
    graphVersion: env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION,
    redirectUri: `${base}/api/instagram/callback`,
    webhookUrl: `${base}/api/webhooks/instagram`,
    manualConnect: env.INSTAGRAM_MANUAL_CONNECT === "true",
  };
}

export class InstagramError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}

async function request<T>(url: URL | string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new InstagramError("Instagram'a bağlanılamadı. Biraz sonra tekrar deneyin.", "NETWORK", 0);
  }
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } | string; error_message?: string };
  if (!response.ok || payload.error) {
    const e = payload.error;
    const message = typeof e === "string" ? e : (e?.message ?? payload.error_message ?? "Instagram isteği reddetti.");
    throw new InstagramError(String(message).slice(0, 300), String(typeof e === "object" && e?.code ? e.code : response.status), response.status);
  }
  return payload;
}

const graph = (path: string) => `https://graph.instagram.com/${instagramConfig().graphVersion}/${path.replace(/^\/+/, "")}`;

export function authorizeUrl(state: string): string {
  const c = instagramConfig();
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", c.appId ?? "");
  url.searchParams.set("redirect_uri", c.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

/** Yetkilendirme kodunu kısa ömürlü token'a çevirir. Kodun sonundaki "#_" koda dahil değildir. */
export async function exchangeCode(code: string): Promise<{ accessToken: string; userId: string }> {
  const c = instagramConfig();
  if (!c.appId || !c.appSecret) throw new InstagramError("Instagram uygulaması yapılandırılmamış.", "NOT_CONFIGURED", 0);
  const body = new URLSearchParams({
    client_id: c.appId,
    client_secret: c.appSecret,
    grant_type: "authorization_code",
    redirect_uri: c.redirectUri,
    code: code.replace(/#_$/, ""),
  });
  const r = await request<{ access_token?: string; user_id?: string | number; data?: { access_token?: string; user_id?: string | number }[] }>(
    "https://api.instagram.com/oauth/access_token",
    { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  const row = r.data?.[0] ?? r;
  if (!row.access_token) throw new InstagramError("Instagram token vermedi.", "NO_TOKEN", 200);
  return { accessToken: row.access_token, userId: String(row.user_id ?? "") };
}

/** Kısa ömürlü token → 60 günlük token. */
export async function exchangeLongLived(shortToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const { appSecret } = instagramConfig();
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret ?? "");
  url.searchParams.set("access_token", shortToken);
  const r = await request<{ access_token?: string; expires_in?: number }>(url);
  if (!r.access_token) throw new InstagramError("Instagram uzun süreli token vermedi.", "NO_TOKEN", 200);
  return { accessToken: r.access_token, expiresIn: Number(r.expires_in ?? 0) };
}

export async function refreshLongLived(token: string): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const r = await request<{ access_token?: string; expires_in?: number }>(url);
  if (!r.access_token) throw new InstagramError("Instagram token yenilenemedi.", "NO_TOKEN", 200);
  return { accessToken: r.access_token, expiresIn: Number(r.expires_in ?? 0) };
}

/** Profesyonel hesabın kimliği (webhook'larda gelen kimlik) ve kullanıcı adı. */
export async function getMe(token: string): Promise<{ igUserId: string; username: string }> {
  const r = await request<{ user_id?: string | number; id?: string; username?: string }>(`${graph("me")}?fields=user_id,username`, { token });
  const igUserId = String(r.user_id ?? "");
  if (!igUserId || !r.username) throw new InstagramError("Instagram hesap bilgisi alınamadı.", "NO_ACCOUNT", 200);
  return { igUserId, username: r.username };
}

/** Uygulamayı hesabın DM bildirimlerine abone eder. */
export async function subscribeMessages(token: string): Promise<void> {
  await request(`${graph("me/subscribed_apps")}?subscribed_fields=messages`, { method: "POST", token });
}

/** Kişinin mesajına metinle yanıt (en fazla 1000 bayt). */
export async function sendDirectMessage(token: string, igUserId: string, recipientId: string, text: string): Promise<{ messageId: string }> {
  const r = await request<{ message_id?: string }>(graph(`${encodeURIComponent(igUserId)}/messages`), {
    method: "POST",
    token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  return { messageId: r.message_id ?? "" };
}
