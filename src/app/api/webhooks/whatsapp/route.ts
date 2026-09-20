import type { NextRequest } from "next/server";
import { metaConfig } from "@/modules/campaigns/config";
import { handleWhatsAppWebhook, verifyWhatsAppSignature } from "@/modules/campaigns/webhook";

/**
 * Meta WhatsApp webhook uç noktası (herkese açık; kimlik doğrulaması imza ile yapılır).
 * GET: Meta'nın abonelik doğrulaması · POST: imzalı bildirimler.
 */

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const { webhookVerifyToken } = metaConfig();
  if (webhookVerifyToken && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === webhookVerifyToken) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const { appSecret } = metaConfig();
  if (!appSecret) return new Response("Not configured", { status: 503 });

  const raw = await request.text();
  if (!verifyWhatsAppSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    await handleWhatsAppWebhook(payload);
  } catch (error) {
    // 5xx: Meta bildirimi daha sonra tekrar gönderir; işlemler tekrar edilebilir (idempotent).
    console.error("[whatsapp-webhook] işlenemedi", error);
    return new Response("Error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
}
