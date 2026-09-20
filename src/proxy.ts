import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * İyimser yönlendirme: cookie yoksa girişe gönderir.
 * Bu bir yetki kontrolü DEĞİLDİR — asıl oturum, tenant ve rol doğrulaması
 * sunucu bileşenlerinde ve servis katmanında yapılır.
 */
// /m/[slug]: müşteriye açık menü, menüden kayıt ve menü görselleri · /davet/[kod]: PR davet linkiyle etkinlik kaydı
// /api/webhooks/: sağlayıcı bildirimleri (oturum yok; imza/anahtar ile doğrulanır) · /abonelik/: e-postadan abonelikten çıkma
const PUBLIC_PREFIXES = ["/login", "/pass/", "/q/", "/m/", "/davet/", "/api/webhooks/", "/abonelik/", "/api/abonelik/"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // /pass/[token]: müşterinin kişisel QR sayfası; /q/[token]: QR okutulunca açılan doğrulama girişi
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|brand/).*)"],
};
