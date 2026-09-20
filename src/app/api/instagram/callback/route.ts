import { NextResponse, type NextRequest } from "next/server";
import { getAppContext } from "@/lib/context";
import { AppError } from "@/lib/errors";
import { completeInstagramOAuth } from "@/modules/campaigns/instagram-service";

/** Instagram yetkilendirmesinden dönüş: bağlantıyı tamamlar ve Instagram ekranına yönlendirir. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (query: string) => NextResponse.redirect(new URL(`/campaigns/instagram?${query}`, request.url));
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));
  if (params.get("error")) return back("hata=iptal");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back("hata=eksik");
  try {
    await completeInstagramOAuth(ctx.service, { code, state });
    return back("durum=baglandi");
  } catch (error) {
    if (!(error instanceof AppError)) console.error("[instagram] bağlantı tamamlanamadı", error);
    return back(`hata=${encodeURIComponent(error instanceof AppError ? error.message : "Bağlantı tamamlanamadı.")}`);
  }
}
