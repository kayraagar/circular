import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleMotif } from "@/components/menu/menu-preview";
import { menuFontVariables } from "@/components/menu/fonts";
import { firstParam, type SearchParams } from "@/lib/page";
import { publicMenuPath } from "@/modules/menu/campaign";
import { getPublicMenu } from "@/modules/menu/public";
import { readableForeground, withAlpha } from "@/modules/menu/theme";

export const metadata: Metadata = { title: "Üyelik" };

const MESSAGES: Record<string, { title: string; body: (tenant: string) => string }> = {
  tamam: {
    title: "Kaydınız alındı",
    body: (tenant) => `${tenant} üyeliğiniz oluşturuldu. Teşekkürler!`,
  },
  "ikram-yok": {
    title: "Kaydınız alındı",
    body: (tenant) => `${tenant} üyeliğiniz oluşturuldu. Bu ikram şu anda geçerli olmadığı için kod oluşturulamadı; personelimize sorabilirsiniz.`,
  },
  kayitli: {
    title: "Bu bilgilerle kayıt zaten var",
    body: () =>
      "Aynı telefon numarası veya e-postayla daha önce kayıt olunmuş; bilgilerde değişiklik yapılmadı. Güncelleme veya ikram için personelimizle görüşebilirsiniz.",
  },
};

export default async function SignupDonePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const status = firstParam((await searchParams).durum);
  const data = await getPublicMenu(slug);
  if (!data) notFound();
  const { tenant, menu } = data;
  const fg = menu.config.textColor ?? readableForeground(menu.config.backgroundColor);
  const message = MESSAGES[status] ?? MESSAGES.tamam;

  return (
    <div className={`${menuFontVariables} flex min-h-dvh items-center px-4 py-10`} style={{ background: menu.config.backgroundColor, color: fg }}>
      <div role="status" className="mx-auto w-full max-w-sm text-center">
        <div className="flex justify-center">
          <CircleMotif color={fg} size={64} />
        </div>
        <h1 className="mt-5 text-[26px] leading-tight font-medium" style={{ fontFamily: "var(--font-display)" }}>
          {message.title}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed" style={{ color: withAlpha(fg, 0.7) }}>
          {message.body(tenant.name)}
        </p>
        <Link
          href={publicMenuPath(tenant.slug)}
          className="mt-8 inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px] font-semibold"
          style={{ background: menu.config.accentColor, color: readableForeground(menu.config.accentColor) }}
        >
          Menüye dön
        </Link>
      </div>
    </div>
  );
}
