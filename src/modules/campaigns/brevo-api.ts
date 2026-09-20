import "server-only";

/**
 * Brevo işlemsel e-posta istemcisi — yalnızca fetch. Circular'ın tek Brevo hesabı kullanılır;
 * gönderim Circular'ın doğrulanmış alan adındaki adresten, işletmenin görünen adıyla yapılır.
 */

const API_URL = "https://api.brevo.com/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 20_000;

export function brevoConfig() {
  const env = process.env;
  return {
    apiKey: env.BREVO_API_KEY?.trim() || null,
    /** Circular'ın Brevo'da doğrulanmış alan adındaki gönderici adresi (ör. kampanya@mail.circular.app) */
    senderEmail: env.BREVO_SENDER_EMAIL?.trim().toLowerCase() || null,
    webhookToken: env.BREVO_WEBHOOK_TOKEN?.trim() || null,
  };
}

export function brevoReady(): boolean {
  const c = brevoConfig();
  return Boolean(c.apiKey && c.senderEmail);
}

export class BrevoError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "BrevoError";
  }
}

/** Kimlik/gönderici ayarından kaynaklanan, tekrar denemekle düzelmeyen hatalar. */
export function isBrevoConfigError(e: BrevoError) {
  return e.status === 401 || e.status === 403 || e.code === "unauthorized" || e.code === "permission_denied";
}

export async function sendEmail(input: {
  to: { email: string; name?: string };
  sender: { name: string; email: string };
  replyTo?: string | null;
  subject: string;
  htmlContent: string;
  headers?: Record<string, string>;
  tags?: string[];
}): Promise<{ messageId: string }> {
  const { apiKey } = brevoConfig();
  if (!apiKey) throw new BrevoError("Brevo yapılandırılmamış.", "NOT_CONFIGURED", 0);
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: input.sender,
        to: [input.to],
        ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
        subject: input.subject,
        htmlContent: input.htmlContent,
        headers: input.headers,
        tags: input.tags,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new BrevoError("Brevo'ya bağlanılamadı. Biraz sonra tekrar deneyin.", "NETWORK", 0);
  }
  const payload = (await response.json().catch(() => ({}))) as { messageId?: string; code?: string; message?: string };
  if (!response.ok) {
    throw new BrevoError((payload.message ?? "Brevo e-postayı kabul etmedi.").slice(0, 300), payload.code ?? String(response.status), response.status);
  }
  if (!payload.messageId) throw new BrevoError("Brevo mesaj kimliği vermedi.", "NO_MESSAGE_ID", response.status);
  return { messageId: payload.messageId };
}
