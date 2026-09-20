import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/context";
import { orNotFound } from "@/lib/page";
import { toLocalInputValue } from "@/lib/datetime";
import { updateEventAction } from "@/modules/events/actions";
import { getEventForEdit } from "@/modules/events/service";
import { PageHeader } from "@/components/ui/primitives";
import { EventForm } from "../../event-form";

export const metadata: Metadata = { title: "Etkinliği düzenle" };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("events.manage");
  const { id } = await params;
  const event = await orNotFound(getEventForEdit(ctx.service, id));
  if (event.status === "CANCELLED") redirect(`/events/${event.id}`);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: `/events/${event.id}`, label: event.name }} eyebrow={event.venue.name} title="Etkinliği düzenle" />
      <EventForm
        mode="edit"
        action={updateEventAction.bind(null, event.id)}
        venues={ctx.venues}
        cancelHref={`/events/${event.id}`}
        initial={{
          name: event.name,
          venueId: event.venueId,
          description: event.description ?? "",
          startsAt: toLocalInputValue(event.startsAt),
          endsAt: toLocalInputValue(event.endsAt),
          capacity: event.capacity ? String(event.capacity) : "",
          registrationOpensAt: toLocalInputValue(event.registrationOpensAt),
          registrationClosesAt: toLocalInputValue(event.registrationClosesAt),
          entryClosesAt: toLocalInputValue(event.entryClosesAt),
          status: event.status,
        }}
      />
    </div>
  );
}
