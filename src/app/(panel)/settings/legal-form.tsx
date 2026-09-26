"use client";

import { useActionState } from "react";
import Link from "next/link";
import { saveTenantLegalAction } from "@/modules/legal/actions";
import type { TenantLegalView } from "@/modules/legal/tenant-legal";
import { IDLE, fieldError, valueOf } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";

/**
 * Veri sorumlusu bilgileri. Müşteriye açık kayıt formlarında gösterilir;
 * eksikse form, aydınlatma yükümlülüğünün karşılanmadığını açıkça belirtir.
 */
export function LegalForm({ legal }: { legal: TenantLegalView }) {
  const [state, action, pending] = useActionState(saveTenantLegalAction, IDLE);
  const err = (name: string) => fieldError(state, name);
  const initial = (name: keyof TenantLegalView, fallback: string | null) => valueOf(state, name, fallback ?? "");

  return (
    <Card>
      <CardHeader
        title="Yasal bilgiler (veri sorumlusu)"
        description="Müşteriye açık kayıt formlarında ve ticari iletilerde gösterilir. Bu bilgiler işletmenize aittir."
      />
      <form action={action} className="space-y-4 p-5" noValidate>
        {state.status === "error" && !state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}
        {state.status === "success" && <FormAlert tone="success">{state.message}</FormAlert>}

        {!legal.ready && state.status === "idle" && (
          <FormAlert tone="error">
            <p>
              <strong className="font-medium">Kayıt formları aydınlatma yükümlülüğünü karşılamıyor.</strong> Eksik: {legal.missing.join(", ")}.
              Bu alanlar dolana kadar QR menü ve davet formlarında uyarı görünür.
            </p>
          </FormAlert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ticaret unvanı" htmlFor="legalName" required showOptional={false} error={err("legalName")} hint="Ör. Örnek Gıda ve Turizm A.Ş.">
            <input {...describedBy("legalName", err("legalName"), true)} name="legalName" defaultValue={initial("legalName", legal.legalName)} maxLength={200} className="input" />
          </Field>
          <Field label="Başvuru e-postası" htmlFor="legalEmail" required showOptional={false} error={err("legalEmail")} hint="KVKK başvuruları bu adrese gelir">
            <input {...describedBy("legalEmail", err("legalEmail"), true)} name="legalEmail" type="email" defaultValue={initial("legalEmail", legal.legalEmail)} maxLength={254} className="input" />
          </Field>
        </div>

        <Field label="Adres" htmlFor="legalAddress" error={err("legalAddress")}>
          <input {...describedBy("legalAddress", err("legalAddress"))} name="legalAddress" defaultValue={initial("legalAddress", legal.legalAddress)} maxLength={400} className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="MERSİS no" htmlFor="mersis" error={err("mersis")}>
            <input {...describedBy("mersis", err("mersis"))} name="mersis" defaultValue={initial("mersis", legal.mersis)} maxLength={40} className="input" />
          </Field>
          <Field label="VERBİS no" htmlFor="verbisId" error={err("verbisId")} hint="Kayıt yükümlülüğünüz varsa">
            <input {...describedBy("verbisId", err("verbisId"), true)} name="verbisId" defaultValue={initial("verbisId", legal.verbisId)} maxLength={40} className="input" />
          </Field>
          <Field label="Telefon" htmlFor="legalPhone" error={err("legalPhone")}>
            <input {...describedBy("legalPhone", err("legalPhone"))} name="legalPhone" defaultValue={initial("legalPhone", legal.legalPhone)} maxLength={40} className="input" />
          </Field>
        </div>

        <Field
          label="Aydınlatma metni adresi"
          htmlFor="privacyUrl"
          required
          showOptional={false}
          error={err("privacyUrl")}
          hint="Kendi sitenizdeki KVKK aydınlatma metninin adresi; kayıt formunda bağlantı olarak gösterilir"
        >
          <input
            {...describedBy("privacyUrl", err("privacyUrl"), true)}
            name="privacyUrl"
            type="url"
            inputMode="url"
            placeholder="https://ornek.com/aydinlatma-metni"
            defaultValue={initial("privacyUrl", legal.privacyUrl)}
            maxLength={500}
            className="input"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending && <Spinner size={14} />}
            Kaydet
          </Button>
          <p className="text-[12px] leading-relaxed text-muted">
            Aydınlatma metninin içeriğinden siz sorumlusunuz.{" "}
            <Link href="/yasal/veri-isleme" className="text-fg underline-offset-4 hover:underline">
              Rol dağılımını görün
            </Link>
            .
          </p>
        </div>
      </form>
    </Card>
  );
}
