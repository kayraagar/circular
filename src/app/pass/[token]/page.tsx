import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { brand, venueExperienceTitle } from "@/config/brand";
import { formatDateTime, formatRange } from "@/lib/datetime";
import { PASS_PURPOSE_LABELS, PASS_STATE_MESSAGES } from "@/modules/passes/rules";
import { getPublicPassView, type PublicPassView } from "@/modules/passes/service";
import { QrCode } from "@/components/qr-code";
import { BrandMark } from "@/components/ui/brand-mark";
import { Badge } from "@/components/ui/primitives";

type Params = { params: Promise<{ token: string }> };

const loadPass = cache((token: string) => getPublicPassView(token));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const view = await loadPass((await params).token);
  return {
    title: { absolute: view ? venueExperienceTitle(view.venueName) : brand.name },
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

function stateTone(view: PublicPassView) {
  if (view.state === "VALID") return "positive" as const;
  if (view.state === "NOT_YET_VALID") return "neutral" as const;
  if (view.state === "USED") return "caution" as const;
  return "negative" as const;
}

function stateMessage(view: PublicPassView) {
  if (view.state === "VALID" || view.state === "NOT_YET_VALID") return null;
  if (view.state === "USED" && view.usedAt) {
    return view.entry
      ? `Bu QR ile ${formatDateTime(view.usedAt)} tarihinde giriş yapıldı.`
      : `Bu avantajın kullanım hakkı doldu. Son kullanım: ${formatDateTime(view.usedAt)}.`;
  }
  return PASS_STATE_MESSAGES[view.state];
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </div>
  );
}

/** Müşterinin kişisel QR sayfası — mekanın marka alanı ("[Mekan] — Circular"). */
export default async function PassPage({ params }: Params) {
  const view = await loadPass((await params).token);
  if (!view) notFound();
  const { entry, perk } = view;
  const message = stateMessage(view);

  return (
    <div className="relative min-h-dvh overflow-hidden px-4 py-8 sm:py-12">
      <svg aria-hidden viewBox="0 0 480 480" className="pointer-events-none absolute -top-48 -right-48 size-[520px] text-line">
        <g fill="none" stroke="currentColor">
          {[90, 150, 210, 238].map((r, i) => (
            <circle key={r} cx="240" cy="240" r={r} strokeDasharray={i % 2 ? "2 6" : undefined} />
          ))}
        </g>
      </svg>

      <div className="relative mx-auto w-full max-w-sm">
        <header>
          <p className="eyebrow">{PASS_PURPOSE_LABELS[view.purpose]}</p>
          <h1 className="mt-2 text-[28px] leading-tight font-medium text-balance">
            {view.venueName}
            <span className="text-muted"> — {brand.name}</span>
          </h1>
        </header>

        <section className="card mt-6 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-lg leading-snug font-medium">{entry ? entry.eventName : perk?.perkName}</p>
              <p className="mt-0.5 text-sm text-muted">
                {entry
                  ? formatRange(entry.startsAt, entry.endsAt)
                  : perk?.validUntil
                    ? `Son geçerlilik: ${formatDateTime(perk.validUntil)}`
                    : "Süre sınırı yok"}
              </p>
            </div>
            <Badge tone={stateTone(view)}>{view.stateLabel}</Badge>
          </div>

          {view.showQr ? (
            <div className="mt-6 flex flex-col items-center">
              <QrCode qr={view.qr} size={288} label={`${PASS_PURPOSE_LABELS[view.purpose]} kodu`} />
              <p className="mt-3 text-center text-[13px] text-muted">
                {view.state === "NOT_YET_VALID"
                  ? entry
                    ? `Giriş ${formatDateTime(entry.opensAt)} itibarıyla açılır.`
                    : "Avantaj henüz geçerli değil."
                  : entry
                    ? "Girişte personele gösterin."
                    : "Kullanırken personele gösterin."}
              </p>
            </div>
          ) : (
            <div role="status" className="mt-6 rounded-field border border-line bg-raised px-4 py-4 text-sm leading-relaxed text-muted">
              {message}
            </div>
          )}

          <dl className="mt-6 divide-y divide-line border-t border-line text-sm">
            <Row label="Sahibi" value={view.holder} />
            {entry && <Row label="Kişi" value={`${entry.partySize} kişi`} />}
            {entry && <Row label="Giriş" value={`${formatDateTime(entry.opensAt)} – ${formatDateTime(entry.closesAt)}`} />}
            {perk && <Row label="Kalan hak" value={`${perk.remaining} / ${perk.limit}`} />}
          </dl>
          {perk?.description && <p className="mt-4 text-sm text-fg">{perk.description}</p>}
          {perk?.terms && <p className="mt-2 text-xs leading-relaxed text-muted">Koşullar: {perk.terms}</p>}
        </section>

        <p className="mt-5 text-center text-xs leading-relaxed text-muted">
          Bu kod size özeldir ve kişisel bilgi içermez. Ekran görüntüsünü başkalarıyla paylaşmayın.
        </p>
        <div className="mt-8 flex justify-center text-muted">
          <BrandMark size={16} />
        </div>
      </div>
    </div>
  );
}
