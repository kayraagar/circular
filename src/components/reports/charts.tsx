import type { ReactNode } from "react";

/**
 * Rapor grafikleri — harici kütüphane yok, hepsi SVG.
 * Renkler düşük doygunlukta ve anlam taşır; sayılar her zaman metin olarak da okunabilir.
 */

export const CHART_COLORS = ["#93d3aa", "#e2c27f", "#a3b8d8", "#c9a6cf", "#f0908a", "#a6a6a6"] as const;

const nf = new Intl.NumberFormat("tr-TR");
export const formatNumber = (n: number) => nf.format(n);
export const formatPercent = (ratio: number) => `%${Math.round(ratio * 100)}`;

function Empty({ height, text = "Bu dönemde veri yok" }: { height: number; text?: string }) {
  return (
    <div className="flex items-center justify-center text-[13px] text-muted" style={{ height }}>
      {text}
    </div>
  );
}

export type Point = { label: string; value: number };

/** Günlük seri: yumuşak alan grafiği. */
export function AreaChart({
  id,
  points,
  color = CHART_COLORS[0],
  height = 180,
  ariaLabel,
}: {
  id: string;
  points: Point[];
  color?: string;
  height?: number;
  ariaLabel: string;
}) {
  const max = Math.max(...points.map((p) => p.value), 0);
  if (max === 0 || points.length < 2) return <Empty height={height} />;

  const W = 720;
  const H = height;
  const padY = 16;
  const innerH = H - padY * 2;
  const step = W / (points.length - 1);
  const x = (i: number) => i * step;
  const y = (v: number) => padY + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = points[points.length - 1];

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} className="block h-[--chart-h] w-full" style={{ "--chart-h": `${H}px` } as React.CSSProperties}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((r) => (
          <line key={r} x1="0" x2={W} y1={padY + innerH * r} y2={padY + innerH * r} stroke="var(--color-line)" strokeWidth="1" strokeDasharray={r === 1 ? undefined : "2 8"} />
        ))}
        <path d={area} fill={`url(#${id}-fill)`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="3.5" fill={color} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-2 flex justify-between text-[12px] text-muted" data-numeric>
        <span>{points[0].label}</span>
        <span>
          en yüksek {formatNumber(max)} · {last.label} {formatNumber(last.value)}
        </span>
        <span>{last.label}</span>
      </figcaption>
    </figure>
  );
}

/** Kategori dağılımı: yuvarlatılmış dikey sütunlar. */
export function BarChart({
  points,
  color = CHART_COLORS[0],
  height = 150,
  labelEvery = 1,
  ariaLabel,
  unit = "",
}: {
  points: Point[];
  color?: string;
  height?: number;
  labelEvery?: number;
  ariaLabel: string;
  unit?: string;
}) {
  const max = Math.max(...points.map((p) => p.value), 0);
  if (max === 0) return <Empty height={height} />;
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]);

  return (
    <figure className="m-0">
      <div role="img" aria-label={ariaLabel} className="flex items-end gap-[3px]" style={{ height }}>
        {points.map((p, i) => {
          const ratio = p.value / max;
          return (
            <div key={`${p.label}-${i}`} className="group flex h-full flex-1 flex-col justify-end" title={`${p.label}: ${formatNumber(p.value)}${unit ? ` ${unit}` : ""}`}>
              <span
                className="block w-full rounded-t-[4px] transition-opacity"
                style={{
                  height: `${Math.max(ratio * 100, p.value > 0 ? 3 : 1)}%`,
                  background: p.value > 0 ? color : "var(--color-line)",
                  opacity: p.value > 0 ? (p === peak ? 1 : 0.55) : 1,
                }}
              />
            </div>
          );
        })}
      </div>
      <figcaption className="mt-2 flex justify-between text-[11px] text-muted" data-numeric>
        {points
          .map((p, i) => ({ p, i }))
          .filter(({ i }) => i % labelEvery === 0)
          .map(({ p, i }) => (
            <span key={`${p.label}-${i}`}>{p.label}</span>
          ))}
      </figcaption>
    </figure>
  );
}

/** Oran satırları: etiket, sayı ve dolan çubuk. */
export function RatioRows({
  rows,
  color = CHART_COLORS[0],
  emptyText,
}: {
  rows: { label: string; sub?: string; value: number; valueLabel: string; ratio?: number }[];
  color?: string;
  emptyText?: string;
}) {
  if (rows.length === 0) return <Empty height={120} text={emptyText} />;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((row, i) => {
        const ratio = row.ratio ?? row.value / max;
        return (
          <li key={`${row.label}-${i}`}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-fg">{row.label}</span>
              <span className="shrink-0 text-muted" data-numeric>
                {row.valueLabel}
              </span>
            </div>
            <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={`${row.label}: ${row.valueLabel}`}>
              <span className="block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(2, Math.round(ratio * 100))}%`, background: color }} />
            </span>
            {row.sub && <span className="mt-1 block text-[12px] text-muted">{row.sub}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Pay dağılımı: ince halka + açıklama listesi. */
export function Donut({ slices, size = 132, centerValue, centerLabel }: { slices: Point[]; size?: number; centerValue: string; centerLabel: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (total === 0) return <Empty height={size} />;
  const r = 54;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 132 132" width={size} height={size} role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(", ")} className="shrink-0">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--color-line)" strokeWidth="12" />
        {slices.map((s, i) => {
          const length = (s.value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const el = (
            <circle
              key={s.label}
              cx="66"
              cy="66"
              r={r}
              fill="none"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth="12"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform="rotate(-90 66 66)"
            />
          );
          offset += length;
          return el;
        })}
        <text x="66" y="62" textAnchor="middle" className="fill-fg font-display text-[20px] font-medium" data-numeric>
          {centerValue}
        </text>
        <text x="66" y="80" textAnchor="middle" className="fill-muted text-[10px]">
          {centerLabel}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-start gap-2">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
              <span className="text-fg">{s.label}</span>
            </span>
            <span className="shrink-0 text-muted" data-numeric>
              {formatNumber(s.value)} · {formatPercent(s.value / total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** KPI kutusu: büyük sayı, önceki döneme göre değişim ve küçük seri. */
export function KpiTile({
  label,
  value,
  previous,
  detail,
  points,
  color = CHART_COLORS[0],
}: {
  label: string;
  value: number;
  previous?: number;
  detail?: ReactNode;
  points?: Point[];
  color?: string;
}) {
  // Önceki dönem çok küçükken yüzde yanıltıcı olur (1 → 69 "%6800" gibi); o durumda sayıyı gösteririz.
  const comparable = previous !== undefined && previous >= 5;
  const change = comparable ? (value - previous!) / previous! : null;
  const previousNote = previous !== undefined && !comparable ? `önceki dönem ${formatNumber(previous)}` : null;
  const max = points ? Math.max(...points.map((p) => p.value), 0) : 0;
  const W = 120;
  const H = 28;
  const line =
    points && max > 0 && points.length > 1
      ? points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * W).toFixed(1)},${(H - (p.value / max) * (H - 4) - 2).toFixed(1)}`).join(" ")
      : null;

  return (
    <div className="card flex flex-col gap-3 p-5">
      <p className="font-display text-[13px] font-medium tracking-tight text-muted">{label}</p>
      <div className="flex items-end justify-between gap-3">
        <p className="font-display text-[34px] leading-none font-medium" data-numeric>
          {formatNumber(value)}
        </p>
        {line && (
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden className="shrink-0 opacity-80">
            <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        {change !== null && (
          <span
            className={`inline-flex h-5 items-center rounded-full border px-2 ${
              change > 0 ? "border-positive/30 text-positive" : change < 0 ? "border-negative/30 text-negative" : "border-line"
            }`}
            data-numeric
          >
            {change > 0 ? "+" : ""}
            {Math.round(change * 100)}%
          </span>
        )}
        {previousNote && <span>{previousNote}</span>}
        {detail && <span className="min-w-0">{detail}</span>}
      </div>
    </div>
  );
}
