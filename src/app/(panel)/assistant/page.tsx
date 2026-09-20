import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { PreparingModule } from "@/components/preparing-module";

export const metadata: Metadata = { title: "AI Asistan" };

export default async function AssistantPage() {
  await requirePermission("modules.preview");
  return (
    <PreparingModule
      title="AI Asistan"
      summary="Circular Copilot: panel yardımı, CRM özetleri ve kampanya taslakları. Henüz bir yapay zeka modeli bağlı değil."
      planned={[
        "Panel kullanımını anlatma ve ilgili ekrana yönlendirme",
        "Yetkili olduğunuz CRM verilerini özetleme",
        "Segment önerme",
        "Kampanya taslağı hazırlama",
        "PR ve etkinlik performansını yorumlama",
        "CRM ekranlarında sağ altta erişilebilen yardımcı; bu sayfada geniş konuşma arayüzü",
      ]}
      foundations={[
        "Servis katmanında kullanıcı bağlamı: asistan yalnızca kullanıcının görmeye yetkili olduğu veriye erişebilecek",
        "Aktivite geçmişi ve ölçülen / ölçülmeyen metriklerin ayrımı",
      ]}
      principles={[
        "AI kampanyayı kendiliğinden gönderemez; kullanıcı hedef kitleyi ve içeriği görüp onaylar.",
        "Veri yoksa bunu açıkça söyler; desteksiz performans tahmini üretmez.",
        "Model entegrasyonu olmadan hazırlanmış yanıtlar gerçek analiz gibi sunulmaz.",
      ]}
    />
  );
}
