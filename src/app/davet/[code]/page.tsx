import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { formatDateTime, formatRange } from "@/lib/datetime";
import { resolveInvite } from "@/modules/guests/invite";
import { BrandMark } from "@/components/ui/brand-mark";
import { InviteForm } from "./invite-form";

type Params = { params: Promise<{ code: string }> };

const load = cache((code: string) => resolveInvite(code));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const invite = await load((await params).code);
  return {
    title: { absolute: invite ? `${invite.event.name} — Guest listesi` : "Guest listesi" },
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

/** PR davet linki: misafir guest listesine kendi kaydını yapar. */
export default async function InvitePage({ params }: Params) {
  const { code } = await params;
  const invite = await load(code);
  if (!invite) notFound();
  const { event, availability } = invite;

  return (
    <div className="relative min-h-dvh overflow-hidden px-4 py-8 sm:py-12">
      <svg aria-hidden viewBox="0 0 480 480" className="pointer-events-none absolute -top-48 -right-48 size-[520px] text-line">
        <g fill="none" stroke="currentColor">
          {[90, 150, 210, 238].map((r, i) => (
            <circle key={r} cx="240" cy="240" r={r} strokeDasharray={i % 2 ? "2 6" : undefined} />
          ))}
        </g>
      </svg>

      <div className="relative mx-auto w-full max-w-md">
        <header>
          <p className="eyebrow">Guest listesi · {event.venueName}</p>
          <h1 className="mt-2 text-[30px] leading-tight font-medium text-balance">{event.name}</h1>
          <p className="mt-1.5 text-sm text-muted">{formatRange(event.startsAt, event.endsAt)}</p>
          {invite.promoterFirstName && (
            <p className="mt-3 inline-flex rounded-full border border-line px-3 py-1 text-[13px] text-muted">
              Davet eden: <span className="ml-1 text-fg">{invite.promoterFirstName}</span>
            </p>
          )}
        </header>

        <section className="card mt-6 p-5">
          {availability.state === "OPEN" ? (
            <InviteForm code={invite.code} tenantName={invite.tenantName} />
          ) : (
            <div role="status" className="py-4 text-center">
              <p className="font-display text-lg font-medium">{availability.state === "NOT_YET" ? "Kayıtlar henüz açılmadı" : "Kayıtlar kapalı"}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {availability.state === "NOT_YET" ? `Bu link ${formatDateTime(availability.opensAt)} itibarıyla kayıt alır.` : availability.reason}
              </p>
            </div>
          )}
        </section>

        <p className="mt-5 text-center text-xs leading-relaxed text-muted">
          Kayıttan sonra size özel giriş QR&apos;ı açılır; girişte personele gösterin.
        </p>
        <div className="mt-8 flex justify-center text-muted">
          <BrandMark size={16} />
        </div>
      </div>
    </div>
  );
}
