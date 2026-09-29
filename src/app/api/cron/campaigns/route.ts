import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { runCampaignWorker } from "@/modules/campaigns/worker";

/**
 * Kampanya gönderim işçisi (herkese açık adres, gizli anahtarla korunur).
 *
 * Zamanlayıcı bu adresi periyodik çağırır (bkz. `vercel.json`). Vercel Cron isteği
 * `Authorization: Bearer $CRON_SECRET` başlığıyla gönderir; elle tetiklemek için
 * `?token=<CRON_SECRET>` de kabul edilir.
 *
 * Anahtar tanımlı değilse uç nokta kapalıdır (503): açık bırakılırsa herkes gönderim
 * tetikleyebilirdi.
 */

function authorized(request: NextRequest, expected: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : (request.nextUrl.searchParams.get("token") ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return new Response("Not configured", { status: 503 });
  if (!authorized(request, secret)) return new Response("Unauthorized", { status: 401 });

  try {
    const report = await runCampaignWorker();
    return Response.json({ ok: true, ...report });
  } catch (error) {
    console.error("[cron/campaigns] işçi hatası", error);
    return new Response("Error", { status: 500 });
  }
}
