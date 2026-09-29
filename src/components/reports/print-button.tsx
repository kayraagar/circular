"use client";

/**
 * Raporu yazdırır. Ayrı bir PDF kütüphanesi yoktur: baskıya özel stil (globals.css
 * `@media print`) sayfayı aydınlık şemaya çevirip gezinmeyi gizler, tarayıcının
 * "PDF olarak kaydet" seçeneği düzgün bir çıktı üretir.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="ml-auto inline-flex h-9 items-center rounded-field border border-line px-3 text-[13px] text-fg transition-colors hover:border-line-strong hover:bg-raised"
    >
      Yazdır / PDF
    </button>
  );
}
