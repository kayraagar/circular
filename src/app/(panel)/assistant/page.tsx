import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { ASSISTANT_LIMITS, ASSISTANT_SKILLS } from "@/modules/assistant/rules";
import { AssistantChat } from "@/components/assistant/chat";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "AI Asistan" };

/** AI Asistan: sorular kendi verinizden gerçek sayılarla cevaplanır; asistan hiçbir kaydı değiştirmez. */
export default async function AssistantPage() {
  const ctx = await requirePermission("assistant.use");
  // Yalnızca tek bir mekan kapsamdayken mekan adı geçer; "Tüm mekanlar" bir mekan adı değildir
  // ve taslak metinlerde işletme adının yerine geçemez.
  const venueLabel = ctx.activeVenue?.name ?? (ctx.venues.length === 1 ? ctx.venues[0].name : null);

  return (
    <>
      <PageHeader
        eyebrow={`${ctx.tenant.name} · ${venueLabel ?? "Tüm mekanlar"}`}
        title="AI Asistan"
        description="Verinizi okur, gerçek sayılarla cevaplar ve panelde bir işi nasıl yapacağınızı anlatır."
        actions={<Badge tone="muted">Dil modeli bağlı değil</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex min-h-0 flex-col overflow-hidden lg:col-span-2">
          <AssistantChat scope={{ venueId: ctx.activeVenue?.id ?? null, venueLabel }} />
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Neler sorabilirsiniz" description="Her satırın arkasında gerçek bir sorgu var." />
            <ul className="p-2">
              {ASSISTANT_SKILLS.map((skill) => (
                <li key={skill.title} className="rounded-field px-3 py-2.5">
                  <p className="text-[13px] font-medium text-fg">{skill.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">“{skill.example}”</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Sınırlar" />
            <ul className="space-y-2.5 p-5 text-[12px] leading-relaxed">
              {ASSISTANT_LIMITS.map((limit) => (
                <li key={limit} className="flex gap-2.5">
                  <span aria-hidden className="mt-[6px] size-1.5 shrink-0 rounded-full border border-accent" />
                  <span className="text-muted">{limit}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
