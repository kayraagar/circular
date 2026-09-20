"use client";

import Link from "next/link";
import { useState } from "react";
import { CAMPAIGN_CHANNEL_LABELS } from "@/modules/campaigns/rules";
import type { AnswerBlock, AssistantAnswer } from "@/modules/assistant/rules";
import { IconAlert, IconArrowRight, IconCheck } from "@/components/ui/icons";
import { toast } from "@/components/ui/toaster";

/**
 * Asistan cevabının görünümü — sayı ve bağlantı odaklı, uzun metinden kaçınır.
 * Her blok gerçek veriden gelir; boş veri "yok" olarak gösterilir, doldurulmaz.
 */

/** Sütun sayısı kutu sayısına uyar; boş hücre bırakılmaz. */
const STAT_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

function Stats({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <dl className={`grid gap-px overflow-hidden rounded-field border border-line bg-line ${STAT_COLUMNS[items.length] ?? "grid-cols-2 sm:grid-cols-4"}`}>
      {items.map((item) => (
        <div key={item.label} className="bg-surface px-3.5 py-3">
          <dt className="text-[12px] leading-tight text-muted">{item.label}</dt>
          <dd className="mt-1.5 font-display text-[22px] leading-none font-medium" data-numeric>
            {item.value}
          </dd>
          {item.sub && (
            <dd className="mt-1.5 text-[11px] leading-tight text-muted" data-numeric>
              {item.sub}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function Rows({ caption, rows, emptyText }: { caption?: string; rows: { label: string; value: string; sub?: string; ratio?: number; href?: string }[]; emptyText?: string }) {
  if (rows.length === 0) return <p className="text-[13px] text-muted">{emptyText ?? "Kayıt yok"}</p>;
  const max = Math.max(...rows.map((r) => r.ratio ?? 0), 0.0001);
  return (
    <div>
      {caption && <p className="mb-2.5 text-[12px] text-muted">{caption}</p>}
      <ul className="space-y-2.5">
        {rows.map((row, i) => (
          <li key={`${row.label}-${i}`}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              {row.href ? (
                <Link href={row.href} className="min-w-0 truncate text-fg underline-offset-4 hover:underline">
                  {row.label}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-fg">{row.label}</span>
              )}
              <span className="shrink-0 text-muted" data-numeric>
                {row.value}
              </span>
            </div>
            {/* Açıklama çubuğun üstünde durur; çubuk satırın kapanışıdır, satırlar birbirine karışmaz. */}
            {row.sub && <span className="mt-0.5 block text-[12px] text-muted">{row.sub}</span>}
            {row.ratio !== undefined && (
              <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-line" aria-hidden>
                <span
                  className="block h-full rounded-full bg-accent/70 transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${Math.max(2, Math.round((row.ratio / max) * 100))}%` }}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-3 text-[13px] leading-relaxed">
          <span className="mt-px w-5 shrink-0 font-mono text-[11px] text-muted" data-numeric>
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="text-fg">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed">
          <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-line-strong" />
          <span className="text-fg">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Draft({ block }: { block: Extract<AnswerBlock, { kind: "draft" }> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-field border border-line bg-bg p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow">{CAMPAIGN_CHANNEL_LABELS[block.channel]} taslağı</span>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors hover:bg-raised hover:text-fg"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(block.body);
              setCopied(true);
              toast("Taslak metin kopyalandı.");
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              toast("Kopyalanamadı; metni elle seçip kopyalayın.", "error");
            }
          }}
        >
          {copied ? <IconCheck size={13} /> : null}
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed whitespace-pre-wrap text-fg">{block.body}</p>
      <p className="mt-3 border-t border-line pt-2.5 text-[12px] leading-relaxed text-muted">{block.hint}</p>
    </div>
  );
}

function Note({ tone, text }: { tone: "info" | "caution"; text: string }) {
  return (
    <p className={`flex gap-2 text-[12px] leading-relaxed ${tone === "caution" ? "text-caution" : "text-muted"}`}>
      {tone === "caution" ? (
        <IconAlert size={13} className="mt-[3px] shrink-0" />
      ) : (
        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-line-strong" />
      )}
      <span>{text}</span>
    </p>
  );
}

function Links({ items }: { items: { href: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="inline-flex h-8 items-center gap-1.5 rounded-field border border-line px-3 text-[13px] text-fg transition-colors hover:border-line-strong hover:bg-raised"
        >
          {link.label}
          <IconArrowRight size={13} className="text-muted" />
        </Link>
      ))}
    </div>
  );
}

function Block({ block }: { block: AnswerBlock }) {
  switch (block.kind) {
    case "stats":
      return <Stats items={block.items} />;
    case "rows":
      return <Rows caption={block.caption} rows={block.rows} emptyText={block.emptyText} />;
    case "steps":
      return <Steps steps={block.steps} />;
    case "bullets":
      return <Bullets items={block.items} />;
    case "draft":
      return <Draft block={block} />;
    case "note":
      return <Note tone={block.tone} text={block.text} />;
    case "links":
      return <Links items={block.links} />;
  }
}

export function AnswerView({ answer, onFollowUp }: { answer: AssistantAnswer; onFollowUp?: (question: string) => void }) {
  return (
    <div className="space-y-3.5">
      <div>
        {answer.scope && <p className="eyebrow mb-1.5">{answer.scope}</p>}
        <p className="font-display text-[15px] font-medium text-fg">{answer.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{answer.lead}</p>
      </div>
      {answer.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
      {onFollowUp && answer.followUps.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {answer.followUps.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onFollowUp(question)}
              className="rounded-full border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
