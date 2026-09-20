/**
 * Check-in halkası: Circular'ın dairesel motifi (dış ince halka + iç noktalı yörünge)
 * üzerinde, giriş yapan kişi oranına göre dolan ince yeşil çizgi ve hafif ışıma.
 * Animasyon yalnızca değer değişiminde yumuşak geçiştir; azaltılmış hareket tercihinde kapanır.
 */

const GREEN = "#2E8B57";

export function CheckInRing({
  id,
  ratio,
  size = 112,
  label,
  caption,
}: {
  /** Sayfada benzersiz; SVG filtre kimliği için */
  id: string;
  ratio: number;
  size?: number;
  label: string;
  caption?: string;
}) {
  const value = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const center = size / 2;
  const track = center - 8;
  const circumference = 2 * Math.PI * track;
  const filterId = `checkin-glow-${id}`;

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <defs>
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Motif: dış ince halka ve iç noktalı yörünge */}
        <circle cx={center} cy={center} r={center - 1.5} fill="none" stroke="var(--color-line)" strokeWidth="1" />
        <circle cx={center} cy={center} r={track - 13} fill="none" stroke="var(--color-line-strong)" strokeWidth="1" strokeDasharray="1.5 5" />
        {/* İz */}
        <circle cx={center} cy={center} r={track} fill="none" stroke="var(--color-line)" strokeWidth="2" />
        {value > 0 && (
          <circle
            cx={center}
            cy={center}
            r={track}
            fill="none"
            stroke={GREEN}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${circumference * value} ${circumference}`}
            transform={`rotate(-90 ${center} ${center})`}
            filter={`url(#${filterId})`}
            className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
          />
        )}
      </svg>
      <span className="absolute flex flex-col items-center leading-none" aria-hidden>
        <span className="font-display text-[22px] font-medium text-fg" data-numeric>
          %{Math.round(value * 100)}
        </span>
        {caption && <span className="mt-1 font-mono text-[10px] tracking-wider text-muted uppercase">{caption}</span>}
      </span>
    </span>
  );
}
