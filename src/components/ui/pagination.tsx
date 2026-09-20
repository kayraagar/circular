import Link from "next/link";
import { IconArrowLeft, IconArrowRight } from "./icons";

export function Pagination({
  basePath,
  params,
  page,
  pageCount,
}: {
  basePath: string;
  params: Record<string, string>;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const qs = new URLSearchParams({ ...params, page: String(p) });
    return `${basePath}?${qs.toString()}`;
  };
  const cls =
    "inline-flex h-8 items-center gap-1.5 rounded-field border border-line px-3 text-[13px] text-fg transition-colors hover:border-line-strong";
  const disabled = "inline-flex h-8 items-center gap-1.5 rounded-field border border-line px-3 text-[13px] text-muted opacity-40";
  return (
    <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
      <p className="font-mono text-[12px] text-muted" data-numeric>
        Sayfa {page} / {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={cls} rel="prev">
            <IconArrowLeft size={13} /> Önceki
          </Link>
        ) : (
          <span className={disabled} aria-disabled>
            <IconArrowLeft size={13} /> Önceki
          </span>
        )}
        {page < pageCount ? (
          <Link href={href(page + 1)} className={cls} rel="next">
            Sonraki <IconArrowRight size={13} />
          </Link>
        ) : (
          <span className={disabled} aria-disabled>
            Sonraki <IconArrowRight size={13} />
          </span>
        )}
      </div>
    </nav>
  );
}
