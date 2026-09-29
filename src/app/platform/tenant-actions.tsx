"use client";

import { useActionState, useState } from "react";
import { grantSupportAccessAction, setTenantStatusAction } from "@/modules/platform/actions";
import { IDLE, fieldError } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * İşletme satırındaki işlemler. Her ikisi de gerekçe ister: askıya alma iş durdurur,
 * destek erişimi müşteri verisine bakmayı mümkün kılar.
 */
export function TenantRowActions({
  tenantId,
  tenantName,
  suspended,
  maxHours,
}: {
  tenantId: string;
  tenantName: string;
  suspended: boolean;
  maxHours: number;
}) {
  const [open, setOpen] = useState<"suspend" | "support" | null>(null);
  const [statusState, statusAction] = useActionState(setTenantStatusAction, IDLE);
  const [grantState, grantAction] = useActionState(grantSupportAccessAction, IDLE);

  if (open === "suspend") {
    return (
      <form action={statusAction} className="w-full space-y-2 rounded-field border border-line bg-raised/40 p-3.5">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="suspend" value={suspended ? "false" : "true"} />
        {statusState.status === "error" && <FormAlert tone="error">{statusState.message}</FormAlert>}
        <label htmlFor={`reason-${tenantId}`} className="block text-[13px] font-medium text-fg">
          {suspended ? `${tenantName} askısını kaldırma gerekçesi` : `${tenantName} askıya alma gerekçesi`}
        </label>
        <input
          id={`reason-${tenantId}`}
          name="reason"
          maxLength={300}
          required
          className="input"
          placeholder={suspended ? "Ödeme alındı" : "Ödeme gecikmesi / sözleşme ihlali"}
        />
        {fieldError(statusState, "reason") && <p className="text-[13px] text-negative">{fieldError(statusState, "reason")}</p>}
        <p className="text-[12px] leading-relaxed text-muted">
          {suspended
            ? "İşletme yeniden panele girebilir ve müşteriye açık sayfaları açılır."
            : "Panel girişleri ve müşteriye açık sayfalar kapanır, açık oturumlar düşer. Veri silinmez."}
        </p>
        <div className="flex gap-2">
          <SubmitButton size="sm" variant={suspended ? "primary" : "danger"} pendingLabel="Uygulanıyor">
            {suspended ? "Askıyı kaldır" : "Askıya al"}
          </SubmitButton>
          <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
            Vazgeç
          </Button>
        </div>
      </form>
    );
  }

  if (open === "support") {
    return (
      <form action={grantAction} className="w-full space-y-2 rounded-field border border-line bg-raised/40 p-3.5">
        <input type="hidden" name="tenantId" value={tenantId} />
        {grantState.status === "error" && <FormAlert tone="error">{grantState.message}</FormAlert>}
        {grantState.status === "success" && <FormAlert tone="success">{grantState.message}</FormAlert>}
        <label htmlFor={`support-${tenantId}`} className="block text-[13px] font-medium text-fg">
          Destek erişimi gerekçesi
        </label>
        <input id={`support-${tenantId}`} name="reason" maxLength={300} required className="input" placeholder="Destek talebi #123 — kampanya gönderilmiyor" />
        {fieldError(grantState, "reason") && <p className="text-[13px] text-negative">{fieldError(grantState, "reason")}</p>}
        <label htmlFor={`hours-${tenantId}`} className="block text-[13px] font-medium text-fg">
          Süre (saat)
        </label>
        <input id={`hours-${tenantId}`} name="hours" type="number" min={1} max={maxHours} defaultValue={2} className="input w-24" />
        <p className="text-[12px] leading-relaxed text-muted">
          Erişim gerçek bir üyelik olarak açılır, süre dolunca kendiliğinden kapanır ve işletmenin aktivite geçmişine
          yazılır — yani {tenantName} kimin ne zaman baktığını görür.
        </p>
        <div className="flex gap-2">
          <SubmitButton size="sm" variant="primary" pendingLabel="Açılıyor">
            Erişim aç
          </SubmitButton>
          <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
            Vazgeç
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen("support")}>
        Destek erişimi
      </Button>
      <Button size="sm" variant={suspended ? "secondary" : "danger"} onClick={() => setOpen("suspend")}>
        {suspended ? "Askıyı kaldır" : "Askıya al"}
      </Button>
    </>
  );
}
