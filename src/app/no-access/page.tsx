import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppContext, getSession } from "@/lib/context";
import { homePathForRole } from "@/lib/routes";
import { logoutAction } from "@/modules/auth/actions";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button, ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Erişim yok" };

export default async function NoAccessPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ctx = await getAppContext();
  if (ctx) redirect(homePathForRole(ctx.membership.role));

  return (
    <div className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
      <BrandMark />
      <div className="flex flex-1 items-center justify-center">
        <div className="card w-full max-w-md p-8">
          <p className="eyebrow">{session.user.isPlatformAdmin ? "Platform yöneticisi" : "Erişim yok"}</p>
          <h1 className="mt-3 text-2xl font-medium">
            {session.user.isPlatformAdmin ? "Platform konsolu" : "Aktif bir işletme üyeliğiniz yok"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {session.user.isPlatformAdmin
              ? "Platform yöneticisi hesabı işletmelerin müşteri verilerine kendiliğinden erişmez. İşletme listesi, askıya alma ve süreli destek erişimi için konsolu açın."
              : "Bu hesap henüz bir işletmeye bağlı değil veya üyeliğiniz devre dışı bırakıldı. İşletme yöneticinizle iletişime geçin."}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {session.user.isPlatformAdmin && (
              <ButtonLink href="/platform" variant="primary">
                Platform konsolunu aç
              </ButtonLink>
            )}
            <form action={logoutAction}>
              <Button type="submit" variant="secondary">
                Çıkış yap
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
