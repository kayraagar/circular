import { can, type Permission } from "@/lib/authz";
import type { Role } from "@/lib/domain";
import type { NavIconName } from "@/components/ui/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  permission: Permission;
  /** preparing: modül sayfası yalnızca "Hazırlanıyor" bilgisini gösterir */
  status: "ready" | "preparing";
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Genel Bakış", icon: "overview", permission: "dashboard.view", status: "ready" },
  { href: "/customers", label: "Müşteriler", icon: "users", permission: "customers.view", status: "ready" },
  { href: "/events", label: "Etkinlikler ve Guest", icon: "calendar", permission: "events.view", status: "ready" },
  { href: "/pr", label: "PR Yönetimi", icon: "share", permission: "pr.manage", status: "ready" },
  { href: "/menu", label: "QR Menü", icon: "qr", permission: "menu.manage", status: "ready" },
  { href: "/campaigns", label: "Kampanyalar", icon: "send", permission: "campaigns.manage", status: "ready" },
  { href: "/assistant", label: "AI Asistan", icon: "orbit", permission: "assistant.use", status: "ready" },
  { href: "/reports", label: "Raporlar", icon: "chart", permission: "reports.view", status: "ready" },
  { href: "/settings", label: "Ayarlar", icon: "sliders", permission: "settings.view", status: "ready" },
];

const WORKSPACE: NavItem = {
  href: "/workspace",
  label: "PR portalı",
  icon: "briefcase",
  permission: "pr.portal",
  status: "ready",
};

/** Panel menüsü olmayan operasyon rolleri için tek görev ekranı. */
const STAFF_NAV: Partial<Record<Role, NavItem[]>> = {
  DOOR: [{ href: "/door", label: "Giriş doğrulama", icon: "qr", permission: "door.checkin", status: "ready" }],
  WAITER: [{ href: "/redeem", label: "Avantaj doğrulama", icon: "qr", permission: "perks.redeem", status: "ready" }],
};

export function navFor(role: Role): NavItem[] {
  const items = NAV_ITEMS.filter((i) => can(role, i.permission));
  if (items.length > 0) return items;
  return STAFF_NAV[role] ?? [WORKSPACE];
}
