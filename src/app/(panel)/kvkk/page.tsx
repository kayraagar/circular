import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { formatDate } from "@/lib/datetime";
import { brand } from "@/config/brand";
import { listDataRequests, RESPONSE_DAYS } from "@/modules/privacy/requests";
import { getTenantLegal } from "@/modules/legal/tenant-legal";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { RequestForm } from "./request-form";
import { ResolveForm } from "./resolve-form";

export const metadata: Metadata = { title: "KVKK başvuruları" };

/**
 * İlgili kişi başvuru defteri (KVKK m.13). Panel başvuru almaz; işletmenin ilan ettiği
 * adrese gelen talepler buraya kaydedilir, süresi takip edilir ve sonucu yazılır.
 */
export default async function PrivacyPage() {
  const ctx = await requirePermission("privacy.manage");
  const [{ items, openCount, overdueCount }, legal] = await Promise.all([
    listDataRequests(ctx.service),
    getTenantLegal(ctx.service),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Yasal"
        title="KVKK başvuruları"
        description={`Kişilerin size ilettiği veri talepleri. Kanun, başvuruya en geç ${RESPONSE_DAYS} gün içinde cevap verilmesini ister; süre başvurunun size ulaştığı günden başlar.`}
        actions={
          <Link href="/settings" className="text-[13px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
            Yasal ayarlar
          </Link>
        }
      />

      {!legal.ready && (
        <Card className="mb-6 border-caution/40">
          <div className="px-5 py-4 text-sm leading-relaxed text-muted">
            <span className="text-fg">Başvuru adresiniz eksik.</span> Kişiler size başvurabilmek için ilan edilmiş bir adres
            (e-posta, KEP veya yazılı adres) görmek zorundadır. Eksikler:{" "}
            <span className="text-fg">{legal.missing.join(", ")}</span>.{" "}
            <Link href="/settings" className="text-fg underline underline-offset-4">
              Ayarlar › Yasal
            </Link>{" "}
            bölümünden tamamlayın.
          </div>
        </Card>
      )}

      {overdueCount > 0 && (
        <Card className="mb-6 border-negative/40">
          <div className="px-5 py-4 text-sm text-negative">
            {overdueCount} başvurunun {RESPONSE_DAYS} günlük cevap süresi doldu. Gecikme Kurul şikâyetine konu olabilir.
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader
            title="Başvurular"
            description={items.length === 0 ? "Henüz başvuru kaydı yok." : `${openCount} açık · ${items.length} kayıt`}
          />
          {items.length > 0 && (
            <ul>
              {items.map((r) => (
                <li key={r.id} className="border-line px-5 py-4 [&+li]:border-t">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm text-fg">
                        {r.applicantName}
                        {r.customerId && (
                          <Link href={`/customers/${r.customerId}`} className="ml-2 text-[12px] text-muted underline-offset-4 hover:text-fg hover:underline">
                            CRM kaydı
                          </Link>
                        )}
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted">
                        {r.kindLabel} · {r.channelLabel} ile geldi · {formatDate(r.receivedAt)}
                        {r.contact ? ` · ${r.contact}` : ""}
                      </p>
                      {r.note && <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{r.note}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {r.status === "OPEN" ? (
                        r.overdue ? (
                          <Badge tone="negative">Süresi doldu</Badge>
                        ) : (
                          <Badge tone={r.daysLeft !== null && r.daysLeft <= 7 ? "caution" : "muted"}>
                            {r.daysLeft} gün kaldı
                          </Badge>
                        )
                      ) : (
                        <Badge tone={r.status === "DONE" ? "positive" : "muted"}>
                          {r.status === "DONE" ? "Cevaplandı" : "Reddedildi"}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {r.status === "OPEN" ? (
                    <ResolveForm requestId={r.id} dueAt={r.dueAt.toISOString()} />
                  ) : (
                    r.resolution && (
                      <p className="mt-2.5 rounded-field border border-line bg-raised/40 px-3.5 py-2.5 text-[13px] leading-relaxed text-muted">
                        <span className="text-fg">Sonuç</span> ({r.resolvedAt ? formatDate(r.resolvedAt) : "—"}): {r.resolution}
                      </p>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Başvuru kaydet" description="Size ulaşan talebi buraya girin; süre takibi başlar." />
            <RequestForm />
          </Card>

          <Card>
            <CardHeader title="Nasıl işler" />
            <div className="space-y-2.5 px-5 py-4 text-[13px] leading-relaxed text-muted">
              <p>
                Mekanınızın müşterilerine ait veride <span className="text-fg">veri sorumlusu sizsiniz</span>; {brand.name} veri
                işleyendir. Başvuruyu siz cevaplarsınız.
              </p>
              <p>
                Silme talebinde müşteri kaydındaki <span className="text-fg">KVKK</span> bölümünden anonimleştirme veya kalıcı
                silme yapabilirsiniz. Bilgi talebinde aynı bölümdeki dışa aktarma, kişinin tüm verisini JSON dosyası olarak verir.
              </p>
              <p>Kanun cevabın ücretsiz olmasını ister; işlem ayrı bir maliyet doğurursa Kurul tarifesi uygulanır.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
