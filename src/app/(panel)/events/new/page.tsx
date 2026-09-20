import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { localDayKey, parseLocalDateTime, toLocalInputValue } from "@/lib/datetime";
import { createEventAction } from "@/modules/events/actions";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { EventForm } from "../event-form";

export const metadata: Metadata = { title: "Etkinlik oluştur" };

export default async function NewEventPage() {
  const ctx = await requirePermission("events.manage");
  // Varsayılan: bir hafta sonra 21:00–02:00 (İstanbul)
  const start = parseLocalDateTime(`${localDayKey(new Date(Date.now() + 7 * 86400000))}T21:00`);
  const end = start ? new Date(start.getTime() + 5 * 3600000) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: "/events", label: "Etkinlikler" }} eyebrow={ctx.tenant.name} title="Etkinlik oluştur" />
      {ctx.venues.length === 0 ? (
        <div className="card">
          <EmptyState title="Erişebildiğiniz mekan yok" description="Etkinlik oluşturmak için işletmeye tanımlı en az bir mekan gerekir." />
        </div>
      ) : (
        <EventForm
          mode="create"
          action={createEventAction}
          venues={ctx.venues}
          cancelHref="/events"
          initial={{
            name: "",
            venueId: ctx.activeVenue?.id ?? (ctx.venues.length === 1 ? ctx.venues[0].id : ""),
            description: "",
            startsAt: toLocalInputValue(start),
            endsAt: toLocalInputValue(end),
            capacity: "",
            registrationOpensAt: "",
            registrationClosesAt: "",
            entryClosesAt: "",
            status: "DRAFT",
          }}
        />
      )}
    </div>
  );
}
