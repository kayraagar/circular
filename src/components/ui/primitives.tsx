import Link from "next/link";
import type { ReactNode } from "react";
import { initials } from "@/lib/normalize";
import { IconAlert, IconArrowLeft, IconCheck } from "./icons";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
  as: Heading = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <Heading className="text-[15px] font-medium text-fg">{title}</Heading>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-8">
      {back && (
        <Link
          href={back.href}
          className="mb-4 inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted transition-colors hover:text-fg"
        >
          <IconArrowLeft size={14} /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="text-[28px] leading-[1.1] font-medium text-balance sm:text-[34px]">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

type Tone = "neutral" | "muted" | "positive" | "caution" | "negative" | "solid";
const tones: Record<Tone, string> = {
  neutral: "border-line text-fg",
  muted: "border-line text-muted",
  positive: "border-positive/30 bg-positive/[0.06] text-positive",
  caution: "border-caution/30 bg-caution/[0.06] text-caution",
  negative: "border-negative/30 bg-negative/[0.06] text-negative",
  solid: "border-fg bg-fg text-bg",
};

export function Badge({ children, tone = "neutral", mono = false }: { children: ReactNode; tone?: Tone; mono?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap ${tones[tone]} ${
        mono ? "font-mono text-[11px] tracking-wide" : ""
      }`}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-raised font-display font-medium text-accent"
    >
      {initials(name)}
    </span>
  );
}

/** Dairesel motifli boş durum. */
export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "px-4 py-8" : "px-6 py-14"}`}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="mb-4 text-line-strong">
        <circle cx="28" cy="28" r="27" fill="none" stroke="currentColor" />
        <circle cx="28" cy="28" r="17" fill="none" stroke="currentColor" strokeDasharray="2 4" />
        <circle cx="28" cy="28" r="3" fill="currentColor" />
      </svg>
      <p className="font-display text-base font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function FormAlert({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-negative/30 bg-negative/[0.06] text-negative",
    success: "border-positive/30 bg-positive/[0.06] text-positive",
    info: "border-line bg-raised text-accent",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-field border px-3.5 py-3 text-sm animate-enter ${styles}`}
    >
      <span className="mt-0.5 shrink-0">{tone === "success" ? <IconCheck size={15} /> : <IconAlert size={15} />}</span>
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  showOptional = true,
  children,
  className = "",
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  showOptional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline gap-1 text-[13px] font-medium text-fg">
        {label}
        {required ? (
          <span className="text-muted" aria-hidden>
            *
          </span>
        ) : showOptional ? (
          <span className="text-xs font-normal text-muted">(opsiyonel)</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-[13px] text-negative">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Field ile eşleşen erişilebilirlik öznitelikleri. */
export function describedBy(id: string, error?: string, hint?: boolean) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

export function Stat({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
}) {
  const inner = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="mt-3 font-display text-[32px] leading-none font-medium" data-numeric>
        {value}
      </p>
      {sub && <p className="mt-2 text-[13px] text-muted">{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-5 transition-colors hover:border-line-strong">
      {inner}
    </Link>
  ) : (
    <div className="card p-5">{inner}</div>
  );
}

/** Kapasite doluluğu — gerçek kayıt verisinden. Kapasite yoksa yalnızca sayı. */
export function RingMeter({ value, max, size = 44 }: { value: number; max: number | null; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const ratio = max ? Math.min(value / max, 1) : 0;
  const label = max ? `${value} / ${max} kişi` : `${value} kişi, kapasite sınırı yok`;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="2" />
        {max ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={ratio >= 1 ? "var(--color-caution)" : "var(--color-fg)"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${c * ratio} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="2" strokeDasharray="1 3" />
        )}
      </svg>
      <span className="absolute font-mono text-[10px] text-accent" data-numeric aria-hidden>
        {max ? `${Math.round(ratio * 100)}%` : value}
      </span>
    </span>
  );
}
