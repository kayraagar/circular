import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/config/brand";
import { legalDocuments } from "@/modules/legal/documents";

export const metadata: Metadata = { title: "Yasal metinler" };

/** Yasal metinlerin dizini. */
export default function LegalIndexPage() {
  const documents = legalDocuments();
  return (
    <main>
      <h1 className="font-display text-[30px] leading-tight font-medium sm:text-[36px]">Yasal metinler</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        {brand.name}'ın kişisel verileri nasıl işlediği, hizmetin kullanım koşulları ve çerez uygulaması. Metinler uygulamanın gerçekte işlediği
        veriye göre yazılmıştır.
      </p>

      <ul className="mt-8 space-y-3">
        {documents.map((doc) => (
          <li key={doc.slug}>
            <Link href={`/yasal/${doc.slug}`} className="card block p-5 transition-colors hover:border-line-strong">
              <p className="font-display text-[16px] font-medium text-fg">{doc.title}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{doc.summary}</p>
              <p className="mt-3 font-mono text-[11px] tracking-wide text-muted">
                SÜRÜM {doc.version} · {doc.updatedAt}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
