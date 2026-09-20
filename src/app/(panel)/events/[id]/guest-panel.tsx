"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { IDLE, fieldError, valueOf, type ActionState } from "@/lib/action-state";
import { MAX_PARTY_SIZE } from "@/lib/domain";
import {
  addExistingGuestAction,
  addNewGuestAction,
  searchGuestCandidatesAction,
  type GuestCandidate,
} from "@/modules/events/actions";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card, Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { IconSearch } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";

type Tab = "existing" | "new";

export function GuestPanel({ eventId, remaining }: { eventId: string; remaining: number | null }) {
  const [tab, setTab] = useState<Tab>("existing");
  const baseId = useId();
  const tabs: { id: Tab; label: string }[] = [
    { id: "existing", label: "Kayıtlı müşteri" },
    { id: "new", label: "Yeni kişi" },
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 pt-4">
        <div className="pb-3">
          <h2 className="text-[15px] font-medium">Guest ekle</h2>
          <p className="text-[13px] text-muted">
            {remaining === null ? "Kapasite sınırı yok" : `Kalan kapasite: ${remaining} kişi`}
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Guest ekleme yöntemi"
          className="flex gap-1"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              const next = tab === "existing" ? "new" : "existing";
              setTab(next);
              document.getElementById(`${baseId}-tab-${next}`)?.focus();
            }
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`${baseId}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b px-3 pb-3 text-sm transition-colors ${
                tab === t.id ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div id={`${baseId}-panel-${tab}`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="p-5">
        {tab === "existing" ? (
          <ExistingGuestForm eventId={eventId} onCreateNew={() => setTab("new")} />
        ) : (
          <NewGuestForm eventId={eventId} />
        )}
      </div>
    </Card>
  );
}

function PartyAndNote({ state, idPrefix }: { state: ActionState; idPrefix: string }) {
  const psErr = fieldError(state, "partySize");
  const noteErr = fieldError(state, "note");
  return (
    <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
      <Field label="Kişi sayısı" htmlFor={`${idPrefix}-partySize`} error={psErr} required>
        <input
          {...describedBy(`${idPrefix}-partySize`, psErr)}
          name="partySize"
          type="number"
          min={1}
          max={MAX_PARTY_SIZE}
          defaultValue={valueOf(state, "partySize", "1")}
          inputMode="numeric"
          className="input"
          required
        />
      </Field>
      <Field label="Not" htmlFor={`${idPrefix}-note`} error={noteErr}>
        <input
          {...describedBy(`${idPrefix}-note`, noteErr)}
          name="note"
          maxLength={300}
          defaultValue={valueOf(state, "note")}
          placeholder="Ör. Doğum günü masası"
          className="input"
        />
      </Field>
      <p className="-mt-2 text-[13px] text-muted sm:col-span-2">
        Kişi sayısı ana misafir dahil toplamdır. İsmi bilinmeyen ek kişiler ayrı CRM müşterisi olarak kaydedilmez.
      </p>
    </div>
  );
}

function ExistingGuestForm({ eventId, onCreateNew }: { eventId: string; onCreateNew: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GuestCandidate[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<GuestCandidate | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const r = await addExistingGuestAction(prev, fd);
    if (r.status === "success") {
      toast(r.message);
      setSelected(null);
      setQuery("");
      setResults(null);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    return r;
  }, IDLE);

  useEffect(() => {
    if (selected) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(async () => {
      const r = await searchGuestCandidatesAction(eventId, q);
      if (cancelled) return;
      setSearching(false);
      setResults(r.ok ? r.items : []);
      setSearchError(r.ok ? null : r.message);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, eventId, selected]);

  if (selected) {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="customerId" value={selected.id} />
        {state.status === "error" && !fieldError(state, "partySize") && !fieldError(state, "note") && (
          <FormAlert tone="error">{state.message}</FormAlert>
        )}
        <div className="flex items-center gap-3 rounded-field border border-line bg-raised px-3.5 py-3">
          <Avatar name={selected.name} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{selected.name}</p>
            <p className="truncate font-mono text-[12px] text-muted">{selected.contact}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            Değiştir
          </Button>
        </div>
        <PartyAndNote state={state} idPrefix="existing" />
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Ekleniyor">Guest olarak ekle</SubmitButton>
        </div>
      </form>
    );
  }

  return (
    <div>
      <label htmlFor="guest-search" className="mb-1.5 block text-[13px] font-medium">
        Müşteri ara
      </label>
      <div className="relative">
        <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          ref={searchRef}
          id="guest-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="İsim, telefon veya e-posta (en az 2 karakter)"
          autoComplete="off"
          aria-describedby="guest-search-status"
          className="input !pl-9"
        />
        {searching && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2 text-muted">
            <Spinner size={14} label="Aranıyor" />
          </span>
        )}
      </div>
      <p id="guest-search-status" className="sr-only" aria-live="polite">
        {results ? `${results.length} sonuç` : ""}
      </p>
      {searchError && (
        <div className="mt-3">
          <FormAlert tone="error">{searchError}</FormAlert>
        </div>
      )}
      {results && results.length === 0 && !searchError && (
        <div className="mt-3 rounded-field border border-dashed border-line px-4 py-4 text-sm text-muted">
          Eşleşen müşteri yok.{" "}
          <button type="button" onClick={onCreateNew} className="text-fg underline underline-offset-4">
            Yeni kişi olarak ekleyin
          </button>
        </div>
      )}
      {results && results.length > 0 && (
        <ul className="mt-3 overflow-hidden rounded-field border border-line">
          {results.map((c) => {
            const listed = c.registration === "ACTIVE";
            return (
              <li key={c.id} className="border-line [&+li]:border-t">
                <button
                  type="button"
                  disabled={listed}
                  onClick={() => setSelected(c)}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-raised focus-visible:bg-raised disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <Avatar name={c.name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${listed ? "text-muted" : "text-fg"}`}>{c.name}</span>
                    <span className="block truncate font-mono text-[12px] text-muted">{c.contact}</span>
                  </span>
                  {listed ? (
                    <Badge tone="muted">Listede</Badge>
                  ) : c.registration === "CANCELLED" ? (
                    <Badge tone="caution">İptal edilmiş kayıt</Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type ExistingDetail = { customerId: string; name: string; alreadyRegistered: boolean; archived: boolean };

function NewGuestForm({ eventId }: { eventId: string }) {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const r = await addNewGuestAction(prev, fd);
    if (r.status === "success") toast(r.message);
    return r;
  }, IDLE);
  const [linkState, linkAction] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const r = await addExistingGuestAction(prev, fd);
    if (r.status === "success") {
      toast(r.message);
      if (state.status === "error") setDismissedAt(state.at);
    }
    return r;
  }, IDLE);

  const existing =
    state.status === "error" && state.code === "EXISTING_CUSTOMER" && state.at !== dismissedAt
      ? (state.detail as ExistingDetail)
      : null;
  const err = (k: string) => fieldError(state, k);
  const key = state.status === "idle" ? "initial" : state.at;
  const hasFieldErrors = state.status === "error" && state.fieldErrors && Object.keys(state.fieldErrors).length > 0;

  return (
    <div className="space-y-4">
      {existing && (
        <FormAlert tone="info">
          <p className="text-fg">{state.status === "error" && state.message}</p>
          {existing.alreadyRegistered ? (
            <p>
              Bu kişi zaten guest listesinde.{" "}
              <Link href={`/customers/${existing.customerId}`} className="underline underline-offset-4">
                Profili aç
              </Link>
            </p>
          ) : (
            <form action={linkAction} className="flex flex-wrap items-center gap-2 pt-1">
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="customerId" value={existing.customerId} />
              <input type="hidden" name="partySize" value={valueOf(state, "partySize", "1")} />
              <input type="hidden" name="note" value={valueOf(state, "note")} />
              <SubmitButton size="sm" variant="primary" pendingLabel="Ekleniyor">
                {existing.name} kaydını ekle
              </SubmitButton>
              <Link href={`/customers/${existing.customerId}`} target="_blank" rel="noopener" className="text-[13px] underline underline-offset-4">
                Profili görüntüle
              </Link>
            </form>
          )}
          {linkState.status === "error" && <p className="text-negative">{linkState.message}</p>}
        </FormAlert>
      )}

      <form key={key} action={action} className="space-y-4" noValidate>
        <input type="hidden" name="eventId" value={eventId} />
        {state.status === "error" && !existing && state.code !== "EXISTING_CUSTOMER" && (
          <FormAlert tone="error">{state.message}</FormAlert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" htmlFor="ng-firstName" error={err("firstName")} required>
            <input {...describedBy("ng-firstName", err("firstName"))} name="firstName" defaultValue={valueOf(state, "firstName")} maxLength={80} autoComplete="off" className="input" />
          </Field>
          <Field label="Soyad" htmlFor="ng-lastName" error={err("lastName")} required>
            <input {...describedBy("ng-lastName", err("lastName"))} name="lastName" defaultValue={valueOf(state, "lastName")} maxLength={80} autoComplete="off" className="input" />
          </Field>
          <Field label="Telefon" htmlFor="ng-phone" error={err("phone")} showOptional={false}>
            <input {...describedBy("ng-phone", err("phone"))} name="phone" type="tel" inputMode="tel" defaultValue={valueOf(state, "phone")} autoComplete="off" className="input" />
          </Field>
          <Field label="E-posta" htmlFor="ng-email" error={err("email")} showOptional={false}>
            <input {...describedBy("ng-email", err("email"))} name="email" type="email" inputMode="email" defaultValue={valueOf(state, "email")} autoComplete="off" className="input" />
          </Field>
        </div>
        <PartyAndNote state={hasFieldErrors || existing ? state : IDLE} idPrefix="new" />
        <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-muted">
            Telefon veya e-postadan biri gerekli. Kişi CRM&apos;e &quot;Guest listesi&quot; kaynağıyla eklenir;{" "}
            <span className="text-fg">iletişim izni veya üyelik oluşturulmaz.</span>
          </p>
          <SubmitButton pendingLabel="Kaydediliyor" className="shrink-0">
            Kaydet ve ekle
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
