import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { formatDateTime } from "@/lib/datetime";
import { setPerkStatusAction } from "@/modules/perks/actions";
import { listPerks } from "@/modules/perks/service";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { IconPlus } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Avantajlar" };

export default async function PerksPage() {
  const ctx = await requirePermission("perks.manage");
  const perks = await listPerks(ctx.service);

  return (
    <>
      <PageHeader
        back={{ href: "/menu", label: "QR Menü" }}
        eyebrow={ctx.tenant.name}
        title="Avantajlar"
        description="Mekana özel ikram ve avantajlar. Müşteriye kişiye özel QR ile verilir; kullanım personel doğrulamasıyla kaydedilir."
        actions={
          <ButtonLink href="/menu/perks/new" variant="primary">
            <IconPlus size={15} /> Avantaj oluştur
          </ButtonLink>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {perks.length === 0 ? (
            <EmptyState
              title="Henüz avantaj yok"
              description="Hoş geldin ikramı, doğum günü tatlısı gibi avantajlar tanımlayıp müşterilere QR ile verebilirsiniz."
              action={
                <ButtonLink href="/menu/perks/new" variant="primary">
                  <IconPlus size={15} /> İlk avantajı oluştur
                </ButtonLink>
              }
            />
          ) : (
            <ul>
              {perks.map((p) => {
                const archived = p.status === "ARCHIVED";
                return (
                  <li key={p.id} className="flex flex-col gap-3 border-line px-5 py-4 sm:flex-row sm:items-start [&+li]:border-t">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`font-medium ${archived ? "text-muted" : "text-fg"}`}>{p.name}</p>
                        {archived ? <Badge tone="muted">Arşivde</Badge> : p.expired ? <Badge tone="caution">Süresi doldu</Badge> : <Badge tone="positive">Aktif</Badge>}
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted">
                        {p.venueName ?? "Tüm mekanlar"} · Kişi başı {p.perCustomerLimit} kullanım
                        {p.validUntil ? ` · Son geçerlilik ${formatDateTime(p.validUntil)}` : ""}
                      </p>
                      {p.terms && <p className="mt-1 text-[13px] text-muted">Koşullar: {p.terms}</p>}
                      <p className="mt-2 font-mono text-[12px] text-muted" data-numeric>
                        {p.issuedCount} aktif QR · {p.redemptionCount} kullanım
                      </p>
                    </div>
                    <ConfirmDialog
                      trigger={archived ? "Etkinleştir" : "Arşivle"}
                      triggerVariant={archived ? "secondary" : "ghost"}
                      title={archived ? "Avantajı yeniden etkinleştir" : "Avantajı arşivle"}
                      description={
                        archived
                          ? "Avantaj yeniden verilebilir ve mevcut QR'lar kullanılabilir hâle gelir."
                          : "Arşivlenen avantaj yeni müşterilere verilemez; verilmiş QR'lar kullanılamaz. Kullanım geçmişi korunur."
                      }
                      confirmLabel={archived ? "Etkinleştir" : "Arşivle"}
                      confirmVariant={archived ? "primary" : "danger"}
                      action={setPerkStatusAction}
                      fields={{ perkId: p.id, status: archived ? "ACTIVE" : "ARCHIVED" }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Nasıl verilir?" />
          <ol className="space-y-3 p-5 text-[13px] text-muted">
            <li>1. Müşteri profilini açın, Avantajlar bölümünden QR oluşturun.</li>
            <li>2. Kişisel bağlantıyı müşteriye iletin; mesaj gönderimi otomatik değildir.</li>
            <li>3. Müşteri QR&apos;ı gösterir, garson okutup kullanımı onaylar.</li>
          </ol>
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
            Avantaj vermek iletişim izni veya üyelik oluşturmaz.
          </p>
        </Card>
      </div>
    </>
  );
}
