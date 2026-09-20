import Link from "next/link";

const TABS = [
  { href: "/campaigns", label: "Kampanyalar" },
  { href: "/campaigns/whatsapp", label: "WhatsApp" },
  { href: "/campaigns/templates", label: "WhatsApp şablonları" },
  { href: "/campaigns/sms", label: "SMS" },
  { href: "/campaigns/email", label: "E-posta" },
  { href: "/campaigns/instagram", label: "Instagram" },
] as const;

/** Kampanyalar bölümünün alt sekmeleri. */
export function CampaignNav({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Kampanya bölümleri" className="-mt-4 mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((tab) => {
        const current = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
              current ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
