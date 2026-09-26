import Link from "next/link";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { legalIdentity, legalIdentityReady } from "@/config/legal";
import { LEGAL_SLUGS, legalDocument } from "@/modules/legal/documents";
import { BrandMark } from "@/components/ui/brand-mark";
import { IconAlert } from "@/components/ui/icons";

/** Yasal metinler herkese açıktır; panel kabuğu ve oturum gerektirmez. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  const identity = legalIdentity();
  const ready = legalIdentityReady(identity);

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-10 sm:px-8 lg:py-16">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="rounded-md text-fg">
          <BrandMark />
        </Link>
        <nav aria-label="Yasal metinler" className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
          {LEGAL_SLUGS.map((slug) => (
            <Link key={slug} href={`/yasal/${slug}`} className="text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
              {legalDocument(slug, identity).title.replace(/\s*\(.*\)$/, "")}
            </Link>
          ))}
        </nav>
      </header>

      {!ready && (
        <div role="status" className="mb-8 flex gap-3 rounded-field border border-caution/30 bg-caution/[0.06] px-4 py-3.5 text-[13px] leading-relaxed text-caution">
          <IconAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-medium">Bu metin henüz yayına hazır değil.</strong> Veri sorumlusunun ticaret unvanı, adresi ve başvuru adresi
            tanımlanmadığı için metinde yer tutucular görünüyor. Bu bilgiler ortam değişkenlerinden okunur; uydurulmaz.
          </span>
        </div>
      )}

      {children}

      <footer className="mt-14 border-t border-line pt-6 text-[12px] leading-relaxed text-muted">
        <p>
          {brand.name} · Bu metinler bilgilendirme amaçlıdır ve hukuki görüş yerine geçmez. Yayına almadan önce bir hukukçunun gözden geçirmesi
          gerekir.
        </p>
        <Link href="/login" className="mt-2 inline-flex text-fg underline-offset-4 hover:underline">
          Panele giriş
        </Link>
      </footer>
    </div>
  );
}
