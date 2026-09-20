import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeByToken } from "@/modules/campaigns/unsubscribe";

/**
 * Tek tıkla abonelikten çıkma (RFC 8058 "List-Unsubscribe-Post"). E-posta istemcisi bu adrese POST atar.
 * Tarayıcıdan açılırsa onay sayfasına yönlendirir.
 */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/abonelik/[token]">) {
  const { token } = await ctx.params;
  const result = await unsubscribeByToken(token);
  return new Response(result.ok ? "OK" : "Not found", { status: result.ok ? 200 : 404 });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/abonelik/[token]">) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/abonelik/${encodeURIComponent(token)}`, request.url));
}
