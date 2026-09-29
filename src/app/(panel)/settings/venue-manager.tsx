"use client";

import { useActionState, useState } from "react";
import { createVenueAction, setVenueActiveAction, updateVenueAction } from "@/modules/venues/actions";
import type { VenueView } from "@/modules/venues/service";
import { IDLE, fieldError, valueOf, type ActionState } from "@/lib/action-state";
import { VENUE_TYPES, VENUE_TYPE_LABELS } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";

/**
 * Mekan yönetimi: ekleme, düzenleme ve kapatma.
 * Mekan silinmez — geçmiş etkinlik ve giriş kayıtları ona bağlıdır.
 */

function VenueFields({ state, venue }: { state: ActionState; venue?: VenueView }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mekan adı" htmlFor={`name-${venue?.id ?? "new"}`} required showOptional={false} error={fieldError(state, "name")}>
          <input
            {...describedBy(`name-${venue?.id ?? "new"}`, fieldError(state, "name"))}
            name="name"
            maxLength={80}
            defaultValue={valueOf(state, "name", venue?.name ?? "")}
            className="input"
          />
        </Field>
        <Field label="Tür" htmlFor={`type-${venue?.id ?? "new"}`} required showOptional={false} error={fieldError(state, "type")}>
          <select
            {...describedBy(`type-${venue?.id ?? "new"}`, fieldError(state, "type"))}
            name="type"
            defaultValue={valueOf(state, "type", venue?.type ?? "RESTAURANT")}
            className="input"
          >
            {VENUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {VENUE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Şehir" htmlFor={`city-${venue?.id ?? "new"}`} error={fieldError(state, "city")}>
          <input
            {...describedBy(`city-${venue?.id ?? "new"}`, fieldError(state, "city"))}
            name="city"
            maxLength={60}
            defaultValue={valueOf(state, "city", venue?.city ?? "")}
            className="input"
          />
        </Field>
        <Field
          label="Kısa ad"
          htmlFor={`slug-${venue?.id ?? "new"}`}
          hint={venue ? "Müşteriye açık adreste görünür. Değiştirmek eski bağlantıları kırar." : "Boş bırakılırsa mekan adından türetilir."}
          error={fieldError(state, "slug")}
        >
          <input
            {...describedBy(`slug-${venue?.id ?? "new"}`, fieldError(state, "slug"), true)}
            name="slug"
            maxLength={60}
            defaultValue={valueOf(state, "slug", venue?.slug ?? "")}
            className="input font-mono text-[13px]"
          />
        </Field>
      </div>
      <Field label="Adres" htmlFor={`address-${venue?.id ?? "new"}`} error={fieldError(state, "address")}>
        <input
          {...describedBy(`address-${venue?.id ?? "new"}`, fieldError(state, "address"))}
          name="address"
          maxLength={300}
          defaultValue={valueOf(state, "address", venue?.address ?? "")}
          className="input"
        />
      </Field>
    </>
  );
}

function AddVenueForm() {
  const [state, action, pending] = useActionState(createVenueAction, IDLE);
  const general = state.status === "error" && !state.fieldErrors ? state.message : null;
  return (
    <form action={action} className="space-y-4 p-5" noValidate key={state.status === "success" ? state.at : "add"}>
      {general && <FormAlert tone="error">{general}</FormAlert>}
      {state.status === "success" && <FormAlert tone="success">{state.message}</FormAlert>}
      <VenueFields state={state} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Spinner size={14} />}
          Mekan ekle
        </Button>
        <p className="text-[12px] text-muted">Yeni mekan, tüm mekanlara erişimi olan ekip üyelerine hemen görünür.</p>
      </div>
    </form>
  );
}

function EditVenueForm({ venue, onDone }: { venue: VenueView; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateVenueAction, IDLE);
  const general = state.status === "error" && !state.fieldErrors ? state.message : null;
  if (state.status === "success") {
    // Kaydedilince satır kapanır; bildirim toast ile verilir.
    queueMicrotask(onDone);
  }
  return (
    <form action={action} className="mt-3 space-y-4 rounded-field border border-line bg-raised/40 p-4" noValidate>
      <input type="hidden" name="venueId" value={venue.id} />
      {general && <FormAlert tone="error">{general}</FormAlert>}
      <VenueFields state={state} venue={venue} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending && <Spinner size={13} />}
          Kaydet
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

function StatusForm({ venue }: { venue: VenueView }) {
  const [state, action, pending] = useActionState(setVenueActiveAction, IDLE);
  const [seen, setSeen] = useState(0);
  if (state.status !== "idle" && state.at !== seen) {
    setSeen(state.at);
    toast(state.message, state.status === "error" ? "error" : "success");
  }
  return (
    <form action={action}>
      <input type="hidden" name="venueId" value={venue.id} />
      <input type="hidden" name="active" value={venue.isActive ? "false" : "true"} />
      <Button size="sm" variant={venue.isActive ? "danger" : "secondary"} type="submit" disabled={pending}>
        {pending && <Spinner size={13} />}
        {venue.isActive ? "Kapat" : "Yeniden aç"}
      </Button>
    </form>
  );
}

export function VenueManager({ venues }: { venues: VenueView[] }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Mekanlar"
          description="Bir işletmenin birden fazla mekanı/şubesi olabilir. Müşteri kaydı işletme düzeyindedir."
        />
        <ul>
          {venues.map((v) => (
            <li key={v.id} className="border-line px-5 py-4 [&+li]:border-t">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="min-w-[200px] flex-1">
                  <p className="text-sm font-medium text-fg">{v.name}</p>
                  <p className="text-[13px] text-muted">
                    {v.typeLabel}
                    {v.city ? ` · ${v.city}` : ""}
                    {v.eventCount > 0 ? ` · ${v.eventCount} etkinlik` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!v.isActive && <Badge tone="negative">Kapalı</Badge>}
                  <span className="font-mono text-[12px] text-muted">/v/{v.slug}</span>
                  <Badge tone="muted">Public sayfa henüz yok</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === v.id ? null : v.id)} aria-expanded={editing === v.id}>
                    Düzenle
                  </Button>
                  <StatusForm venue={v} />
                </div>
              </div>
              {editing === v.id && <EditVenueForm venue={v} onDone={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Mekan ekle" description="Şube, ikinci nokta veya ayrı konsept için." />
        <AddVenueForm />
      </Card>
    </div>
  );
}
