"use client";

import { setConsentAction } from "@/modules/customers/actions";
import { CHANNEL_LABELS, type Channel } from "@/lib/domain";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/primitives";

export type ConsentRow = {
  channel: Channel;
  status: "GRANTED" | "REVOKED" | null;
  note: string | null;
  changedAt: string | null;
  sourceLabel: string | null;
};

export function ConsentPanel({
  customerId,
  rows,
  canManage,
  hasPhone,
  hasEmail,
  archived,
}: {
  customerId: string;
  rows: ConsentRow[];
  canManage: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  archived: boolean;
}) {
  return (
    <ul>
      {rows.map((row) => {
        const label = CHANNEL_LABELS[row.channel];
        const reachable = row.channel === "EMAIL" ? hasEmail : hasPhone;
        return (
          <li key={row.channel} className="flex items-start gap-3 border-line px-5 py-3.5 [&+li]:border-t">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-fg">{label}</span>
                {row.status === "GRANTED" ? (
                  <Badge tone="positive">İzin var</Badge>
                ) : row.status === "REVOKED" ? (
                  <Badge tone="negative">İzin kaldırıldı</Badge>
                ) : (
                  <Badge tone="muted">İzin yok</Badge>
                )}
              </div>
              {row.changedAt && (
                <p className="mt-1 text-xs text-muted">
                  {row.sourceLabel} · {row.changedAt}
                  {row.note ? ` · ${row.note}` : ""}
                </p>
              )}
              {!reachable && row.status !== "GRANTED" && (
                <p className="mt-1 text-xs text-muted">{row.channel === "EMAIL" ? "E-posta adresi yok" : "Telefon numarası yok"}</p>
              )}
            </div>
            {canManage &&
              (row.status === "GRANTED" ? (
                <ConfirmDialog
                  trigger="Kaldır"
                  triggerVariant="ghost"
                  title={`${label} iznini kaldır`}
                  description="Bu kanal üzerinden pazarlama mesajı gönderilemez. Müşteri yeniden izin verirse tekrar kaydedebilirsiniz."
                  confirmLabel="İzni kaldır"
                  action={setConsentAction}
                  fields={{ customerId, channel: row.channel, grant: "0" }}
                >
                  <label htmlFor={`revoke-note-${row.channel}`} className="mb-1.5 block text-[13px] font-medium">
                    Açıklama <span className="text-xs font-normal text-muted">(opsiyonel)</span>
                  </label>
                  <input id={`revoke-note-${row.channel}`} name="note" maxLength={300} className="input" placeholder="Ör. Müşteri telefonda istedi" />
                </ConfirmDialog>
              ) : (
                reachable &&
                !archived && (
                  <ConfirmDialog
                    trigger="İzin kaydet"
                    triggerVariant="secondary"
                    title={`${label} iznini kaydet`}
                    description="Yalnızca müşteri bu kanal için açıkça izin verdiyse kaydedin. Kayıt, kim tarafından ve ne zaman yapıldığıyla saklanır."
                    confirmLabel="İzni kaydet"
                    confirmVariant="primary"
                    action={setConsentAction}
                    fields={{ customerId, channel: row.channel, grant: "1" }}
                  >
                    <label htmlFor={`grant-note-${row.channel}`} className="mb-1.5 block text-[13px] font-medium">
                      İzin nasıl alındı? <span aria-hidden className="text-muted">*</span>
                    </label>
                    <input
                      id={`grant-note-${row.channel}`}
                      name="note"
                      required
                      minLength={3}
                      maxLength={300}
                      className="input"
                      placeholder="Ör. Kasa kayıt formu, 14 Eylül"
                    />
                  </ConfirmDialog>
                )
              ))}
          </li>
        );
      })}
    </ul>
  );
}
