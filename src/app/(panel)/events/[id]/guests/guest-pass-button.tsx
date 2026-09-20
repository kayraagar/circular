"use client";

import { useId, useRef, useState, useTransition } from "react";
import { guestPassAction } from "@/modules/guests/actions";
import type { GuestPassResult } from "@/modules/guests/service";
import { CopyButton } from "@/components/copy-button";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { IconClose } from "@/components/ui/icons";
import { Badge, FormAlert } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";

/** Misafir satırı: kişiye özel giriş QR'ı (mevcut güvenli pass sistemi). PR yalnızca kendi misafiri için açabilir. */
export function GuestPassButton({ registrationId, guestName }: { registrationId: string; guestName: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<GuestPassResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = (reissue: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await guestPassAction(registrationId, reissue);
      if (result.ok) {
        setData(result.data);
        setConfirming(false);
        if (reissue) toast("Yeni QR oluşturuldu; önceki kod artık geçersiz.");
      } else {
        setError(result.message);
      }
    });

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-haspopup="dialog"
        onClick={() => {
          ref.current?.showModal();
          if (!data) load(false);
        }}
      >
        QR
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card border border-line bg-surface p-0 text-fg shadow-[0_24px_80px_rgb(0_0_0/0.6)] open:animate-enter"
      >
        <div className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Giriş QR&apos;ı</p>
              <h2 id={titleId} className="mt-1 truncate text-lg font-medium">
                {data?.guestName ?? guestName}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Kapat"
              className="-mt-1 -mr-2 inline-flex size-9 items-center justify-center rounded-field text-muted hover:bg-raised hover:text-fg"
            >
              <IconClose size={16} />
            </button>
          </div>

          {pending && !data && (
            <div className="flex justify-center py-20 text-muted">
              <Spinner size={22} label="QR hazırlanıyor" />
            </div>
          )}
          {error && (
            <div className="mt-4">
              <FormAlert tone="error">{error}</FormAlert>
            </div>
          )}

          {data && (
            <>
              <div className="mt-5 flex justify-center">
                <QrCode qr={data.qr} size={248} label={`${data.guestName} giriş QR kodu`} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Badge tone={data.state === "VALID" ? "positive" : data.state === "NOT_YET_VALID" ? "neutral" : "caution"}>{data.stateLabel}</Badge>
                <span className="truncate text-xs text-muted">{data.eventName}</span>
              </div>

              <label htmlFor={`${titleId}-link`} className="mt-5 block text-[13px] font-medium">
                Misafire iletilecek bağlantı
              </label>
              <div className="mt-1.5 flex gap-2">
                <input id={`${titleId}-link`} readOnly value={data.viewUrl} onFocus={(e) => e.currentTarget.select()} className="input font-mono !text-xs" />
                <CopyButton value={data.viewUrl} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">QR yalnızca doğrulama bağlantısı içerir, kişisel bilgi taşımaz. Bağlantı otomatik gönderilmez.</p>

              {data.useCount === 0 &&
                (confirming ? (
                  <div className="mt-5 rounded-field border border-line bg-raised p-3 text-[13px]">
                    <p>Önceki QR ve bağlantı geçersiz olacak. Devam edilsin mi?</p>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                        Vazgeç
                      </Button>
                      <Button size="sm" variant="danger" disabled={pending} onClick={() => load(true)}>
                        {pending && <Spinner />}
                        Kodu yenile
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="mt-4" onClick={() => setConfirming(true)}>
                    Kodu yenile
                  </Button>
                ))}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
