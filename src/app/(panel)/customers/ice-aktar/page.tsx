import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { MAX_ROWS } from "@/modules/import/csv";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { ImportWizard } from "./wizard";

export const metadata: Metadata = { title: "Müşteri içe aktarma" };

/** CSV ile toplu müşteri ekleme: önce önizleme, sonra yazma. */
export default async function ImportPage() {
  await requirePermission("customers.create");

  return (
    <>
      <PageHeader
        back={{ href: "/customers", label: "Müşteriler" }}
        eyebrow="CRM"
        title="Müşterileri içe aktar"
        description="Excel veya başka bir sistemden aldığınız CSV dosyasını yükleyin. Önce ne olacağını görürsünüz; onaylamadan hiçbir şey yazılmaz."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <ImportWizard />
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Dosya nasıl olmalı" />
            <div className="space-y-2.5 px-5 py-4 text-[13px] leading-relaxed text-muted">
              <p>
                İlk satır başlık olmalı. Tanınan başlıklar: <span className="text-fg">Ad, Soyad, Telefon, E-posta, Doğum
                tarihi, Etiketler, Not</span>. Ayraç noktalı virgül, virgül veya sekme olabilir.
              </p>
              <p>
                Telefon <span className="text-fg">0532 123 45 67</span> veya <span className="text-fg">+90 532 123 45 67</span>{" "}
                yazılabilir. Doğum tarihi <span className="text-fg">1990-05-05</span> veya <span className="text-fg">05.05.1990</span>.
              </p>
              <p>Etiketler virgül veya dikey çizgiyle ayrılır: “VIP|Doğum günü”.</p>
              <p>Tek seferde en fazla {MAX_ROWS.toLocaleString("tr-TR")} satır, 2 MB.</p>
            </div>
          </Card>

          <Card className="border-caution/40">
            <CardHeader title="İzin içe aktarılmaz" />
            <div className="space-y-2.5 px-5 py-4 text-[13px] leading-relaxed text-muted">
              <p>
                Bir dosyada telefon bulunması, o kişinin ticari ileti almaya razı olduğu anlamına gelmez. İYS ve KVKK
                iznin <span className="text-fg">nasıl alındığının kanıtlanabilir</span> olmasını ister.
              </p>
              <p>
                Bu yüzden içe aktarılan kayıtlar <span className="text-fg">izinsiz</span> açılır. İzinleri gerçekten
                aldıysanız aşağıdaki alanda nasıl alındığını yazarak toplu işaretleyebilirsiniz; yazdığınız açıklama her
                izin kaydına işlenir.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Mükerrer kayıtlar" />
            <p className="px-5 py-4 text-[13px] leading-relaxed text-muted">
              Aynı telefon veya e-posta işletmenizde zaten varsa satır ezilmez. İsterseniz atlanır, isterseniz yalnızca{" "}
              <span className="text-fg">boş alanlar</span> doldurulur. Mevcut bilgi hiçbir durumda değişmez.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
