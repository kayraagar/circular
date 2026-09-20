"use client";

import { MENU_TEMPLATES, applyTemplate } from "@/modules/menu/templates";
import type { MenuConfigView, ThemeStyle } from "@/modules/menu/theme";
import { MenuPreview } from "./menu-preview";

const THUMB_WIDTH = 320;
const THUMB_SCALE = 0.5;

/**
 * Şablon galerisi: her kartta şablonun örnek içerikle küçük canlı önizlemesi.
 * İşletmenin logosu, kapağı ve sloganı önizlemede korunur; seçim önizlemeyi anında değiştirir.
 * Kolon sayısı ekran değil kapsayıcı genişliğine göre belirlenir (yanda önizleme sütunu olduğu için).
 */
export function TemplateGallery({
  config,
  title,
  onSelect,
}: {
  config: MenuConfigView;
  title: string;
  onSelect: (id: ThemeStyle) => void;
}) {
  return (
    <div className="@container">
      <div role="radiogroup" aria-label="Menü şablonları" className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
        {MENU_TEMPLATES.map((template) => {
          const preview = applyTemplate(config, template.id);
          const active = config.themeStyle === template.id;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(template.id)}
              className={`flex min-w-0 flex-col rounded-field border p-3 text-left transition-colors ${
                active ? "border-fg bg-raised" : "border-line hover:border-line-strong hover:bg-raised/40"
              }`}
            >
              <div
                aria-hidden
                inert
                className="relative mx-auto shrink-0 overflow-hidden rounded-[14px] border border-line"
                style={{ width: THUMB_WIDTH * THUMB_SCALE, height: 220, background: preview.backgroundColor }}
              >
                <div className="pointer-events-none absolute top-0 left-0 origin-top-left" style={{ width: THUMB_WIDTH, transform: `scale(${THUMB_SCALE})` }}>
                  <MenuPreview config={preview} categories={[]} title={title} forceSample interactive={false} showSampleNotice={false} />
                </div>
              </div>
              <div className="mt-3 min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {template.name}
                  {active && <span className="rounded-full bg-fg px-1.5 py-[1px] text-[10px] leading-4 text-bg">Seçili</span>}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{template.summary}</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted/80">{template.suits}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
