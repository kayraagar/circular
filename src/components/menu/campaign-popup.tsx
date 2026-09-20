"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { MenuCampaignView } from "@/modules/menu/campaign";
import { readableForeground, withAlpha, type FontPair, type MenuConfigView } from "@/modules/menu/theme";

/**
 * Menüdeki kampanya popup'ı.
 * - Canlı (müşteriye açık menü): belirlenen gecikmeden sonra açılır; kapatan kişiye 24 saat tekrar gösterilmez.
 * - Önizleme (panel): telefon çerçevesinin üstünde gösterilir, bağlantı gezinmez.
 * Renk, köşe ve yazı tipi menü tasarımından gelir.
 */

const RADIUS = { SHARP: 4, SOFT: 18, ROUND: 28 } as const;
const HEADING: Record<FontPair, string> = {
  GROTESK: "var(--font-display)",
  SERIF: "var(--font-menu-serif), Georgia, serif",
  CONDENSED: "var(--font-menu-condensed), 'Arial Narrow', sans-serif",
  MONO: "var(--font-mono)",
};
const DISMISS_MS = 24 * 3600 * 1000;

function PopupCard({
  campaign,
  config,
  href,
  titleId,
  preview,
  onClose,
  onCta,
}: {
  campaign: MenuCampaignView;
  config: MenuConfigView;
  href: string;
  titleId: string;
  preview: boolean;
  onClose: () => void;
  onCta?: () => void;
}) {
  const fg = config.textColor ?? readableForeground(config.backgroundColor);
  const accentFg = readableForeground(config.accentColor);
  const radius = RADIUS[config.cornerStyle];
  const ctaStyle: CSSProperties = { background: config.accentColor, color: accentFg, borderRadius: Math.max(8, radius - 6) };
  const ctaClass = "mt-5 flex h-12 w-full items-center justify-center px-4 text-[15px] font-semibold";

  return (
    <div
      className="w-full overflow-hidden text-left shadow-[0_24px_80px_rgb(0_0_0/0.45)]"
      style={{ background: config.backgroundColor, color: fg, borderRadius: radius, border: `1px solid ${withAlpha(fg, 0.14)}`, fontFamily: "var(--font-sans)" }}
    >
      {campaign.imageSrc && (
        <div role="img" aria-label="Kampanya görseli" className="aspect-[4/3] w-full bg-cover bg-center" style={{ backgroundImage: `url("${campaign.imageSrc}")` }} />
      )}
      <div className="p-5">
        {campaign.perkName && (
          <span className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: config.accentColor, color: accentFg }}>
            İkram · {campaign.perkName}
          </span>
        )}
        <h2
          id={titleId}
          className="mt-3 text-[23px] leading-tight"
          style={{ fontFamily: HEADING[config.fontPair], textTransform: config.fontPair === "CONDENSED" ? "uppercase" : undefined }}
        >
          {campaign.title || "Kampanya başlığı"}
        </h2>
        {campaign.description && (
          <p className="mt-2 text-[14px] leading-relaxed" style={{ color: withAlpha(fg, 0.72) }}>
            {campaign.description}
          </p>
        )}
        {preview ? (
          <span className={ctaClass} style={ctaStyle}>
            {campaign.ctaLabel}
          </span>
        ) : (
          <Link href={href} className={ctaClass} style={ctaStyle} onClick={onCta}>
            {campaign.ctaLabel}
          </Link>
        )}
        <button type="button" onClick={onClose} className="mt-2 h-10 w-full text-[13px]" style={{ color: withAlpha(fg, 0.62) }}>
          Şimdi değil
        </button>
        <p className="mt-1 text-center text-[11px] leading-relaxed" style={{ color: withAlpha(fg, 0.5) }}>
          Kısa bir formla üye olursunuz; iletişim tercihleriniz ayrıca sorulur.
        </p>
      </div>
    </div>
  );
}

/** Panel önizlemesi: telefon çerçevesinin üzerinde. */
export function CampaignPopupPreview({ campaign, config }: { campaign: MenuCampaignView; config: MenuConfigView }) {
  const titleId = useId();
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="absolute right-3 bottom-3 z-30 rounded-full bg-black/70 px-3 py-1.5 text-[12px] text-white"
      >
        Popup'ı göster
      </button>
    );
  }
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <PopupCard campaign={campaign} config={config} href="#" titleId={titleId} preview onClose={() => setHidden(true)} />
    </div>
  );
}

/** Müşteriye açık menüde gerçek popup. */
export function CampaignPopup({
  campaign,
  config,
  href,
  storageKey,
}: {
  campaign: MenuCampaignView;
  config: MenuConfigView;
  href: string;
  storageKey: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let dismissedAt = 0;
    try {
      dismissedAt = Number(window.localStorage.getItem(storageKey) ?? 0);
    } catch {
      // Depolama kapalıysa (gizli sekme vb.) popup yalnızca bu sayfa açılışında gösterilir.
    }
    if (Date.now() - dismissedAt < DISMISS_MS) return;
    const timer = window.setTimeout(() => setOpen(true), campaign.delaySeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [storageKey, campaign.delaySeconds]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const remember = () => {
    try {
      window.localStorage.setItem(storageKey, String(Date.now()));
    } catch {
      // yok sayılır
    }
  };
  const close = () => {
    remember();
    setOpen(false);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm bg-transparent p-0 open:animate-enter"
    >
      <PopupCard campaign={campaign} config={config} href={href} titleId={titleId} preview={false} onClose={close} onCta={remember} />
    </dialog>
  );
}
