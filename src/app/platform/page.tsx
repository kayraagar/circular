import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { forbidden } from "next/navigation";
import { getSession } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { brand } from "@/config/brand";
import { getPlatformSummary, listSupportGrants, listTenants, MAX_SUPPORT_HOURS } from "@/modules/platform/service";
import { logoutAction } from "@/modules/auth/actions";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, Stat } from "@/components/ui/primitives";
import { TenantRowActions } from "./tenant-actions";

export const metadata: Metadata = { title: "Platform konsolu", robots: { index: false, follow: false } };

/**
 * Platform yöneticisi konsolu. Yetki tenant rolünden değil `User.isPlatformAdmin`'den gelir.
 * Konsol müşteri verisi göstermez; yalnızca işletme listesi, sayılar ve destek erişimi kaydı.
 */
export default async function PlatformPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.isPlatformAdmin) forbidden();

  const user = { id: session.user.id, isPlatformAdmin: true };
  const [summary, tenants, grants] = await Promise.all([
    getPlatformSummary(user),
    listTenants(user),
    listSupportGrants(user),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <BrandMark />
          <p className="eyebrow mt-4">Platform</p>
          <h1 className="mt-2 text-[28px] leading-tight font-medium">İşletmeler</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {brand.name} yöneticisi olarak işletmeleri görüntüler, askıya alır ve gerektiğinde <span className="text-fg">süreli</span>{" "}
            destek erişimi açarsınız. Bu hesap işletmelerin müşteri verisine kendiliğinden erişmez.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="text-[13px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
            Panele dön
          </Link>
          <form action={logoutAction}>
            <Button type="submit" size="sm" variant="ghost">
              Çıkış
            </Button>
          </form>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="İşletme" value={summary.tenants} />
        <Stat label="Askıda" value={summary.suspended} />
        <Stat label="Panel kullanıcısı" value={summary.users} />
        <Stat label="Müşteri kaydı" value={summary.customers} />
        <Stat label="30 günde mesaj" value={summary.messages30d} />
      </div>

      <Card className="mt-6">
        <CardHeader title="İşletmeler" description="Sayılar toplamdır; müşteri bilgisi gösterilmez." />
        <ul>
          {tenants.map((t) => (
            <li key={t.id} className="border-line px-5 py-4 [&+li]:border-t">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-[220px] flex-1">
                  <p className="text-sm font-medium text-fg">
                    {t.name} <span className="ml-2 font-mono text-[12px] text-muted">{t.slug}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted" data-numeric>
                    {t.venues} mekan · {t.members} üye · {t.customers} müşteri · {t.events} etkinlik · 30 günde {t.messages30d} mesaj
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">Kayıt: {formatDate(t.createdAt)}</p>
                  {t.supportAccess && (
                    <p className="mt-1.5 text-[12px] text-caution">
                      Destek erişimi açık: {t.supportAccess.userName} · {formatDateTime(t.supportAccess.expiresAt)} tarihine kadar ·{" "}
                      {t.supportAccess.reason}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {t.status === "SUSPENDED" ? <Badge tone="negative">Askıda</Badge> : <Badge tone="positive">Aktif</Badge>}
                  <TenantRowActions tenantId={t.id} tenantName={t.name} suspended={t.status === "SUSPENDED"} maxHours={MAX_SUPPORT_HOURS} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Destek erişimi kaydı"
          description="Her erişim gerekçeli ve sürelidir; işletmenin kendi aktivite geçmişine de yazılır."
        />
        {grants.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted">Henüz destek erişimi açılmadı.</p>
        ) : (
          <ul>
            {grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 border-line px-5 py-3 text-[13px] [&+li]:border-t">
                <div className="min-w-0">
                  <p className="text-fg">
                    {g.tenantName} · {g.userName}
                  </p>
                  <p className="mt-0.5 text-muted">{g.reason}</p>
                </div>
                <span className="text-muted">
                  {formatDateTime(g.createdAt)} → {g.endedAt ? `${formatDateTime(g.endedAt)} (kapandı)` : `${formatDateTime(g.expiresAt)} (açık)`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
