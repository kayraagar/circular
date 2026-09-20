"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { perkPassAction } from "@/modules/perks/actions";
import type { PassShare } from "@/modules/passes/internal";
import { CopyButton } from "@/components/copy-button";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, FormAlert } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";

type Share = PassShare & { remaining: number };

export type PerkPanelItem = {
  perkId: string;
  name: string;
  meta: string;
  availability: "AVAILABLE" | "LIMIT_REACHED" | "NOT_YET_VALID" | "EXPIRED";
  used: number;
  limit: number;
  activePass: Share | null;
};

const AVAILABILITY: Record<PerkPanelItem["availability"], { label: string; tone: "positive" | "muted" | "caution" }> = {
  AVAILABLE: { label: "Verilebilir", tone: "positive" },
  LIMIT_REACHED: { label: "Hak doldu", tone: "muted" },
  NOT_YET_VALID: { label: "Henüz başlamadı", tone: "caution" },
  EXPIRED: { label: "Süresi doldu", tone: "muted" },
};

export function PerkPanel({ customerId, customerName, items }: { customerId: string; customerName: string; items: PerkPanelItem[] }) {
  const [shares, setShares] = useState<Record<string, Share | null>>(() =>
    Object.fromEntries(items.map((i) => [i.perkId, i.activePass])),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<{ perkId: string; message: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const issue = (perkId: string, reissue: boolean) => {
    setPendingId(perkId);
    startTransition(async () => {
      const result = await perkPassAction(customerId, perkId, reissue);
      setPendingId(null);
      setConfirmId(null);
      if (result.ok) {
        setShares((s) => ({ ...s, [perkId]: result.data }));
        setOpenId(perkId);
        setError(null);
        if (reissue) toast("Yeni avantaj QR'ı oluşturuldu; önceki kod geçersiz.");
      } else {
        setError({ perkId, message: result.message });
      }
    });
  };

  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="Aktif avantaj yok"
        description={
          <>
            Avantajlar{" "}
            <Link href="/menu/perks" className="text-fg underline underline-offset-4">
              QR Menü › Avantajlar
            </Link>{" "}
            bölümünden tanımlanır.
          </>
        }
      />
    );
  }

  return (
    <ul>
      {items.map((item) => {
        const share = shares[item.perkId];
        const open = openId === item.perkId && share;
        const status = AVAILABILITY[item.availability];
        const pending = pendingId === item.perkId;
        return (
          <li key={item.perkId} className="border-line px-5 py-3.5 [&+li]:border-t">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{item.name}</p>
                <p className="text-xs text-muted">{item.meta}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="font-mono text-[11px] text-muted" data-numeric>
                    {item.used}/{item.limit} kullanıldı
                  </span>
                </div>
              </div>
              {share ? (
                <Button size="sm" variant="ghost" aria-expanded={!!open} onClick={() => setOpenId(open ? null : item.perkId)}>
                  {open ? "Gizle" : "QR"}
                </Button>
              ) : item.availability === "AVAILABLE" ? (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => issue(item.perkId, false)}>
                  {pending && <Spinner />}
                  QR oluştur
                </Button>
              ) : null}
            </div>

            {error?.perkId === item.perkId && (
              <div className="mt-3">
                <FormAlert tone="error">{error.message}</FormAlert>
              </div>
            )}

            {open && share && (
              <div className="mt-4 rounded-field border border-line bg-bg p-4 animate-enter">
                <div className="flex justify-center">
                  <QrCode qr={share.qr} size={200} label={`${customerName} · ${item.name} QR kodu`} />
                </div>
                <p className="mt-3 text-center text-xs text-muted">Bu kodla kalan kullanım: {share.remaining}</p>
                <div className="mt-3 flex gap-2">
                  <input readOnly value={share.viewUrl} aria-label="Müşteriye iletilecek bağlantı" onFocus={(e) => e.currentTarget.select()} className="input font-mono !text-xs" />
                  <CopyButton value={share.viewUrl} />
                </div>
                {confirmId === item.perkId ? (
                  <div className="mt-3 flex items-center justify-end gap-2 text-[13px]">
                    <span className="mr-auto text-muted">Önceki kod geçersiz olacak.</span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                      Vazgeç
                    </Button>
                    <Button size="sm" variant="danger" disabled={pending} onClick={() => issue(item.perkId, true)}>
                      {pending && <Spinner />}
                      Yenile
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => setConfirmId(item.perkId)}>
                    Kodu yenile
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
