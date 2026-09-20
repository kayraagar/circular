"use client";

import { useState, useTransition } from "react";
import { inviteLinkAction } from "@/modules/guests/invite-actions";
import type { InviteLinkView } from "@/modules/guests/invite";
import { CopyButton } from "@/components/copy-button";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, FormAlert } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";

/**
 * PR'ın etkinliğe özel davet linki ve QR'ı. Misafir linkten kendi kaydını yapar; kayıt bu PR'a yazılır.
 * WhatsApp düğmesi yalnızca PR'ın kendi cihazında hazır metinle WhatsApp'ı açar; uygulama mesaj göndermez.
 */
export function InviteLinkCard({ eventId, eventName, initial, canCreate }: { eventId: string; eventName: string; initial: InviteLinkView | null; canCreate: boolean }) {
  const [link, setLink] = useState<InviteLinkView | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (rotate: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await inviteLinkAction(eventId, rotate);
      if (result.ok) {
        setLink(result.data);
        setConfirming(false);
        toast(rotate ? "Yeni davet linki oluşturuldu; eski link artık çalışmıyor." : "Davet linkiniz hazır.");
      } else {
        setError(result.message);
      }
    });

  const shareText = link ? `${eventName} guest listesine buradan yazılabilirsin: ${link.url}` : "";

  return (
    <Card className="h-fit">
      <CardHeader title="Davet linkim" description="Paylaşın; misafir kendi kaydını yapar, kayıt sizin adınıza sayılır ve misafire giriş QR'ı verilir." />
      <div className="space-y-4 px-5 pb-5">
        {error && <FormAlert tone="error">{error}</FormAlert>}

        {!link ? (
          canCreate ? (
            <Button variant="primary" className="w-full" disabled={pending} onClick={() => run(false)}>
              {pending && <Spinner />}
              Davet linkimi oluştur
            </Button>
          ) : (
            <p className="text-[13px] leading-relaxed text-muted">Etkinlik kayda kapalı olduğu için davet linki oluşturulamaz.</p>
          )
        ) : (
          <>
            {link.availability.state !== "OPEN" && (
              <FormAlert tone="info">
                {link.availability.state === "NOT_YET" ? "Kayıtlar henüz açılmadı; link açılış saatinden sonra kayıt alır." : `Link şu an kayıt almıyor: ${link.availability.reason}`}
              </FormAlert>
            )}
            <div className="flex justify-center">
              <QrCode qr={link.qr} size={200} label={`${eventName} davet linki QR kodu`} />
            </div>
            <div>
              <label htmlFor={`invite-${eventId}`} className="text-[13px] font-medium">
                Davet bağlantısı
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <input id={`invite-${eventId}`} readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 basis-40 font-mono !text-xs" />
                <CopyButton value={link.url} />
              </div>
            </div>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 w-full items-center justify-center rounded-field border border-line text-sm text-fg transition-colors hover:border-line-strong hover:bg-raised"
            >
              WhatsApp&apos;ta paylaş
            </a>
            <p className="text-[13px] text-muted" data-numeric>
              Linkten <span className="text-fg">{link.stats.registrations}</span> kayıt · {link.stats.people} kişi · {link.stats.admitted} kişi içeride
            </p>

            {confirming ? (
              <div className="rounded-field border border-line bg-raised p-3 text-[13px]">
                <p>Eski link ve QR hemen çalışmaz hale gelir; o linkle yapılmış kayıtlar korunur. Devam edilsin mi?</p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                    Vazgeç
                  </Button>
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => run(true)}>
                    {pending && <Spinner />}
                    Linki yenile
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={!canCreate}>
                Linki yenile
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
