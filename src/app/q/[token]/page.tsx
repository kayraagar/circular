import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/lib/context";
import { formatDateTime, formatRange, formatTime } from "@/lib/datetime";
import { PASS_PURPOSE_LABELS, PASS_STATE_MESSAGES } from "@/modules/passes/rules";
import { resolveStaffPass, type StaffPassView } from "@/modules/passes/service";
import { BrandMark } from "@/components/ui/brand-mark";
import { buttonClass } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/primitives";
import { RedeemForm } from "./redeem-form";

export const metadata: Metadata = {
  title: "QR doğrulama",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const RECENT_MS = 3 * 60 * 1000;
type Tone = "success" | "warn" | "danger";

function Shell({ tenantName, children, footer }: { tenantName?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-dvh px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-md">
        <header className="flex items-center justify-between gap-3">
          <BrandMark size={20} />
          {tenantName && <span className="truncate font-mono text-[11px] text-muted">{tenantName}</span>}
        </header>
        <main className="mt-6 space-y-4">{children}</main>
        {footer && <div className="mt-6">{footer}</div>}
      </div>
    </div>
  );
}

function StatusHero({ tone, eyebrow, title, subtitle }: { tone: Tone; eyebrow: string; title: string; subtitle?: string }) {
  const color = { success: "text-positive border-positive/40", warn: "text-caution border-caution/40", danger: "text-negative border-negative/40" }[tone];
  return (
    <section role="status" className={`card flex items-center gap-4 p-5 animate-enter ${color}`}>
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden className="shrink-0">
        <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeOpacity="0.35" />
        <circle cx="26" cy="26" r="17" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {tone === "success" ? (
          <path d="m19 26.5 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M26 19v9M26 33h.01" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        )}
      </svg>
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1 text-2xl leading-tight font-medium text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
    </section>
  );
}

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="card divide-y divide-line px-5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 py-3">
          <dt className="shrink-0 text-muted">{label}</dt>
          <dd className="text-right text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EntryView({ view, token, userId }: { view: StaffPassView; token: string; userId: string }) {
  const entry = view.entry!;
  const checkIn = entry.checkIn;
  const mineJustNow = !!checkIn && checkIn.byUserId === userId && Date.now() - checkIn.checkedInAt.getTime() < RECENT_MS;

  let tone: Tone = "danger";
  let title: string = view.stateLabel;
  let subtitle: string | undefined = view.state === "VALID" ? undefined : PASS_STATE_MESSAGES[view.state];
  if (view.state === "VALID") {
    tone = "success";
    title = "Geçerli giriş";
    subtitle = "Kişiyi kontrol edip girişi onaylayın.";
  } else if (mineJustNow) {
    tone = "success";
    title = "Giriş onaylandı";
    subtitle = `${checkIn!.admittedCount} kişi · ${formatTime(checkIn!.checkedInAt)}`;
  } else if (view.state === "USED" && checkIn) {
    tone = "warn";
    title = "Bu QR kullanıldı";
    subtitle = `${formatDateTime(checkIn.checkedInAt)} · ${checkIn.admittedCount} kişi${checkIn.byName ? ` · ${checkIn.byName}` : ""}`;
  } else if (view.state === "NOT_YET_VALID") {
    tone = "warn";
    subtitle = `Giriş ${formatDateTime(entry.opensAt)} itibarıyla açılır.`;
  } else if (view.state === "EXPIRED") {
    subtitle = `Giriş ${formatDateTime(entry.closesAt)} saatinde kapandı.`;
  }

  return (
    <>
      <StatusHero tone={tone} eyebrow={PASS_PURPOSE_LABELS.EVENT_ENTRY} title={title} subtitle={subtitle} />
      <section className="card p-5">
        <p className="eyebrow">Guest</p>
        <p className="mt-2 font-display text-[28px] leading-tight font-medium">{entry.guestName}</p>
        <p className="mt-1 text-sm text-muted">{entry.partySize} kişilik kayıt</p>
        {entry.note && <p className="mt-3 rounded-field border border-line bg-raised px-3 py-2 text-sm">Not: {entry.note}</p>}
      </section>
      {view.state === "VALID" && <RedeemForm token={token} purpose="EVENT_ENTRY" partySize={entry.partySize} />}
      <Details
        rows={[
          ["Etkinlik", entry.eventName],
          ["Mekan", view.venueName ?? "—"],
          ["Zaman", formatRange(entry.startsAt, entry.endsAt)],
          ["Giriş kapanışı", formatDateTime(entry.closesAt)],
          ...(checkIn ? ([["Giriş yöntemi", checkIn.method === "MANUAL" ? "Manuel" : "QR"]] as [string, string][]) : []),
        ]}
      />
    </>
  );
}

function PerkView({ view, token, userId }: { view: StaffPassView; token: string; userId: string }) {
  const perk = view.perk!;
  const last = perk.lastRedemption;
  const mineJustNow = !!last && last.byUserId === userId && Date.now() - last.at.getTime() < RECENT_MS;

  let tone: Tone = "danger";
  let title: string = view.stateLabel;
  let subtitle: string | undefined = view.state === "VALID" ? undefined : PASS_STATE_MESSAGES[view.state];
  if (view.state === "VALID") {
    tone = "success";
    title = "Geçerli avantaj";
    subtitle = `${perk.remaining} kullanım hakkı kaldı`;
  } else if (mineJustNow) {
    tone = "success";
    title = "Avantaj kullanıldı";
    subtitle = `${formatTime(last!.at)} · kalan hak ${perk.remaining}`;
  } else if (view.state === "USED" || view.state === "LIMIT_REACHED" || view.state === "NOT_YET_VALID") {
    tone = "warn";
  }

  return (
    <>
      <StatusHero tone={tone} eyebrow={PASS_PURPOSE_LABELS.PERK_REDEMPTION} title={title} subtitle={subtitle} />
      {view.state === "VALID" && mineJustNow && (
        <FormAlert tone="success">Az önce {formatTime(last!.at)} saatinde bir kullanım onayladınız.</FormAlert>
      )}
      <section className="card p-5">
        <p className="eyebrow">Avantaj</p>
        <p className="mt-2 font-display text-[26px] leading-tight font-medium">{perk.perkName}</p>
        <p className="mt-1 text-sm text-muted">{perk.holder}</p>
        {perk.description && <p className="mt-3 text-sm">{perk.description}</p>}
        {perk.terms && <p className="mt-2 text-xs leading-relaxed text-muted">Koşullar: {perk.terms}</p>}
      </section>
      {view.state === "VALID" && <RedeemForm token={token} purpose="PERK_REDEMPTION" />}
      <Details
        rows={[
          ["Geçerli mekan", view.venueName ?? "Tüm mekanlar"],
          ["Kalan hak", `${perk.remaining} / ${perk.limit}`],
          ["Son geçerlilik", perk.validUntil ? formatDateTime(perk.validUntil) : "Süre sınırı yok"],
          ...(last ? ([["Son kullanım", `${formatDateTime(last.at)}${last.byName ? ` · ${last.byName}` : ""}`]] as [string, string][]) : []),
        ]}
      />
    </>
  );
}

/**
 * QR okutulunca açılan adres. Yetkili personel doğrulama ekranını görür;
 * oturumu olmayan veya bu işletmenin üyesi olmayan herkes müşterinin pass sayfasına yönlenir.
 */
export default async function ScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession();
  if (!session) redirect(`/pass/${encodeURIComponent(token)}`);

  const res = await resolveStaffPass(session.userId, token);
  if (res.kind === "invalid") notFound();
  if (res.kind === "outsider") redirect(`/pass/${encodeURIComponent(token)}`);

  if (res.kind === "forbidden") {
    return (
      <Shell tenantName={res.tenantName} footer={<Link href="/" className={buttonClass("secondary", "md", "w-full")}>Panele dön</Link>}>
        <StatusHero tone="danger" eyebrow="Doğrulama" title="Yetkiniz yok" subtitle={res.message} />
      </Shell>
    );
  }

  const { view } = res;
  const backHref = view.purpose === "EVENT_ENTRY" ? `/door/${view.entry!.eventId}` : "/redeem";
  const canGoBack = view.purpose === "EVENT_ENTRY" ? res.role === "DOOR" || res.role === "OWNER_ADMIN" : res.role === "WAITER" || res.role === "OWNER_ADMIN";

  return (
    <Shell
      tenantName={res.tenantName}
      footer={
        <div className="space-y-3 text-center">
          <p className="text-xs text-muted">Sonraki QR için telefon kamerasıyla okutun.</p>
          {canGoBack && (
            <Link href={backHref} className={buttonClass("secondary", "md", "w-full")}>
              {view.purpose === "EVENT_ENTRY" ? "Kapı ekranına dön" : "Avantaj doğrulama ekranı"}
            </Link>
          )}
        </div>
      }
    >
      {view.purpose === "EVENT_ENTRY" ? (
        <EntryView view={view} token={token} userId={session.userId} />
      ) : (
        <PerkView view={view} token={token} userId={session.userId} />
      )}
    </Shell>
  );
}
