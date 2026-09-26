import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEGAL_SLUGS, legalDocument, parseLegalSlug, type LegalSection } from "@/modules/legal/documents";

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = parseLegalSlug((await params).slug);
  if (!slug) return { title: "Bulunamadı" };
  const doc = legalDocument(slug);
  return { title: doc.title, description: doc.summary };
}

function Section({ section }: { section: LegalSection }) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-[17px] font-medium text-fg">{section.heading}</h2>
      {section.paragraphs?.map((text) => (
        <p key={text} className="mt-3 text-sm leading-relaxed text-muted">
          {text}
        </p>
      ))}
      {section.list && (
        <ul className="mt-3 space-y-2">
          {section.list.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-muted">
              <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-line-strong" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
      {section.table && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[12px] text-muted">
                {section.table.headers.map((header) => (
                  <th key={header} className="py-2.5 pr-4 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, i) => (
                <tr key={i} className="border-line [&+tr]:border-t">
                  {row.map((cell, j) => (
                    <td key={j} className="py-3 pr-4 align-top leading-relaxed text-muted first:text-fg">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Tek bir yasal metin. */
export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = parseLegalSlug((await params).slug);
  if (!slug) notFound();
  const doc = legalDocument(slug);

  return (
    <main>
      <p className="eyebrow">
        Sürüm {doc.version} · Son güncelleme {doc.updatedAt}
      </p>
      <h1 className="mt-2 font-display text-[30px] leading-tight font-medium sm:text-[36px]">{doc.title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{doc.summary}</p>
      {doc.sections.map((section) => (
        <Section key={section.heading} section={section} />
      ))}
    </main>
  );
}
