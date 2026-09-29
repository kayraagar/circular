import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { brand, venueExperienceTitle } from "@/config/brand";
import { formatRange } from "@/lib/datetime";
import { firstParam, type SearchParams } from "@/lib/page";
import { getPublicVenue } from "@/modules/venue-page/service";
import { BrandMark } from "@/components/ui/brand-mark";
import { Badge } from "@/components/ui/primitives";
import { VenueSignupForm } from "./signup-form";

type Params = { params: Promise<{ slug: string }>; searchParams: SearchParams };

const loadVenue = cache((slug: string) => getPublicVenue(slug));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const venue = await loadVenue((await params).slug);
  return {
    title: { absolute: venue ? venueExperienceTitle(venue.name) : brand.name },
    description: venue ? `${venue.typeLabel}${venue.city ? ` · ${venue.city}` : ""} — etkinlikler ve üyelik.` : undefined,
  };
}

const REGISTRATION_LABELS: Record<string, string> = {
  NOT_YET: "Kayıtlar henüz açılmadı",
  CLOSED: "Kayıtlar kapandı",
  FULL: "Kontenjan doldu",
};

/** Mekanın müşteriye açık sayfası: tanıtım, yaklaşan etkinlikler ve kendi kaydını açma. */
export default async function VenuePage({ params, searchParams }: Params) {
  const { slug } = await params;
  const venue = await loadVenue(slug);
  if (!venue) notFound();
  const selectedEventId = firstParam((await searchParams).etkinlik);
  const openEvents = venue.events.filter((e) => e.registration === "OPEN");

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header>
        <p className="eyebrow">{venue.tenantName}</p>
        <h1 className="mt-2 font-display text-[32px] leading-tight font-medium sm:text-[40px]">{venue.name}</h1>
        <p className="mt-2 text-sm text-muted">
          {venue.typeLabel}
          {venue.city ? ` · ${venue.city}` : ""}
        </p>
        {venue.address && <p className="mt-1 text-[13px] text-muted">{venue.address}</p>}
        {venue.menuPath && (
          <Link href={venue.menuPath} className="mt-4 inline-flex text-[13px] text-fg underline-offset-4 hover:underline">
            Menüyü gör
          </Link>
        )}
      </header>

      <section className="mt-10">
        <h2 className="text-[15px] font-medium text-fg">Yaklaşan etkinlikler</h2>
        {venue.events.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Şu anda yayında etkinlik yok. Üye olursanız yeni etkinliklerden haberdar olabilirsiniz.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {venue.events.map((e) => (
              <li key={e.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-fg">{e.name}</p>
                    <p className="mt-1 text-[13px] text-muted">{formatRange(e.startsAt, e.endsAt)}</p>
                  </div>
                  {e.registration === "OPEN" ? (
                    <Badge tone="positive">
                      Kayıt açık{e.spotsLeft !== null ? ` · ${e.spotsLeft} kişilik yer` : ""}
                    </Badge>
                  ) : (
                    <Badge tone="muted">{REGISTRATION_LABELS[e.registration]}</Badge>
                  )}
                </div>
                {e.description && <p className="mt-3 text-sm leading-relaxed text-muted">{e.description}</p>}
                {e.registration === "OPEN" && (
                  <Link
                    href={`/v/${venue.slug}?etkinlik=${e.id}#kayit`}
                    className="mt-4 inline-flex text-[13px] text-fg underline-offset-4 hover:underline"
                  >
                    Bu etkinliğe kaydol
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="kayit" className="mt-12 scroll-mt-6">
        <h2 className="text-[15px] font-medium text-fg">
          {openEvents.length > 0 ? "Üye olun veya etkinliğe kaydolun" : "Üye olun"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Üyelik ücretsizdir. İletişim izni ayrı bir seçimdir: işaretlemezseniz size ticari ileti gönderilmez.
        </p>
        <VenueSignupForm
          slug={venue.slug}
          venueName={venue.name}
          events={openEvents.map((e) => ({ id: e.id, name: e.name, startsAt: e.startsAt.toISOString(), spotsLeft: e.spotsLeft }))}
          selectedEventId={openEvents.some((e) => e.id === selectedEventId) ? selectedEventId : ""}
          legal={venue.legal}
        />
      </section>

      <footer className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6 font-mono text-[11px] text-muted">
        <BrandMark size={16} />
        <Link href="/yasal/gizlilik" className="underline-offset-4 hover:text-fg hover:underline">
          Gizlilik
        </Link>
        <Link href="/yasal/cerez" className="underline-offset-4 hover:text-fg hover:underline">
          Çerezler
        </Link>
      </footer>
    </main>
  );
}
