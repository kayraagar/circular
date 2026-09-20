import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { brevoConfig } from "@/modules/campaigns/brevo-api";
import { handleBrevoWebhook } from "@/modules/campaigns/email-service";

/**
 * Brevo e-posta bildirimleri (herkese açık). Brevo bildirimleri imzalamadığı için gizli bir anahtar istenir:
 * "Authorization: Bearer <BREVO_WEBHOOK_TOKEN>" başlığı veya "?token=<BREVO_WEBHOOK_TOKEN>".
 */

function authorized(request: NextRequest, expected: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : (request.nextUrl.searchParams.get("token") ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const { webhookToken } = brevoConfig();
  if (!webhookToken) return new Response("Not configured", { status: 503 });
  if (!authorized(request, webhookToken)) return new Response("Unauthorized", { status: 401 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    await handleBrevoWebhook(payload);
  } catch (error) {
    console.error("[brevo-webhook] işlenemedi", error);
    return new Response("Error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
}
