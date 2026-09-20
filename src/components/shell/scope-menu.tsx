"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { IconCheck } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";

type Option = { value: string; label: string; hint?: string };

function OptionButton({ name, option, selected }: { name: string; option: Option; selected: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={option.value}
      role="menuitemradio"
      aria-checked={selected}
      disabled={pending}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-raised focus-visible:bg-raised disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{option.label}</span>
        {option.hint && <span className="block truncate text-xs text-muted">{option.hint}</span>}
      </span>
      {selected && <IconCheck size={14} className="shrink-0 text-accent" />}
    </button>
  );
}

function PendingIndicator() {
  const { pending } = useFormStatus();
  return pending ? <Spinner size={12} label="Uygulanıyor" /> : null;
}

/**
 * İşletme / mekan kapsamı seçici. Seçim bir form gönderimidir (sunucuda doğrulanır);
 * klavyeyle açılır, Esc ile kapanır.
 */
export function ScopeMenu({
  action,
  name,
  label,
  current,
  options,
  children,
  align = "left",
}: {
  action: (formData: FormData) => Promise<void>;
  name: string;
  label: string;
  current: string;
  options: Option[];
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-field text-left"
      >
        {children}
      </button>
      {open && (
        <form
          action={async (fd) => {
            await action(fd);
            setOpen(false);
          }}
        >
          <div
            id={menuId}
            role="menu"
            aria-label={label}
            className={`absolute z-40 mt-2 max-h-80 w-72 max-w-[calc(100vw-2rem)] animate-enter overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-[0_16px_48px_rgb(0_0_0/0.55)] ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            <div className="flex items-center justify-between px-3 pt-1.5 pb-2">
              <span className="eyebrow">{label}</span>
              <PendingIndicator />
            </div>
            {options.map((o) => (
              <OptionButton key={o.value || "all"} name={name} option={o} selected={o.value === current} />
            ))}
          </div>
        </form>
      )}
    </div>
  );
}
