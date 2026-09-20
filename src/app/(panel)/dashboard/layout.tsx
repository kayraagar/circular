import type { ReactNode } from "react";
import { requirePermission } from "@/lib/context";

/**
 * Yetki kontrolü layout'ta: loading.tsx sayfayı Suspense ile sardığı için,
 * kontrol sayfada kalsaydı yanıt akışı başladıktan sonra 403 yerine 200 dönerdi.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requirePermission("dashboard.view");
  return children;
}
