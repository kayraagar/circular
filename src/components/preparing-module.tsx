import type { ReactNode } from "react";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

/**
 * Henüz geliştirilmemiş modüller için dürüst bilgi sayfası.
 * Çalışmayan buton veya örnek metrik içermez.
 */
export function PreparingModule({
  title,
  summary,
  planned,
  foundations,
  principles,
  footer,
}: {
  title: string;
  summary: string;
  planned: string[];
  foundations: string[];
  principles?: string[];
  footer?: ReactNode;
}) {
  return (
    <>
      <PageHeader eyebrow="Modül" title={title} description={summary} actions={<Badge tone="caution">Hazırlanıyor</Badge>} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Planlanan yetenekler" description="Bu modül henüz kullanılabilir değil." />
          <ol className="p-2">
            {planned.map((item, i) => (
              <li key={item} className="flex gap-4 rounded-field px-3 py-3 text-sm">
                <span className="w-6 shrink-0 font-mono text-[12px] text-muted" data-numeric>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-fg">{item}</span>
              </li>
            ))}
          </ol>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Şimdiden hazır olan altyapı" />
            <ul className="space-y-2.5 p-5 text-[13px]">
              {foundations.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <span aria-hidden className="mt-[5px] size-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="text-muted">{f}</span>
                </li>
              ))}
            </ul>
          </Card>
          {principles && (
            <Card>
              <CardHeader title="İlkeler" />
              <ul className="space-y-2.5 p-5 text-[13px]">
                {principles.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <span aria-hidden className="mt-[5px] size-1.5 shrink-0 rounded-full border border-accent" />
                    <span className="text-muted">{p}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {footer}
        </div>
      </div>
    </>
  );
}
