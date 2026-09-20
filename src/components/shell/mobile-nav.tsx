"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { IconClose, IconMenu } from "@/components/ui/icons";

export function MobileNav({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label="Menüyü aç"
        aria-haspopup="dialog"
        className="-ml-2 inline-flex size-10 items-center justify-center rounded-field text-fg hover:bg-raised lg:hidden"
      >
        <IconMenu size={20} />
      </button>
      <dialog
        ref={ref}
        aria-label="Menü"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
        className="m-0 h-dvh max-h-dvh w-[86vw] max-w-[320px] border-r border-line bg-bg p-0 text-fg open:animate-enter"
      >
        <div className="relative flex h-full flex-col px-4 py-5">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Menüyü kapat"
            className="absolute top-4 right-3 inline-flex size-9 items-center justify-center rounded-field text-muted hover:bg-raised hover:text-fg"
          >
            <IconClose size={18} />
          </button>
          {children}
        </div>
      </dialog>
    </>
  );
}
