import "server-only";

/**
 * Netgsm SMS REST v2 istemcisi — yalnızca fetch, ek kütüphane yok. Kimlik doğrulama: Basic (abone no + API alt kullanıcı şifresi).
 * Şifre loglanmaz ve hata mesajlarına eklenmez.
 */

const BASE_URL = "https://api.netgsm.com.tr";
const REQUEST_TIMEOUT_MS = 20_000;

export type NetgsmCredentials = { username: string; password: string };

const CODE_MESSAGES: Record<string, string> = {
  "20": "Mesaj metni hatalı veya azami uzunluğu aşıyor.",
  "30": "Netgsm kullanıcı adı veya API şifresi hatalı ya da hesapta API erişimi yok (IP kısıtı olabilir).",
  "40": "SMS başlığı Netgsm hesabında tanımlı değil.",
  "41": "SMS başlığı Netgsm hesabında geçerli değil.",
  "50": "Bu Netgsm hesabıyla İYS kontrollü gönderim yapılamıyor.",
  "51": "Netgsm hesabında İYS marka bilgisi bulunamadı. İYS'de Netgsm'i iş ortağı olarak yetkilendirin.",
  "60": "Aranan kayıt bulunamadı.",
  "70": "Netgsm isteği reddetti: parametre hatası.",
  "80": "Netgsm istek sınırı aşıldı; biraz sonra tekrar deneyin.",
  "85": "Aynı numaraya kısa sürede çok fazla gönderim yapıldı.",
  "100": "Netgsm sistem hatası; biraz sonra tekrar deneyin.",
  "101": "Netgsm sistem hatası; biraz sonra tekrar deneyin.",
  "110": "Netgsm sistem hatası; biraz sonra tekrar deneyin.",
};

export class NetgsmError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "NetgsmError";
  }
}

/** Hesap ayarlarından kaynaklanan (tekrar denemekle düzelmeyen) hatalar. */
export const NETGSM_CONFIG_ERRORS = new Set(["30", "40", "41", "50", "51"]);

async function call<T extends { code?: string; description?: string }>(
  path: string,
  creds: NetgsmCredentials,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new NetgsmError("Netgsm'e bağlanılamadı. Biraz sonra tekrar deneyin.", "NETWORK");
  }
  const payload = (await response.json().catch(() => ({}))) as T;
  const code = String(payload.code ?? (response.ok ? "00" : "5000"));
  if (code !== "00" || (!response.ok && response.status !== 406)) {
    throw new NetgsmError(CODE_MESSAGES[code] ?? `Netgsm isteği reddetti (kod ${code}).`, code);
  }
  return payload;
}

/** Hesapta onaylı SMS başlıkları (kimlik bilgilerini de doğrular). */
export async function listHeaders(creds: NetgsmCredentials): Promise<string[]> {
  const r = await call<{ code?: string; msgheader?: string[] | string; msgheaders?: string[] }>("/sms/rest/v2/msgheader", creds, { method: "GET" });
  const list = r.msgheaders ?? r.msgheader ?? [];
  return (Array.isArray(list) ? list : [list]).map(String).filter(Boolean);
}

/** Türkiye numarası "+905321234567" → Netgsm biçimi "5321234567". */
export function toNetgsmNumber(e164: string): string {
  return e164.replace(/^\+90/, "");
}

/**
 * Toplu gönderim (her numaraya kendi metni). iysfilter: "11" = bireysel alıcıya ticari ileti (Netgsm İYS onayını kontrol eder),
 * "0" = ticari olmayan / ekip içi test.
 */
export async function sendSms(
  creds: NetgsmCredentials,
  input: { msgheader: string; messages: { msg: string; no: string }[]; iysfilter: "11" | "0" },
): Promise<{ jobid: string }> {
  const r = await call<{ code?: string; jobid?: string }>("/sms/rest/v2/send", creds, {
    method: "POST",
    body: { msgheader: input.msgheader, encoding: "TR", iysfilter: input.iysfilter, appname: "Circular", messages: input.messages },
  });
  if (!r.jobid) throw new NetgsmError("Netgsm gönderim kimliği vermedi.", "NO_JOBID");
  return { jobid: String(r.jobid) };
}

export type NetgsmReportJob = { jobid: string; number: string; status: number; errorCode?: number; deliveredDate?: string };

/** Gönderim raporu (dakikada en fazla 10 sorgu). */
export async function smsReport(creds: NetgsmCredentials, jobids: string[]): Promise<NetgsmReportJob[]> {
  try {
    const r = await call<{ code?: string; jobs?: NetgsmReportJob[] }>("/sms/rest/v2/report", creds, {
      method: "POST",
      body: { jobids, appname: "Circular", pagenumber: 0, pagesize: 1000 },
    });
    return (r.jobs ?? []).map((j) => ({ ...j, jobid: String(j.jobid), number: String(j.number), status: Number(j.status) }));
  } catch (error) {
    if (error instanceof NetgsmError && error.code === "60") return [];
    throw error;
  }
}
