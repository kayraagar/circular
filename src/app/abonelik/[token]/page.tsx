import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { firstParam, type SearchParams } from "@/lib/page";
import { resolveUnsubscribe, unsubscribeByToken } from "@/modules/campaigns/unsubscribe";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = { title: "Abonelik", referrer: "no-referrer", robots: { index: false, follow: false } };

/** E-postadaki "Abonelikten çık" bağlantısı: onayla, işletmenin e-posta iznini kaldır. */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SearchParams }) {
  const { token } = await params;
  const target = await resolveUnsubscribe(token);
  if (!target) notFound();
  const done = firstParam((await searchParams).durum) === "tamam" || target.alreadyRevoked;

  async function unsubscribe() {
    "use server";
    const result = await unsubscribeByToken(token);
    if (!result.ok) notFound();
    redirect(`/abonelik/${encodeURIComponent(token)}?durum=tamam`);
  }

  return (
    <div className="flex min-h-dvh items-center px-4 py-10">
      <div className="mx-auto w-full max-w-sm text-center">
        <svg viewBox="0 0 72 72" className="mx-auto size-16 text-muted" aria-hidden>
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="36" cy="36" r="33" strokeOpacity="0.35" />
            <circle cx="36" cy="36" r="23" />
            <circle cx="36" cy="36" r="12" strokeOpacity="0.6" strokeDasharray="2 5" />
          </g>
        </svg>
        <p className="eyebrow mt-5">{target.tenantName}</p>
        {done ? (
          <div role="status">
            <h1 className="mt-2 text-[26px] leading-tight font-medium">Abonelikten çıktınız</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              {target.test ? "Bu bir test e-postasıydı; işlem yapılmadı." : `${target.tenantName} size artık kampanya e-postası göndermeyecek.`}
            </p>
          </div>
        ) : (
          <>
            <h1 className="mt-2 text-[26px] leading-tight font-medium">E-posta aboneliğinden çıkılsın mı?</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{target.tenantName} size kampanya ve duyuru e-postası göndermeyi bırakır.</p>
            <form action={unsubscribe} className="mt-6">
              <button type="submit" className="flex h-12 w-full items-center justify-center rounded-field bg-fg text-[15px] font-semibold text-bg">
                Abonelikten çık
              </button>
            </form>
          </>
        )}
        <div className="mt-10 flex justify-center text-muted">
          <BrandMark size={16} />
        </div>
      </div>
    </div>
  );
}
