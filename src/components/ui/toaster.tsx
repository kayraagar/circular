"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FLASH_COOKIE } from "@/lib/auth/constants";
import { IconAlert, IconCheck } from "./icons";

const EVENT = "circular:toast";
type Tone = "success" | "error";

/** İstemci tarafında kısa bildirim göster. */
export function toast(message: string, tone: Tone = "success") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

function decodeFlash(raw: string) {
  let v = raw;
  for (let i = 0; i < 2 && /%[0-9A-F]{2}/i.test(v); i++) {
    try {
      v = decodeURIComponent(v);
    } catch {
      break;
    }
  }
  return v;
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; message: string; tone: Tone }[]>([]);
  const pathname = usePathname();

  const push = useCallback((message: string, tone: Tone) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ message: string; tone: Tone }>).detail;
      push(d.message, d.tone);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [push]);

  // Sunucu yönlendirmesinden sonra bırakılan flash mesajı
  useEffect(() => {
    const entry = document.cookie.split("; ").find((c) => c.startsWith(`${FLASH_COOKIE}=`));
    if (!entry) return;
    document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;
    push(decodeFlash(entry.slice(FLASH_COOKIE.length + 1)), "success");
  }, [pathname, push]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-sm animate-enter items-start gap-2.5 rounded-field border border-line bg-raised px-4 py-3 text-sm text-fg shadow-[0_12px_40px_rgb(0_0_0/0.5)]"
        >
          <span className={`mt-0.5 ${t.tone === "success" ? "text-positive" : "text-negative"}`}>
            {t.tone === "success" ? <IconCheck size={15} /> : <IconAlert size={15} />}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
