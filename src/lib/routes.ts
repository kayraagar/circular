import type { Role } from "./domain";

/** Rolün giriş sonrası açılış sayfası. */
export function homePathForRole(role: Role): string {
  switch (role) {
    case "OWNER_ADMIN":
    case "CRM_MANAGER":
      return "/dashboard";
    case "DOOR":
      return "/door";
    case "WAITER":
      return "/redeem";
    default:
      return "/workspace";
  }
}

/** Açık yönlendirme (open redirect) önlemi: yalnızca uygulama içi göreli yollar. */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.startsWith("/login")) return null;
  return value;
}
