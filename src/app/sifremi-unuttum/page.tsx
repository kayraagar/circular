import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/context";
import { BrandMark } from "@/components/ui/brand-mark";
import { ForgotPasswordForm } from "./forgot-form";

// Hesap varlığını sızdırmamak için sayfa dizine eklenmez ve dış bağlantılara Referer gitmez.
export const metadata: Metadata = {
  title: "Şifremi unuttum",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/** Herkese açık: şifre sıfırlama talebi. Cevap, adresin kayıtlı olup olmadığını belli etmez. */
export default async function ForgotPasswordPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <BrandMark />
      <div className="card mt-8 p-6">
        <h1 className="font-display text-[24px] leading-tight font-medium">Şifremi unuttum</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Hesabınızın e-posta adresini yazın. Adres kayıtlıysa tek kullanımlık bir sıfırlama bağlantısı gönderilir.
        </p>
        <ForgotPasswordForm />
        <Link href="/login" className="mt-5 inline-flex text-[13px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
          Giriş ekranına dön
        </Link>
      </div>
    </main>
  );
}
