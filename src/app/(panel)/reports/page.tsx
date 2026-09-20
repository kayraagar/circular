import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { PreparingModule } from "@/components/preparing-module";
import { Card, CardHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Raporlar" };

export default async function ReportsPage() {
  await requirePermission("modules.preview");
  return (
    <PreparingModule
      title="Raporlar"
      summary="Kayıt, gerçek ziyaret ve kampanya verilerinin dönemsel analizi."
      planned={[
        "Etkinlik bazında kayıt → gerçek giriş dönüşümü (check-in devreye girince)",
        "Kayıt kaynağına göre müşteri kazanımı ve tekrar ziyaret",
        "PR performansı: tıklama, kayıt ve giriş ayrı",
        "Kampanya raporları (yalnızca sağlayıcının desteklediği metrikler)",
        "Dışa aktarma",
      ]}
      foundations={[
        "Tüm işlemler zaman damgalı aktivite geçmişine yazılıyor",
        "Kayıt olmak, QR menü açmak ve gerçek giriş ayrı olaylar olarak modellendi",
      ]}
      footer={
        <Card>
          <CardHeader title="Bugün ölçülen veriler" />
          <p className="p-5 text-[13px] text-muted">
            Müşteri, yeni kayıt, etkinlik kaydı, kayıt kaynağı ve iletişim izni sayıları{" "}
            <Link href="/dashboard" className="text-fg underline underline-offset-4">
              Genel Bakış
            </Link>{" "}
            sayfasında gerçek kayıtlardan hesaplanıyor.
          </p>
        </Card>
      }
    />
  );
}
