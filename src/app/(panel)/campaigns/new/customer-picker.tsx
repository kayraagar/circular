"use client";

import { useEffect, useState } from "react";
import { searchAudienceAction } from "@/modules/campaigns/actions";
import type { AudienceSearchRow } from "@/modules/campaigns/audience";
import { EXCLUSION_LABELS, MAX_SELECTED_CUSTOMERS, type CampaignChannel } from "@/modules/campaigns/rules";
import { IconSearch } from "@/components/ui/icons";
import { Badge, FormAlert } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";

export type Selected = Pick<AudienceSearchRow, "id" | "name" | "phoneLabel" | "reachable" | "reason">;

/** Tek tek seçim: arama ve seçili kişiler. Gönderime uygun olmayanlar da seçilebilir; özette elenme nedeni görünür. */
export function CustomerPicker({ selected, onChange, channel }: { selected: Selected[]; onChange: (next: Selected[]) => void; channel: CampaignChannel }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AudienceSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const result = await searchAudienceAction(query, channel);
      if (cancelled) return;
      setSearching(false);
      if (result.ok) {
        setRows(result.data);
        setError(null);
      } else setError(result.message);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, channel]);

  const ids = new Set(selected.map((s) => s.id));
  const toggle = (row: Selected) => {
    if (ids.has(row.id)) onChange(selected.filter((s) => s.id !== row.id));
    else if (selected.length < MAX_SELECTED_CUSTOMERS) onChange([...selected, row]);
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ad, telefon veya e-postayla arayın"
          aria-label="Müşteri ara"
          className="input !pl-9"
        />
        {searching && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2">
            <Spinner label="Aranıyor" />
          </span>
        )}
      </div>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {rows.length > 0 && (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-field border border-line">
          {rows.map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 hover:bg-raised/60">
                <input type="checkbox" checked={ids.has(r.id)} onChange={() => toggle(r)} className="size-4 shrink-0 accent-white" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{r.name}</span>
                  <span className="block text-[12px] text-muted">{r.phoneLabel || (channel === "EMAIL" ? "E-posta yok" : "Telefon yok")}</span>
                </span>
                {r.reason && <Badge tone="muted">{EXCLUSION_LABELS[r.reason]}</Badge>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !searching && rows.length === 0 && !error && <p className="text-[13px] text-muted">Sonuç yok.</p>}

      <div>
        <p className="mb-2 text-[13px] text-muted" data-numeric>
          {selected.length} kişi seçildi{selected.length >= MAX_SELECTED_CUSTOMERS ? ` (en fazla ${MAX_SELECTED_CUSTOMERS})` : ""}
        </p>
        {selected.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {selected.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  aria-label={`${s.name} seçimini kaldır`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-[12px] text-fg hover:border-line-strong"
                >
                  {s.name}
                  <span aria-hidden className="text-muted">
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
