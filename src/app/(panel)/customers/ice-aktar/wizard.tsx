"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewImportAction, runImportAction } from "@/modules/import/actions";
import type { ImportPreview, RowIssue } from "@/modules/import/service";
import { IMPORT_FIELD_LABELS, IMPORT_FIELDS } from "@/modules/import/csv";
import { CHANNELS, CHANNEL_LABELS } from "@/lib/domain";
import { IDLE, fieldError } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, FormAlert, Stat } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";
import { SubmitButton } from "@/components/ui/submit-button";

const ISSUE_LABELS: Record<RowIssue, string> = {
  NO_NAME: "Ad yok",
  BAD_PHONE: "Telefon okunamadı",
  NO_CONTACT: "Telefon veya e-posta yok",
  BAD_EMAIL: "E-posta geçersiz",
  BAD_BIRTHDATE: "Doğum tarihi okunamadı",
  DUPLICATE_IN_FILE: "Dosyada tekrar ediyor",
};

/** İki adım: dosyayı oku ve ne olacağını göster, sonra onayla ve yaz. */
export function ImportWizard() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [state, action] = useActionState(runImportAction, IDLE);

  const load = (raw: string, name: string) => {
    setText(raw);
    setFileName(name);
    setError(null);
    startTransition(async () => {
      const result = await previewImportAction(raw);
      if (result.ok) setPreview(result.data);
      else {
        setPreview(null);
        setError(result.message);
      }
    });
  };

  if (state.status === "success") {
    const data = state.data as { created: number; updated: number; skipped: number; invalid: number };
    return (
      <Card>
        <CardHeader title="İçe aktarma tamamlandı" />
        <div className="space-y-4 p-5">
          <FormAlert tone="success">{state.message}</FormAlert>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Eklendi" value={data.created} />
            <Stat label="Tamamlandı" value={data.updated} />
            <Stat label="Atlandı" value={data.skipped} />
            <Stat label="Hatalı" value={data.invalid} />
          </div>
          <Button variant="primary" onClick={() => router.push("/customers")}>
            Müşteri listesine git
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Dosyayı seçin" description="Dosya sunucuda saklanmaz; yalnızca bu işlem için okunur." />
        <div className="space-y-4 p-5">
          {error && <FormAlert tone="error">{error}</FormAlert>}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              load(await file.text(), file.name);
            }}
            className="block w-full text-[13px] text-muted file:mr-3 file:rounded-field file:border file:border-line file:bg-raised file:px-4 file:py-2 file:text-[13px] file:text-fg hover:file:border-line-strong"
          />
          {fileName && <p className="text-[12px] text-muted">{fileName}</p>}
          <details className="text-[13px] text-muted">
            <summary className="cursor-pointer text-fg">Dosya yerine yapıştırmak isterim</summary>
            <textarea
              rows={6}
              onChange={(e) => load(e.target.value, "yapıştırılan metin")}
              placeholder="Ad;Soyad;Telefon;E-posta"
              className="input mt-2 !h-auto py-2 font-mono text-[12px]"
            />
          </details>
          {pending && (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner size={13} /> Okunuyor…
            </p>
          )}
        </div>
      </Card>

      {preview && (
        <form action={action}>
          <input type="hidden" name="text" value={text} />
          <Card>
            <CardHeader title="2. Ne olacak" description={`${preview.total} satır okundu`} />
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Yeni kayıt" value={preview.ready} />
                <Stat label="Zaten kayıtlı" value={preview.duplicates} />
                <Stat label="Hatalı satır" value={preview.invalid} />
              </div>

              {preview.truncated && <FormAlert tone="info">Dosyanın ilk satırları alındı; kalanı için ikinci bir dosya yükleyin.</FormAlert>}

              <div className="flex flex-wrap gap-1.5">
                {IMPORT_FIELDS.map((f) => (
                  <Badge key={f} tone={preview.mapping[f] === -1 ? "muted" : "neutral"}>
                    {IMPORT_FIELD_LABELS[f]}
                    {preview.mapping[f] === -1 ? " · yok" : ` · ${preview.mapping[f] + 1}. sütun`}
                  </Badge>
                ))}
              </div>

              <div className="max-h-72 overflow-auto rounded-field border border-line">
                <table className="w-full min-w-[520px] text-left text-[13px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line text-[12px] text-muted">
                      <th className="px-3 py-2 font-medium">Satır</th>
                      <th className="px-3 py-2 font-medium">Ad</th>
                      <th className="px-3 py-2 font-medium">İletişim</th>
                      <th className="px-3 py-2 font-medium">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 200).map((r) => (
                      <tr key={r.line} className="border-line [&+tr]:border-t">
                        <td className="px-3 py-2 text-muted" data-numeric>
                          {r.line}
                        </td>
                        <td className="px-3 py-2 text-fg">{`${r.firstName} ${r.lastName}`.trim() || "—"}</td>
                        <td className="px-3 py-2 text-muted">{r.phone ?? r.email ?? "—"}</td>
                        <td className="px-3 py-2">
                          {r.issues.length > 0 ? (
                            <span className="text-negative">{r.issues.map((i) => ISSUE_LABELS[i]).join(", ")}</span>
                          ) : r.existingId ? (
                            <span className="text-caution">Zaten kayıtlı{r.existingName ? ` · ${r.existingName}` : ""}</span>
                          ) : (
                            <span className="text-positive">Eklenecek</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 200 && <p className="text-[12px] text-muted">İlk 200 satır gösteriliyor; hepsi işlenecek.</p>}
            </div>
          </Card>

          <Card className="mt-6">
            <CardHeader title="3. Seçenekler" />
            <div className="space-y-4 p-5">
              <label htmlFor="fill-existing" className="flex cursor-pointer gap-3 rounded-field border border-line px-4 py-3 transition-colors hover:border-line-strong has-checked:border-fg has-checked:bg-raised">
                <input id="fill-existing" type="checkbox" name="fillExisting" value="true" className="mt-0.5 size-4 shrink-0 accent-white" />
                <span className="min-w-0">
                  <span className="block text-[13px] text-fg">Zaten kayıtlı kişilerin boş alanlarını doldur</span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                    Yalnızca boş olan telefon, e-posta, doğum tarihi ve not alanları doldurulur. Dolu bilgi asla değişmez.
                  </span>
                </span>
              </label>

              <fieldset className="rounded-field border border-line p-4">
                <legend className="px-1 text-[13px] font-medium text-fg">İletişim izni (isteğe bağlı)</legend>
                <p className="text-[12px] leading-relaxed text-muted">
                  Boş bırakırsanız kayıtlar izinsiz açılır — önerilen budur. İzinleri gerçekten aldıysanız kanalları
                  işaretleyip nasıl alındığını yazın.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {CHANNELS.map((c) => (
                    <label
                      key={c}
                      htmlFor={`consent-${c}`}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-field border border-line px-3 py-1.5 text-[13px] text-fg transition-colors hover:border-line-strong has-checked:border-fg has-checked:bg-raised"
                    >
                      <input id={`consent-${c}`} type="checkbox" name="consentChannels" value={c} className="size-3.5 accent-white" />
                      {CHANNEL_LABELS[c]}
                    </label>
                  ))}
                </div>
                <label htmlFor="consent-note" className="mt-3 block text-[13px] font-medium text-fg">
                  İzin nasıl alındı?
                </label>
                <input
                  id="consent-note"
                  name="consentNote"
                  maxLength={300}
                  placeholder="Örn: 2026 üyelik formları, ıslak imzalı"
                  className="input mt-1.5"
                />
                {fieldError(state, "consentNote") && <p className="mt-1.5 text-[13px] text-negative">{fieldError(state, "consentNote")}</p>}
              </fieldset>

              {state.status === "error" && !state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}

              <SubmitButton variant="primary" pendingLabel="Aktarılıyor">
                {preview.ready + preview.duplicates > 0 ? `${preview.ready} kaydı içe aktar` : "İçe aktar"}
              </SubmitButton>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
