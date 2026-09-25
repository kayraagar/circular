"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { askAssistantAction } from "@/modules/assistant/actions";
import { ASSISTANT_INTRO, MAX_HISTORY_TURNS, STARTER_QUESTIONS, type AssistantAnswer, type ChatTurn } from "@/modules/assistant/rules";
import { IconArrowRight } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { AnswerView } from "./answer-view";

/**
 * Asistan konuşması. Geçmiş yalnızca bu sekmede tutulur, sunucuya kaydedilmez.
 * Her cevap sunucuda, kullanıcının yetkili olduğu veriden hesaplanır.
 */

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; answer: AssistantAnswer }
  | { id: number; role: "error"; text: string };

export type ChatScope = { venueId: string | null; venueLabel: string | null };

export function AssistantChat({ scope, compact = false }: { scope: ChatScope; compact?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const submit = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || loading) return;
      const id = Date.now();
      // Konuşma bağlamı: önceki turlar sunucuya gider, kişisel veri içerenler orada ayıklanır.
      const history: ChatTurn[] = [];
      for (const m of messages.slice(-MAX_HISTORY_TURNS)) {
        if (m.role === "user") history.push({ role: "user", text: m.text });
        else if (m.role === "assistant") history.push({ role: "assistant", text: m.answer.lead, topic: m.answer.topic });
      }
      setMessages((prev) => [...prev, { id, role: "user", text }]);
      setDraft("");
      setLoading(true);
      const result = await askAssistantAction({ question: text, venueId: scope.venueId, venueLabel: scope.venueLabel, history });
      setLoading(false);
      setMessages((prev) => [...prev, result.ok ? { id: id + 1, role: "assistant", answer: result.answer } : { id: id + 1, role: "error", text: result.message }]);
      inputRef.current?.focus();
    },
    [loading, messages, scope.venueId, scope.venueLabel],
  );

  return (
    <div className={`flex min-h-0 flex-col ${compact ? "h-full" : "h-[min(72vh,760px)]"}`}>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5" role="log" aria-live="polite" aria-label="Asistan konuşması">
        {messages.length === 0 && (
          <div className="animate-enter">
            <p className="max-w-xl text-sm leading-relaxed text-muted">{ASSISTANT_INTRO}</p>
            <p className="mt-5 mb-2.5 text-[12px] text-muted">Örnek sorular</p>
            <div className="flex flex-wrap gap-2">
              {STARTER_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => submit(question)}
                  className="rounded-full border border-line px-3.5 py-2 text-[13px] text-fg transition-colors hover:border-line-strong hover:bg-raised"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-field rounded-br-sm border border-line bg-raised px-3.5 py-2.5 text-sm text-fg">{message.text}</p>
              </div>
            ) : message.role === "error" ? (
              <p key={message.id} className="text-sm text-negative">
                {message.text}
              </p>
            ) : (
              <div key={message.id} className="animate-enter">
                <AnswerView answer={message.answer} onFollowUp={submit} />
              </div>
            ),
          )}
          {loading && (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner size={13} /> Verinize bakıyorum…
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex items-center gap-2 border-t border-line px-4 py-3 sm:px-5"
      >
        <label htmlFor={compact ? "assistant-dock-input" : "assistant-input"} className="sr-only">
          Sorunuzu yazın
        </label>
        <input
          ref={inputRef}
          id={compact ? "assistant-dock-input" : "assistant-input"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Enter ile gönderim: formun örtük gönderimine bırakılmaz (IME yazımında gönderilmez).
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(draft);
            }
          }}
          maxLength={400}
          autoComplete="off"
          placeholder="Bir şey sorun: “bu hafta kaç kişi geldi?”"
          className="input"
        />
        <button
          type="submit"
          aria-label="Sor"
          disabled={loading || draft.trim() === ""}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-field bg-fg text-bg transition-opacity hover:bg-white disabled:pointer-events-none disabled:opacity-40"
        >
          <IconArrowRight size={17} />
        </button>
      </form>
    </div>
  );
}
