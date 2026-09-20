import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { formatTime } from "@/lib/datetime";
import { listMyRedemptionsToday } from "@/modules/perks/service";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Avantaj doğrulama" };

export default async function RedeemPage() {
  const ctx = await requirePermission("perks.redeem");
  const items = await listMyRedemptionsToday(ctx.service);

  return (
    <>
      <PageHeader
        eyebrow={ctx.activeVenue?.name ?? ctx.tenant.name}
        title="Avantaj doğrulama"
        description="Müşterinin avantaj QR'ını telefonunuzun kamerasıyla okutun; açılan sayfada kullanımı onaylayın."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Bugün onayladıklarınız" description={`${items.length} kullanım`} />
          {items.length === 0 ? (
            <EmptyState compact title="Bugün onaylanmış kullanım yok" description="Onayladığınız avantaj kullanımları burada listelenir." />
          ) : (
            <ul>
              {items.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 border-line px-5 py-3.5 [&+li]:border-t">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{r.perkName}</p>
                    <p className="text-[13px] text-muted">{r.holder}</p>
                  </div>
                  <span className="font-mono text-[12px] text-muted">{formatTime(r.redeemedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Kurallar" />
          <ul className="space-y-3 p-5 text-[13px] text-muted">
            <li>Her QR kişiye özeldir; kalan kullanım hakkı doğrulama sayfasında görünür.</li>
            <li>Süresi dolmuş, iptal edilmiş veya hakkı bitmiş avantaj onaylanamaz.</li>
            <li>İki cihaz aynı anda okutsa bile tek kullanım kaydedilir.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
