import type { Metadata } from "next";
import Link from "next/link";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/datetime";
import { readInvite } from "@/modules/team/service";
import { BrandMark } from "@/components/ui/brand-mark";
import { AcceptInviteForm } from "./accept-form";

// Davet bağlantısı tek kullanımlık bir yetkidir: dizine eklenmemeli ve
// dış bağlantılara Referer başlığıyla sızmamalı (diğer token'lı sayfalarla aynı kural).
export const metadata: Metadata = {
  title: "Ekip daveti",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/** Herkese açık: ekip davet bağlantısı. Kişi kendi şifresini belirleyip ekibe katılır. */
export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invite: Awaited<ReturnType<typeof readInvite>>;
  try {
    invite = await readInvite(token);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Davet bağlantısı geçersiz.";
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <BrandMark />
        <div className="card mt-8 p-6">
          <h1 className="font-display text-[22px] font-medium">Bağlantı kullanılamıyor</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{message}</p>
          <Link href="/login" className="mt-5 inline-flex text-[13px] text-fg underline-offset-4 hover:underline">
            Giriş ekranına git
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <BrandMark />
      <div className="card mt-8 p-6">
        <p className="eyebrow">{invite.tenantName}</p>
        <h1 className="mt-2 font-display text-[24px] leading-tight font-medium">Ekibe katılın</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {invite.name}, <span className="text-fg">{invite.roleLabel}</span> olarak davet edildiniz.
          {invite.venueNames.length > 0 && ` Erişim: ${invite.venueNames.join(", ")}.`}
        </p>

        <dl className="mt-5 space-y-1.5 rounded-field border border-line bg-raised/40 px-3.5 py-3 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">E-posta</dt>
            <dd className="truncate text-fg">{invite.email}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Geçerlilik</dt>
            <dd className="text-fg">{formatDate(invite.expiresAt)}</dd>
          </div>
        </dl>

        <AcceptInviteForm token={token} hasAccount={invite.hasAccount} />
      </div>
    </main>
  );
}
