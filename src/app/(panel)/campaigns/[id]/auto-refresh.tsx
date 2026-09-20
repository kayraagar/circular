"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Gönderim sürerken sayfayı birkaç saniyede bir yeniler (sayılar sunucudan gelir). */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
