"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconClose, IconOrbit } from "@/components/ui/icons";
import { AssistantChat, type ChatScope } from "./chat";

/**
 * Panel ekranlarının sağ altındaki asistan yardımcısı.
 * Asistan sayfasındayken gizlenir; konuşma geçmişi yalnızca bu sekmede tutulur.
 */
export function AssistantDock({ scope }: { scope: ChatScope }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (pathname.startsWith("/assistant")) return null;

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="AI Asistan"
          className="card animate-enter fixed right-3 bottom-3 z-40 flex h-[min(78vh,620px)] w-[calc(100vw-1.5rem)] flex-col overflow-hidden shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8)] sm:right-6 sm:bottom-6 sm:w-[420px]"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <IconOrbit size={16} className="text-accent" />
            <p className="flex-1 text-sm font-medium text-fg">AI Asistan</p>
            <Link href="/assistant" className="rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:text-fg">
              Tam ekran
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Asistanı kapat"
              className="inline-flex size-8 items-center justify-center rounded-field text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              <IconClose size={16} />
            </button>
          </div>
          <AssistantChat scope={scope} compact />
        </div>
      )}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label="AI Asistan'a sor"
          className="fixed right-4 bottom-4 z-40 inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[13px] text-fg shadow-[0_12px_30px_-12px_rgb(0_0_0/0.9)] transition-colors hover:border-line-strong hover:bg-raised sm:right-6 sm:bottom-6"
        >
          <IconOrbit size={16} className="text-accent" />
          Asistan
        </button>
      )}
    </>
  );
}
