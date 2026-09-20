"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveAutoReplyAction } from "@/modules/campaigns/channel-actions";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

type Rule = { id: string; keywords: string[]; matchType: "EXACT" | "CONTAINS"; replyText: string };
const REPLY_LIMIT = 900;

/** Otomatik yanıt kuralı: anahtar kelimeler, eşleşme türü ve yanıt ({menu} {kayit} bağlantılarıyla). */
export function AutoReplyForm({ rule, links, onDone }: { rule?: Rule; links: { menu: string; signup: string }; onDone?: () => void }) {
  const [state, action] = useActionState(saveAutoReplyAction, IDLE);
  const [reply, setReply] = useState(valueOf(state, "replyText", rule?.replyText ?? ""));
  const [matchType, setMatchType] = useState(valueOf(state, "matchType", rule?.matchType ?? "EXACT"));
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message);
      if (!rule) setReply("");
      onDone?.();
    }
    // onDone yalnızca başarı anında çağrılır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const err = (k: string) => fieldError(state, k);
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const expanded = reply.replace(/\{menu\}/gi, links.menu).replace(/\{kayit\}/gi, links.signup);
  const bytes = new TextEncoder().encode(expanded).length;

  const insert = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? reply.length;
    const end = el?.selectionEnd ?? start;
    setReply((r) => (r.slice(0, start) + token + r.slice(end)).slice(0, REPLY_LIMIT));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <form key={state.status === "success" && !rule ? state.at : "form"} action={action} className="space-y-4" noValidate>
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <input type="hidden" name="matchType" value={matchType} />
      {generalError && <FormAlert tone="error">{generalError}</FormAlert>}
      <Field label="Anahtar kelimeler" htmlFor={`kw-${rule?.id ?? "new"}`} error={err("keywords")} required hint="Virgülle ayırın. Türkçe karakter ve büyük/küçük harf fark etmez.">
        <input
          {...describedBy(`kw-${rule?.id ?? "new"}`, err("keywords"), true)}
          name="keywords"
          defaultValue={valueOf(state, "keywords", rule?.keywords.join(", ") ?? "")}
          placeholder="menü, fiyat"
          autoComplete="off"
          className="input"
        />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Ne zaman yanıt verilsin?</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(
            [
              ["EXACT", "Mesaj yalnızca bu kelimeyse", "Ör. \"menü\" yazana"],
              ["CONTAINS", "Mesajda bu kelime geçerse", "Ör. \"cuma liste var mı\""],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              aria-pressed={matchType === value}
              onClick={() => setMatchType(value)}
              className={`rounded-field border px-3 py-2 text-left transition-colors ${matchType === value ? "border-fg bg-raised" : "border-line hover:border-line-strong"}`}
            >
              <span className="block text-[13px] text-fg">{label}</span>
              <span className="block text-[12px] text-muted">{hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`reply-${rule?.id ?? "new"}`} className="text-[13px] font-medium">
            Yanıt <span className="text-muted" aria-hidden>*</span>
          </label>
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" className="!h-7" onClick={() => insert("{menu}")}>
              + Menü linki
            </Button>
            <Button size="sm" variant="ghost" className="!h-7" onClick={() => insert("{kayit}")}>
              + Üyelik linki
            </Button>
          </span>
        </div>
        <textarea
          ref={ref}
          id={`reply-${rule?.id ?? "new"}`}
          name="replyText"
          rows={4}
          maxLength={REPLY_LIMIT}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          aria-invalid={err("replyText") ? true : undefined}
          placeholder="Merhaba! Menümüz burada: {menu}"
          className="input"
        />
        {err("replyText") ? (
          <p className="mt-1.5 text-[13px] text-negative">{err("replyText")}</p>
        ) : (
          <p className={`mt-1.5 text-[12px] ${bytes > 1000 ? "text-negative" : "text-muted"}`} data-numeric>
            Gönderilecek hali {bytes}/1000 bayt (Instagram sınırı)
          </p>
        )}
        {reply.trim() && <p className="mt-2 rounded-field border border-line bg-raised px-3 py-2 text-[13px] break-words whitespace-pre-line text-fg">{expanded}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel="Kaydediliyor">{rule ? "Kaydet" : "Otomatik yanıt ekle"}</SubmitButton>
        {rule && onDone && (
          <Button variant="ghost" onClick={onDone}>
            Vazgeç
          </Button>
        )}
      </div>
    </form>
  );
}
