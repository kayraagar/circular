import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { formatDate, formatRange } from "@/lib/datetime";
import { formatPhone } from "@/lib/normalize";
import { getPublicVenue } from "@/modules/venue-page/service";
import { MEMBER_COOKIE, readMemberSession } from "@/modules/member/service";
import { getMemberArea } from "@/modules/member/area";
import { memberLogoutAction } from "@/modules/member/actions";
import { BrandMark } from "@/components/ui/brand-mark";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { MemberLogin } from "./login";
import { MemberPreferences } from "./preferences";

// Kişisel alan: dizine eklenmez.
export const metadata: Metadata = { title: "Üyeliğim", referrer: "no-referrer", robots: { index: false, follow: false } };

/**
 * Üyelik alanı: kişi kendi QR'larını, etkinlik kayıtlarını ve iletişim tercihlerini görür.
 * Giriş şifresiz — tek kullanımlık kodla.
 */
export default async function MemberAreaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const venue = await getPublicVenue(slug);
  if (!venue) notFound();

  const jar = await cookies();
  const ctx = await readMemberSession(jar.get(MEMBER_COOKIE)?.value);
  const area = ctx && ctx.tenantId === venue.tenantId ? await getMemberArea(ctx) : null;

  if (!area) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <BrandMark />
        <div className="card mt-8 p-6">
          <p className="eyebrow">{venue.name}</p>
          <h1 className="mt-2 font-display text-[24px] leading-tight font-medium">Üyeliğim</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Kayıtlı telefon numaranızı veya e-posta adresinizi yazın; size tek kullanımlık giriş kodu gönderelim.
            Şifre gerekmez.
          </p>
          <MemberLogin slug={venue.slug} />
          <Link href={`/v/${venue.slug}`} className="mt-5 inline-flex text-[13px] text-muted underline-offset-4 hover:text-fg hover:underline">
            Mekan sayfasına dön
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{area.tenantName}</p>
          <h1 className="mt-2 font-display text-[28px] leading-tight font-medium">{area.name}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {area.phone ? formatPhone(area.phone) : area.email}
            {area.phone && !area.phoneVerified ? " · numara doğrulanmadı" : ""}
          </p>
        </div>
        <form action={memberLogoutAction}>
          <input type="hidden" name="slug" value={venue.slug} />
          <Button type="submit" size="sm" variant="ghost">
            Çıkış yap
          </Button>
        </form>
      </header>

      <section className="mt-10">
        <h2 className="text-[15px] font-medium text-fg">QR kodlarım</h2>
        {area.passes.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">Şu anda geçerli bir QR kodunuz yok.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {area.passes.map((p) => (
              <li key={p.token} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{p.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {p.subtitle}
                    {p.when ? ` · ${formatDate(p.when)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={p.state === "VALID" ? "positive" : "muted"}>{p.stateLabel}</Badge>
                  <Link href={`/pass/${p.token}`} className="text-[13px] text-fg underline-offset-4 hover:underline">
                    Kodu aç
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-[15px] font-medium text-fg">Etkinlik kayıtlarım</h2>
        {area.registrations.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">Yaklaşan etkinlik kaydınız yok.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {area.registrations.map((r, i) => (
              <li key={`${r.eventName}-${i}`} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{r.eventName}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {r.venueName} · {formatRange(r.startsAt, r.endsAt)} · {r.partySize} kişi
                  </p>
                </div>
                {r.cancelled && <Badge tone="negative">İptal</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-[15px] font-medium text-fg">İletişim tercihlerim</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          İşaretlemediğiniz kanaldan size ticari ileti gönderilmez. Dilediğiniz zaman değiştirebilirsiniz.
        </p>
        <MemberPreferences slug={venue.slug} consents={area.consents} />
      </section>

      {area.venues.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[15px] font-medium text-fg">Üyeliklerim</h2>
          <ul className="mt-3 space-y-1.5 text-[13px] text-muted">
            {area.venues.map((v) => (
              <li key={v.name}>
                {v.name} · {formatDate(v.joinedAt)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6 font-mono text-[11px] text-muted">
        <BrandMark size={16} />
        <Link href={`/v/${venue.slug}`} className="underline-offset-4 hover:text-fg hover:underline">
          Mekan sayfası
        </Link>
        <Link href="/yasal/gizlilik" className="underline-offset-4 hover:text-fg hover:underline">
          Gizlilik
        </Link>
      </footer>
    </main>
  );
}
