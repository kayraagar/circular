import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brand } from "@/config/brand";
import { readPreferences } from "@/modules/preferences/service";
import { BrandMark } from "@/components/ui/brand-mark";
import { PreferenceForm } from "./preference-form";

// Kişiye özel bağlantı: dizine eklenmez, dış bağlantılara Referer ile sızmaz.
export const metadata: Metadata = {
  title: "İletişim tercihleri",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Herkese açık tercih merkezi: kişi kendi iletişim izinlerini görür ve değiştirir.
 * Sayfada kişisel veri olarak yalnızca maskeli ad görünür.
 */
export default async function PreferencesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await readPreferences(token);
  if (!view) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <BrandMark />
      <div className="card mt-8 p-6">
        <p className="eyebrow">{view.tenantName}</p>
        <h1 className="mt-2 font-display text-[24px] leading-tight font-medium">İletişim tercihleriniz</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {view.holder} · Hangi kanaldan haber almak istediğinizi siz seçersiniz. Kapattığınız kanaldan bir daha ticari
          ileti gönderilmez.
        </p>

        <PreferenceForm token={token} channels={view.channels} />

        <p className="mt-6 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
          Bu sayfa {brand.name} altyapısıyla sunulur. Verinizin sorumlusu {view.tenantName}; silme veya bilgi talebiniz
          için doğrudan işletmeye başvurabilirsiniz.
        </p>
      </div>
    </main>
  );
}
