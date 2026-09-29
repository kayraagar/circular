import type { Metadata } from "next";
import Link from "next/link";
import { AppError } from "@/lib/errors";
import { readReset } from "@/modules/auth/password-reset";
import { BrandMark } from "@/components/ui/brand-mark";
import { ResetPasswordForm } from "./reset-form";

// Sıfırlama bağlantısı tek kullanımlık bir yetkidir: dizine eklenmez, Referer ile sızmaz.
export const metadata: Metadata = {
  title: "Yeni şifre",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/** Herkese açık: sıfırlama bağlantısıyla yeni şifre belirleme. */
export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let reset: Awaited<ReturnType<typeof readReset>>;
  try {
    reset = await readReset(token);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Bağlantı geçersiz.";
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <BrandMark />
        <div className="card mt-8 p-6">
          <h1 className="font-display text-[22px] font-medium">Bağlantı kullanılamıyor</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{message}</p>
          <Link href="/sifremi-unuttum" className="mt-5 inline-flex text-[13px] text-fg underline-offset-4 hover:underline">
            Yeni bağlantı iste
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <BrandMark />
      <div className="card mt-8 p-6">
        <h1 className="font-display text-[24px] leading-tight font-medium">Yeni şifre belirleyin</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {reset.name} · <span className="text-fg">{reset.email}</span>
        </p>
        <p className="mt-1 text-[13px] text-muted">Şifre değişince açık tüm oturumlarınız kapatılır.</p>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
