import { brand } from "@/config/brand";

/**
 * Circular işareti. brand.logoSrc tanımlıysa sağlanan logo aynen kullanılır;
 * değilse GEÇİCİ çember sembolü çizilir (nihai logo değildir).
 */
export function BrandMark({ size = 22, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {brand.logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoSrc} alt={brand.name} height={size} style={{ height: size, width: "auto" }} />
      ) : (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          role="img"
          aria-label={wordmark ? undefined : brand.name}
          aria-hidden={wordmark ? true : undefined}
          data-placeholder-logo
        >
          <circle cx="12" cy="12" r="10.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 5.5a6.5 6.5 0 1 1-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      )}
      {wordmark && !brand.logoSrc && (
        <span className="font-display text-[17px] font-medium tracking-[-0.02em] text-fg">{brand.name}</span>
      )}
    </span>
  );
}
