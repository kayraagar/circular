"use client";

import { useState } from "react";
import { deleteAutoReplyAction, toggleAutoReplyAction } from "@/modules/campaigns/channel-actions";
import { formatDateTime } from "@/lib/datetime";
import { ActionButton } from "@/components/campaigns/action-button";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { AutoReplyForm } from "./auto-reply-form";

type Rule = { id: string; keywords: string[]; matchType: "EXACT" | "CONTAINS"; replyText: string; isActive: boolean; replyCount: number; lastRepliedAt: Date | null };

export function RuleList({ rules, links }: { rules: Rule[]; links: { menu: string; signup: string } }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (rules.length === 0) return <EmptyState compact title="Henüz otomatik yanıt yok" description="Aşağıdaki formla ilk kuralı ekleyin." />;
  return (
    <ul>
      {rules.map((r) => (
        <li key={r.id} className="border-line px-5 py-4 [&+li]:border-t">
          {editing === r.id ? (
            <AutoReplyForm rule={r} links={links} onDone={() => setEditing(null)} />
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.keywords.map((k) => (
                    <Badge key={k} mono>
                      {k}
                    </Badge>
                  ))}
                  <span className="text-[12px] text-muted">{r.matchType === "EXACT" ? "tam eşleşme" : "mesajda geçerse"}</span>
                  {!r.isActive && <Badge tone="muted">Kapalı</Badge>}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed break-words whitespace-pre-line text-fg">{r.replyText}</p>
                <p className="mt-1.5 text-[12px] text-muted" data-numeric>
                  {r.replyCount} yanıt{r.lastRepliedAt ? ` · son ${formatDateTime(r.lastRepliedAt)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(r.id)}>
                  Düzenle
                </Button>
                <ActionButton action={toggleAutoReplyAction} fields={{ id: r.id, active: r.isActive ? "0" : "1" }}>
                  {r.isActive ? "Kapat" : "Aç"}
                </ActionButton>
                <ConfirmDialog
                  trigger="Sil"
                  triggerVariant="ghost"
                  title="Otomatik yanıtı sil"
                  description={`"${r.keywords.join(", ")}" kuralı silinir. Gönderilmiş yanıtların sayısı da silinir.`}
                  confirmLabel="Sil"
                  action={deleteAutoReplyAction}
                  fields={{ id: r.id }}
                />
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
