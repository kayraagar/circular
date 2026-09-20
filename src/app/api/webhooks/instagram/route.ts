import type { NextRequest } from "next/server";
import { instagramConfig } from "@/modules/campaigns/instagram-api";
import { handleInstagramWebhook } from "@/modules/campaigns/instagram-service";
import { verifyWhatsAppSignature as verifyMetaSignature } from "@/modules/campaigns/webhook";

/** Meta Instagram webhook uç noktası (herkese açık; imza ile doğrulanır). */

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const { webhookVerifyToken } = instagramConfig();
  if (webhookVerifyToken && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === webhookVerifyToken) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const { appSecret } = instagramConfig();
  if (!appSecret) return new Response("Not configured", { status: 503 });
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) return new Response("Invalid signature", { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    await handleInstagramWebhook(payload);
  } catch (error) {
    console.error("[instagram-webhook] işlenemedi", error);
    return new Response("Error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
}
