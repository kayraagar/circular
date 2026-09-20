"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireServiceContext } from "@/lib/context";
import { formString, setFlash, success, toErrorState } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { formatPhone } from "@/lib/normalize";
import {
  addExistingGuest,
  addNewGuest,
  cancelRegistration,
  changeEventStatus,
  createEvent,
  searchGuestCandidates,
  updateEvent,
} from "./service";

const EVENT_FIELDS = [
  "name",
  "venueId",
  "description",
  "startsAt",
  "endsAt",
  "capacity",
  "registrationOpensAt",
  "registrationClosesAt",
  "entryClosesAt",
  "status",
] as const;

function readEventForm(formData: FormData) {
  return Object.fromEntries(EVENT_FIELDS.map((k) => [k, formString(formData, k)]));
}

export async function createEventAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = readEventForm(formData);
  let id: string;
  try {
    const ctx = await requireServiceContext();
    id = (await createEvent(ctx, values)).id;
  } catch (error) {
    return toErrorState(error, values);
  }
  await setFlash("Etkinlik oluşturuldu. Şimdi guest ekleyebilirsiniz.");
  revalidatePath("/events");
  redirect(`/events/${id}`);
}

export async function updateEventAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = readEventForm(formData);
  try {
    const ctx = await requireServiceContext();
    await updateEvent(ctx, id, values);
  } catch (error) {
    return toErrorState(error, values);
  }
  await setFlash("Etkinlik güncellendi.");
  revalidatePath(`/events/${id}`);
  redirect(`/events/${id}`);
}

const STATUS_MESSAGES: Record<string, string> = {
  publish: "Etkinlik yayına alındı.",
  unpublish: "Etkinlik taslağa alındı.",
  cancel: "Etkinlik iptal edildi.",
};

export async function changeEventStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formString(formData, "eventId");
  const op = formString(formData, "op");
  try {
    const ctx = await requireServiceContext();
    await changeEventStatus(ctx, id, op);
  } catch (error) {
    return toErrorState(error);
  }
  revalidatePath(`/events/${id}`);
  revalidatePath("/events");
  return success(STATUS_MESSAGES[op] ?? "Güncellendi.");
}

export async function addExistingGuestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const eventId = formString(formData, "eventId");
  const values = {
    customerId: formString(formData, "customerId"),
    partySize: formString(formData, "partySize"),
    note: formString(formData, "note"),
  };
  try {
    const ctx = await requireServiceContext();
    await addExistingGuest(ctx, eventId, values);
  } catch (error) {
    return toErrorState(error, values);
  }
  revalidatePath(`/events/${eventId}`);
  return success("Guest listeye eklendi.");
}

export async function addNewGuestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const eventId = formString(formData, "eventId");
  const values = {
    firstName: formString(formData, "firstName"),
    lastName: formString(formData, "lastName"),
    phone: formString(formData, "phone"),
    email: formString(formData, "email"),
    partySize: formString(formData, "partySize"),
    note: formString(formData, "note"),
  };
  try {
    const ctx = await requireServiceContext();
    await addNewGuest(ctx, eventId, values);
  } catch (error) {
    return toErrorState(error, values);
  }
  revalidatePath(`/events/${eventId}`);
  return success("Müşteri kaydı oluşturuldu ve guest listeye eklendi.");
}

export async function cancelRegistrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const eventId = formString(formData, "eventId");
  try {
    const ctx = await requireServiceContext();
    await cancelRegistration(ctx, formString(formData, "registrationId"));
  } catch (error) {
    return toErrorState(error);
  }
  revalidatePath(`/events/${eventId}`);
  return success("Guest kaydı iptal edildi.");
}

export type GuestCandidate = {
  id: string;
  name: string;
  contact: string;
  registration: string | null;
};

export async function searchGuestCandidatesAction(
  eventId: string,
  query: string,
): Promise<{ ok: true; items: GuestCandidate[] } | { ok: false; message: string }> {
  try {
    const ctx = await requireServiceContext();
    const rows = await searchGuestCandidates(ctx, eventId, query.slice(0, 100));
    return {
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        contact: [formatPhone(r.phone), r.email].filter(Boolean).join(" · "),
        registration: r.registration,
      })),
    };
  } catch (error) {
    const state = toErrorState(error);
    return { ok: false, message: state.status === "error" ? state.message : "Arama yapılamadı." };
  }
}
