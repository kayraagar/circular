import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppContext, getSession } from "@/lib/context";
import { homePathForRole } from "@/lib/routes";
import { logoutAction } from "@/modules/auth/actions";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";

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
            {session.user.isPlatformAdmin ? "Platform konsolu hazırlanıyor" : "Aktif bir işletme üyeliğiniz yok"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {session.user.isPlatformAdmin
              ? "Platform yöneticisi hesabı işletmelerin müşteri verilerine otomatik erişmez. Tenant yönetimi ve destek erişimi (denetim kayıtlı) sonraki fazda eklenecek."
              : "Bu hesap henüz bir işletmeye bağlı değil veya üyeliğiniz devre dışı bırakıldı. İşletme yöneticinizle iletişime geçin."}
          </p>
          <form action={logoutAction} className="mt-6">
            <Button type="submit" variant="secondary">
              Çıkış yap
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
