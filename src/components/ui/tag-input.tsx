"use client";

import { useId, useState } from "react";
import { IconClose, IconPlus } from "./icons";

const MAX_TAGS = 15;
const key = (s: string) => s.trim().toLocaleLowerCase("tr-TR");

/** Etiket girişi: Enter veya virgül ekler, Backspace son etiketi siler. Değer gizli alanda JSON olarak gönderilir. */
export function TagInput({
  name,
  id,
  initial,
  suggestions,
  invalid,
  describedById,
}: {
  name: string;
  id: string;
  initial: string[];
  suggestions: string[];
  invalid?: boolean;
  describedById?: string;
}) {
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const listId = useId();

  const add = (raw: string) => {
    const value = raw.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!value) return;
    setTags((t) => (t.length >= MAX_TAGS || t.some((x) => key(x) === key(value)) ? t : [...t, value]));
    setDraft("");
  };
  const remove = (tag: string) => setTags((t) => t.filter((x) => x !== tag));
  const open = suggestions.filter((s) => !tags.some((t) => key(t) === key(s))).slice(0, 10);

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(tags)} />
      <div
        className="input flex flex-wrap items-center gap-1.5 !py-1.5 focus-within:border-[#8c8c8c] focus-within:shadow-[0_0_0_3px_rgb(247_247_245/0.08)]"
        aria-invalid={invalid || undefined}
      >
        <ul className="contents" aria-label="Seçili etiketler">
          {tags.map((tag) => (
            <li key={tag} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-raised pr-1 pl-2.5 text-xs text-fg">
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`${tag} etiketini kaldır`}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted hover:bg-line hover:text-fg"
              >
                <IconClose size={11} />
              </button>
            </li>
          ))}
        </ul>
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
              remove(tags[tags.length - 1]);
            }
          }}
          onBlur={() => add(draft)}
          aria-describedby={describedById}
          placeholder={tags.length === 0 ? "Etiket yazıp Enter'a basın" : ""}
          disabled={tags.length >= MAX_TAGS}
          className="h-7 min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-[#6f6f6f]"
        />
      </div>
      {open.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-labelledby={listId}>
          <span id={listId} className="mr-1 text-xs text-muted">
            Mevcut etiketler:
          </span>
          {open.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-line px-2 text-xs text-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              <IconPlus size={10} /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
