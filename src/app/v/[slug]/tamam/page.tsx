import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { firstParam, type SearchParams } from "@/lib/page";
import { getPublicVenue } from "@/modules/venue-page/service";
import { readVerificationHandle } from "@/modules/verification/service";
import { BrandMark } from "@/components/ui/brand-mark";
import { PhoneVerifyForm } from "@/components/verify/phone-verify";

export const metadata: Metadata = { title: "Üyelik", robots: { index: false, follow: false } };

const MESSAGES: Record<string, { title: string; body: (venue: string) => string }> = {
  tamam: {
    title: "Kaydınız alındı",
    body: (venue) => `${venue} üyeliğiniz oluşturuldu. Yeni etkinliklerden haberdar olacaksınız.`,
  },
  kayitli: {
    title: "Bu bilgilerle kayıt zaten var",
    body: () =>
      "Aynı telefon numarası veya e-postayla daha önce kayıt olunmuş; bilgilerde değişiklik yapılmadı. Güncelleme için mekan personeliyle görüşebilirsiniz.",
  },
};

/** Mekan sayfasındaki kaydın sonuç ekranı. */
export default async function VenueSignupDonePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const venue = await getPublicVenue(slug);
  if (!venue) notFound();
  const message = MESSAGES[firstParam(query.durum)] ?? MESSAGES.tamam;
  const handle = firstParam(query.dogrula);
  const verification = handle ? await readVerificationHandle(handle) : { open: false as const };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <BrandMark />
      <div className="card mt-8 p-6">
        <p className="eyebrow">{venue.name}</p>
        <h1 className="mt-2 font-display text-[24px] leading-tight font-medium">{message.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{message.body(venue.name)}</p>

        {verification.open && <PhoneVerifyForm handle={handle} maskedPhone={verification.maskedPhone} />}

        <Link href={`/v/${venue.slug}`} className="mt-6 inline-flex text-[13px] text-fg underline-offset-4 hover:underline">
          Mekan sayfasına dön
        </Link>
      </div>
    </main>
  );
}
