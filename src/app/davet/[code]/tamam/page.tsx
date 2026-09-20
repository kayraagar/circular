import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { firstParam, type SearchParams } from "@/lib/page";
import { resolveInvite } from "@/modules/guests/invite";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = { title: "Guest listesi", referrer: "no-referrer", robots: { index: false, follow: false } };

const MESSAGES: Record<string, { title: string; body: string }> = {
  alindi: {
    title: "Kaydınız alındı",
    body: "Guest listesine eklendiniz. Giriş QR'ınızı sizi davet eden kişi iletecek; girişte adınızla da kontrol yapılabilir.",
  },
  kayitli: {
    title: "Bu numarayla zaten kayıt var",
    body: "Bu etkinliğin guest listesinde bu telefon numarasıyla bir kayıt bulunuyor. QR'ınıza ulaşamıyorsanız sizi davet eden kişiye başvurun.",
  },
  olusturulamadi: {
    title: "Kayıt oluşturulamadı",
    body: "Bu numarayla bu etkinliğe kayıt yapılamıyor. Lütfen sizi davet eden kişiye veya mekana başvurun.",
  },
};

export default async function InviteDonePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: SearchParams }) {
  const { code } = await params;
  const invite = await resolveInvite(code);
  if (!invite) notFound();
  const message = MESSAGES[firstParam((await searchParams).durum)] ?? MESSAGES.alindi;

  return (
    <div className="flex min-h-dvh items-center px-4 py-10">
      <div role="status" className="mx-auto w-full max-w-sm text-center">
        <svg viewBox="0 0 72 72" className="mx-auto size-16 text-muted" aria-hidden>
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="36" cy="36" r="33" strokeOpacity="0.35" />
            <circle cx="36" cy="36" r="23" />
            <circle cx="36" cy="36" r="12" strokeOpacity="0.6" strokeDasharray="2 5" />
          </g>
        </svg>
        <p className="eyebrow mt-5">{invite.event.name}</p>
        <h1 className="mt-2 text-[26px] leading-tight font-medium">{message.title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">{message.body}</p>
        <div className="mt-10 flex justify-center text-muted">
          <BrandMark size={16} />
        </div>
      </div>
    </div>
  );
}
