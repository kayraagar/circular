"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import type { NavItem } from "./nav";

/** Link'e tıklandıktan sonra sayfa gelene kadar gösterilen gösterge. */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner size={12} label="Yükleniyor" /> : null;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Ana menü">
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = NAV_ICONS[item.icon];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex h-9 items-center gap-3 rounded-field px-3 text-sm transition-colors duration-150 ${
                  active ? "bg-raised text-fg" : "text-muted hover:bg-raised/60 hover:text-fg"
                }`}
              >
                {active && (
                  <span aria-hidden className="absolute top-1/2 -left-[9px] size-1.5 -translate-y-1/2 rounded-full bg-fg" />
                )}
                <Icon size={17} className={active ? "text-fg" : "text-muted group-hover:text-fg"} />
                <span className="flex-1 truncate">{item.label}</span>
                <PendingIndicator />
                {item.status === "preparing" && (
                  <span className="font-mono text-[10px] tracking-wider text-muted/70 uppercase">Yakında</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
