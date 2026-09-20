"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import {
  BADGE_LABELS,
  formatPrice,
  readableForeground,
  withAlpha,
  type Badge,
  type FontPair,
  type MenuCategoryView,
  type MenuConfigView,
  type MenuItemView,
} from "@/modules/menu/theme";
import { SAMPLE_CATEGORIES } from "@/modules/menu/templates";

/**
 * Menü görünümü: panelde canlı önizleme, müşteriye açık menüde gerçek menü.
 * Salt görüntüdür; hiçbir veri yazmaz. Panelde menü boşsa şablon farkları görünsün diye
 * örnek içerik kullanılabilir (allowSample); müşteriye açık menüde bu kapalıdır.
 */

const FONT_STACKS: Record<FontPair, { heading: string; body: string; upper: boolean; tracking: string }> = {
  GROTESK: { heading: "var(--font-display)", body: "var(--font-sans)", upper: false, tracking: "-0.02em" },
  SERIF: { heading: "var(--font-menu-serif), Georgia, serif", body: "var(--font-sans)", upper: false, tracking: "-0.01em" },
  CONDENSED: { heading: "var(--font-menu-condensed), 'Arial Narrow', sans-serif", body: "var(--font-sans)", upper: true, tracking: "0.01em" },
  MONO: { heading: "var(--font-mono)", body: "var(--font-sans)", upper: false, tracking: "-0.01em" },
};

const RADIUS = { SHARP: 2, SOFT: 10, ROUND: 18 } as const;

type Tokens = {
  fg: string;
  muted: string;
  line: string;
  surface: string;
  accent: string;
  accentFg: string;
  radius: number;
  compact: boolean;
  fonts: (typeof FONT_STACKS)[FontPair];
  config: MenuConfigView;
};

function tokensFor(config: MenuConfigView): Tokens {
  const fg = config.textColor ?? readableForeground(config.backgroundColor);
  return {
    fg,
    muted: withAlpha(fg, 0.62),
    line: withAlpha(fg, 0.13),
    surface: withAlpha(fg, 0.055),
    accent: config.accentColor,
    accentFg: readableForeground(config.accentColor),
    radius: RADIUS[config.cornerStyle],
    compact: config.density === "COMPACT",
    fonts: FONT_STACKS[config.fontPair],
    config,
  };
}

function headingStyle(t: Tokens, size: number): CSSProperties {
  return {
    fontFamily: t.fonts.heading,
    fontSize: size,
    letterSpacing: t.fonts.tracking,
    textTransform: t.fonts.upper ? "uppercase" : undefined,
    lineHeight: 1.15,
  };
}

/** Kart kabı: şablonun yüzey stiline göre (sade / çerçeveli / dolu). */
function surfaceStyle(t: Tokens): CSSProperties {
  if (t.config.surfaceStyle === "FILLED") return { background: t.surface, borderRadius: t.radius };
  if (t.config.surfaceStyle === "OUTLINE") return { border: `1px solid ${t.line}`, borderRadius: t.radius };
  return {};
}

// ─────────────────────────────────────────────── Parçalar

/** Fotoğraf yoksa gösterilen yer tutucu: ince çizgili dairesel motif. */
export function CircleMotif({ color, size = 28 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} aria-hidden>
      <g fill="none" stroke={color} strokeWidth="1.4">
        <circle cx="36" cy="36" r="33" strokeOpacity="0.3" />
        <circle cx="36" cy="36" r="23" strokeOpacity="0.7" />
        <circle cx="36" cy="36" r="12" strokeOpacity="0.45" strokeDasharray="2 5" />
      </g>
    </svg>
  );
}

function Photo({ src, t, ratio, radius, label }: { src: string | null; t: Tokens; ratio: string; radius?: number; label: string }) {
  const style: CSSProperties = { aspectRatio: ratio, borderRadius: radius ?? t.radius, background: t.surface };
  if (!src) {
    return (
      <div className="flex w-full items-center justify-center" style={style}>
        <CircleMotif color={t.fg} />
      </div>
    );
  }
  return <div role="img" aria-label={label} className="w-full bg-cover bg-center" style={{ ...style, backgroundImage: `url("${src}")` }} />;
}

function BadgeList({ badges, t }: { badges: Badge[]; t: Tokens }) {
  if (badges.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {badges.map((b) => (
        <span
          key={b}
          className="rounded-full px-1.5 py-[1px] text-[10px] leading-4 font-medium"
          style={b === "CHEF" || b === "NEW" ? { background: t.accent, color: t.accentFg } : { border: `1px solid ${t.line}`, color: t.muted }}
        >
          {BADGE_LABELS[b]}
        </span>
      ))}
    </span>
  );
}

function Price({ value, t, chip = false }: { value: number; t: Tokens; chip?: boolean }) {
  const text = formatPrice(value, t.config.priceStyle);
  if (chip) {
    return (
      <span className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums" style={{ background: t.accent, color: t.accentFg }}>
        {text}
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[14px] font-medium tabular-nums" style={{ color: t.config.themeStyle === "CARDS" ? t.accent : t.fg }}>
      {text}
    </span>
  );
}

function Description({ item, t }: { item: MenuItemView; t: Tokens }) {
  if (!t.config.showDescriptions || !item.description) return null;
  return (
    <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: t.muted }}>
      {item.description}
    </p>
  );
}

// ─────────────────────────────────────────────── Düzenler

function ItemRow({ item, t }: { item: MenuItemView; t: Tokens }) {
  const style = t.config.themeStyle;
  const showPhoto = t.config.showImages;
  const pad = t.compact ? 10 : 14;

  if (style === "GRID") {
    return (
      <article className="overflow-hidden" style={{ ...surfaceStyle(t), padding: t.config.surfaceStyle === "FLAT" ? 0 : 6 }}>
        {showPhoto && <Photo src={item.imageSrc} t={t} ratio="4 / 3" label={item.name} />}
        <div className="px-1 pt-2 pb-1">
          <p className="text-[13px] leading-snug font-medium">{item.name}</p>
          <Description item={item} t={t} />
          <div className="mt-1 flex items-center justify-between gap-2">
            <Price value={item.price} t={t} />
          </div>
          <BadgeList badges={item.badges} t={t} />
        </div>
      </article>
    );
  }

  if (style === "CARDS" || style === "BOLD") {
    return (
      <article className="flex gap-3" style={{ ...surfaceStyle(t), padding: t.config.surfaceStyle === "FLAT" ? `${pad / 2}px 0` : pad }}>
        {showPhoto && style === "CARDS" && (
          <div className="w-[72px] shrink-0">
            <Photo src={item.imageSrc} t={t} ratio="1 / 1" radius={Math.max(2, t.radius - 4)} label={item.name} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[15px] leading-snug font-semibold" style={style === "BOLD" ? headingStyle(t, 17) : undefined}>
              {item.name}
            </p>
            {style === "BOLD" && <Price value={item.price} t={t} chip />}
          </div>
          <Description item={item} t={t} />
          <BadgeList badges={item.badges} t={t} />
          {style === "CARDS" && (
            <div className="mt-1.5">
              <Price value={item.price} t={t} />
            </div>
          )}
        </div>
        {showPhoto && style === "BOLD" && item.imageSrc && (
          <div className="w-[60px] shrink-0">
            <Photo src={item.imageSrc} t={t} ratio="1 / 1" label={item.name} />
          </div>
        )}
      </article>
    );
  }

  if (style === "CLASSIC") {
    return (
      <article style={{ padding: `${t.compact ? 6 : 9}px 0` }}>
        <div className="flex items-baseline gap-2">
          {showPhoto && item.imageSrc && (
            <div className="w-10 shrink-0 self-center">
              <Photo src={item.imageSrc} t={t} ratio="1 / 1" label={item.name} />
            </div>
          )}
          <span className="text-[16px]" style={{ fontFamily: t.fonts.heading }}>
            {item.name}
          </span>
          <span aria-hidden className="min-w-4 flex-1 translate-y-[-4px] border-b border-dotted" style={{ borderColor: withAlpha(t.fg, 0.35) }} />
          <Price value={item.price} t={t} />
        </div>
        {t.config.showDescriptions && item.description && (
          <p className="mt-0.5 text-[12px] italic" style={{ color: t.muted, fontFamily: t.fonts.heading }}>
            {item.description}
          </p>
        )}
        <BadgeList badges={item.badges} t={t} />
      </article>
    );
  }

  if (style === "EDITORIAL") {
    return (
      <article style={{ padding: `${t.compact ? 10 : 16}px 0`, borderTop: `1px solid ${t.line}` }}>
        <div className="flex items-baseline justify-between gap-3">
          <p style={headingStyle(t, 20)}>{item.name}</p>
          <Price value={item.price} t={t} />
        </div>
        <Description item={item} t={t} />
        <BadgeList badges={item.badges} t={t} />
      </article>
    );
  }

  // MINIMAL
  return (
    <article
      className="flex items-center gap-3"
      style={{ padding: `${t.compact ? 8 : 12}px 0`, ...surfaceStyle(t), ...(t.config.surfaceStyle === "FLAT" ? {} : { padding: pad }) }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px]">{item.name}</p>
          <Price value={item.price} t={t} />
        </div>
        <Description item={item} t={t} />
        <BadgeList badges={item.badges} t={t} />
      </div>
      {showPhoto && item.imageSrc && (
        <div className="w-11 shrink-0">
          <Photo src={item.imageSrc} t={t} ratio="1 / 1" label={item.name} />
        </div>
      )}
    </article>
  );
}

function CategorySection({ category, t, sectionRef }: { category: MenuCategoryView; t: Tokens; sectionRef: (el: HTMLElement | null) => void }) {
  const style = t.config.themeStyle;
  const centered = style === "CLASSIC";
  const listGap = t.compact ? 8 : 12;

  const heading =
    style === "CLASSIC" ? (
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-px flex-1" style={{ background: withAlpha(t.fg, 0.3) }} />
        <h2 style={headingStyle(t, 20)}>{category.name}</h2>
        <span aria-hidden className="h-px flex-1" style={{ background: withAlpha(t.fg, 0.3) }} />
      </div>
    ) : style === "MINIMAL" ? (
      <h2 className="text-[11px] font-medium tracking-[0.18em] uppercase" style={{ color: t.muted }}>
        {category.name}
      </h2>
    ) : (
      <h2 style={headingStyle(t, style === "BOLD" ? 26 : style === "EDITORIAL" ? 24 : 19)}>{category.name}</h2>
    );

  return (
    <section ref={sectionRef} className="scroll-mt-14">
      <div className={centered ? "text-center" : undefined}>
        {heading}
        {category.description && (
          <p className="mt-1 text-[12px]" style={{ color: t.muted }}>
            {category.description}
          </p>
        )}
      </div>
      <div
        className={style === "GRID" ? "mt-3 grid grid-cols-2" : "mt-3 flex flex-col"}
        style={{ gap: style === "MINIMAL" && t.config.surfaceStyle === "FLAT" ? 0 : listGap }}
      >
        {category.items.map((item, index) => (
          <div
            key={item.id}
            style={style === "MINIMAL" && t.config.surfaceStyle === "FLAT" && index > 0 ? { borderTop: `1px solid ${t.line}` } : undefined}
          >
            <ItemRow item={item} t={t} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Featured({ items, t }: { items: MenuItemView[]; t: Tokens }) {
  if (!t.config.showFeatured || items.length === 0) return null;

  if (t.config.themeStyle === "EDITORIAL") {
    return (
      <section className="space-y-5">
        {items.slice(0, 2).map((item) => (
          <article key={item.id}>
            <Photo src={item.imageSrc} t={t} ratio="16 / 10" label={item.name} />
            <p className="mt-3 text-[11px] tracking-[0.16em] uppercase" style={{ color: t.accent }}>
              Öne çıkan
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <p style={headingStyle(t, 26)}>{item.name}</p>
              <Price value={item.price} t={t} />
            </div>
            <Description item={item} t={t} />
          </article>
        ))}
      </section>
    );
  }

  return (
    <section>
      <h2 style={headingStyle(t, 16)}>Öne çıkanlar</h2>
      <div className="-mx-5 mt-3 flex snap-x gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        {items.map((item) => (
          <article key={item.id} className="w-[150px] shrink-0 snap-start" style={{ ...surfaceStyle(t), padding: t.config.surfaceStyle === "FLAT" ? 0 : 6 }}>
            <Photo src={item.imageSrc} t={t} ratio="4 / 3" label={item.name} />
            <div className="px-1 pt-2 pb-1">
              <p className="line-clamp-2 text-[13px] leading-snug font-medium">{item.name}</p>
              <div className="mt-1">
                <Price value={item.price} t={t} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────── Dışa açık bileşenler

export function PhoneFrame({ children, background, overlay }: { children: ReactNode; background: string; overlay?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[38px] border border-line bg-raised p-2.5 shadow-[0_24px_80px_rgb(0_0_0/0.55)]">
      <div className="relative overflow-hidden rounded-[30px]" style={{ background }}>
        <div className="pointer-events-none absolute top-2.5 left-1/2 z-20 h-1.5 w-16 -translate-x-1/2 rounded-full bg-black/25" />
        <div data-preview-scroll className="relative h-[600px] overflow-y-auto overscroll-contain">
          {children}
        </div>
        {overlay}
      </div>
    </div>
  );
}

export function MenuPreview({
  config,
  categories,
  title,
  forceSample = false,
  allowSample = true,
  interactive = true,
  showSampleNotice = true,
}: {
  config: MenuConfigView;
  categories: MenuCategoryView[];
  title: string;
  forceSample?: boolean;
  /** false: menü boşsa örnek içerik gösterilmez (müşteriye açık menü). */
  allowSample?: boolean;
  interactive?: boolean;
  showSampleNotice?: boolean;
}) {
  const t = tokensFor(config);
  const sections = useRef(new Map<string, HTMLElement>());

  const real = categories
    .map((c) => ({ ...c, items: c.items.filter((i) => i.isAvailable) }))
    .filter((c) => c.items.length > 0);
  const usingSample = allowSample && (forceSample || real.length === 0);
  const visible = usingSample ? SAMPLE_CATEGORIES : real;
  const featured = visible.flatMap((c) => c.items.filter((i) => i.isFeatured));
  const leftHeader = config.headerAlign === "LEFT";

  return (
    <div style={{ color: t.fg, fontFamily: t.fonts.body, background: config.backgroundColor }} className="min-h-full">
      {config.coverSrc && (
        <div className="relative">
          <div role="img" aria-label="Kapak görseli" className="aspect-[16/10] w-full bg-cover bg-center" style={{ backgroundImage: `url("${config.coverSrc}")` }} />
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-16" style={{ background: `linear-gradient(to bottom, transparent, ${config.backgroundColor})` }} />
        </div>
      )}

      <header className={`px-5 ${config.coverSrc ? "-mt-10" : "pt-10"} relative ${leftHeader ? "flex items-center gap-3 text-left" : "flex flex-col items-center text-center"}`}>
        {config.logoSrc ? (
          <div
            role="img"
            aria-label="İşletme logosu"
            className="size-16 shrink-0 rounded-full bg-cover bg-center"
            style={{ backgroundImage: `url("${config.logoSrc}")`, boxShadow: `0 0 0 3px ${config.backgroundColor}, 0 0 0 4px ${t.line}` }}
          />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full" style={{ background: config.coverSrc ? config.backgroundColor : undefined }}>
            <CircleMotif color={t.fg} size={60} />
          </div>
        )}
        <div className={leftHeader ? "min-w-0" : "mt-3"}>
          <p style={headingStyle(t, 21)}>{title}</p>
          {config.tagline && (
            <p className="mt-1 text-[12px]" style={{ color: t.muted }}>
              {config.tagline}
            </p>
          )}
        </div>
      </header>

      {usingSample && showSampleNotice && (
        <p className="mx-5 mt-4 rounded-full px-3 py-1 text-center text-[11px]" style={{ background: t.surface, color: t.muted }}>
          Örnek içerik · ürün eklediğinizde kendi menünüz görünür
        </p>
      )}

      {config.showCategoryNav && visible.length > 1 && (
        <nav
          aria-label="Kategoriler"
          className="sticky top-0 z-10 mt-4 flex gap-2 overflow-x-auto px-5 py-2.5 [scrollbar-width:none]"
          style={{ background: withAlpha(config.backgroundColor, 0.92), borderBottom: `1px solid ${t.line}` }}
        >
          {visible.map((c, i) => {
            const chipStyle: CSSProperties =
              i === 0 ? { background: t.accent, color: t.accentFg, borderRadius: 999 } : { border: `1px solid ${t.line}`, color: t.muted, borderRadius: 999 };
            return interactive ? (
              <button
                key={c.id}
                type="button"
                className="shrink-0 px-3 py-1 text-[12px] whitespace-nowrap"
                style={chipStyle}
                onClick={() => sections.current.get(c.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                {c.name}
              </button>
            ) : (
              <span key={c.id} className="shrink-0 px-3 py-1 text-[12px] whitespace-nowrap" style={chipStyle}>
                {c.name}
              </span>
            );
          })}
        </nav>
      )}

      <div className="space-y-8 px-5 pt-5 pb-10">
        {visible.length === 0 && (
          <p className="rounded-2xl border px-4 py-8 text-center text-[13px] leading-relaxed" style={{ borderColor: t.line, color: t.muted }}>
            Menü yakında burada olacak.
          </p>
        )}
        <Featured items={featured} t={t} />
        {visible.map((category) => (
          <CategorySection
            key={category.id}
            category={category}
            t={t}
            sectionRef={(el) => {
              if (el) sections.current.set(category.id, el);
              else sections.current.delete(category.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}
