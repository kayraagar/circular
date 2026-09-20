"use client";

import { useActionState, useEffect, useId, useState, type ReactNode } from "react";
import {
  createCategoryAction,
  createMenuItemAction,
  deleteCategoryAction,
  deleteMenuItemAction,
  saveMenuConfigAction,
  updateCategoryAction,
  updateMenuItemAction,
} from "@/modules/menu/actions";
import {
  BADGES,
  BADGE_LABELS,
  CORNER_STYLES,
  CORNER_STYLE_LABELS,
  DENSITIES,
  DENSITY_LABELS,
  FONT_PAIRS,
  FONT_PAIR_LABELS,
  HEADER_ALIGNS,
  HEADER_ALIGN_LABELS,
  HEX_COLOR,
  MAX_TAGLINE,
  PRICE_STYLES,
  PRICE_STYLE_LABELS,
  SURFACE_STYLES,
  SURFACE_STYLE_LABELS,
  contrastRatio,
  formatPrice,
  readableForeground,
  type AssetKind,
  type Badge as MenuBadge,
  type MenuCategoryView,
  type MenuConfigView,
  type MenuItemView,
  type MenuView,
  type ThemeStyle,
} from "@/modules/menu/theme";
import { applyTemplate, templateById } from "@/modules/menu/templates";
import { saveMenuCampaignAction } from "@/modules/menu/campaign-actions";
import { CAMPAIGN_LIMITS, publicMenuPath, signupPath, type MenuCampaignView } from "@/modules/menu/campaign";
import { CampaignPopupPreview } from "@/components/menu/campaign-popup";
import { CopyButton } from "@/components/copy-button";
import { IDLE, fieldError, type ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardHeader, EmptyState, Field, FormAlert } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { toast } from "@/components/ui/toaster";
import { ImageCropper } from "./image-cropper";
import { MenuPreview, PhoneFrame } from "./menu-preview";
import { TemplateGallery } from "./template-gallery";

const MAX_BADGES = 3;

/** Başarılı işlemde bildirim gösterir; isteğe bağlı olarak formu kapatır. */
function useActionToast(state: ActionState, onSuccess?: () => void) {
  useEffect(() => {
    if (state.status === "success") {
      toast(state.message);
      onSuccess?.();
    }
    // onSuccess kasıtlı olarak bağımlılıkta değil: yalnızca durum değiştiğinde çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

function firstError(state: ActionState): string | null {
  if (state.status !== "error") return null;
  const field = state.fieldErrors ? Object.values(state.fieldErrors).flat().find(Boolean) : undefined;
  return field ?? state.message;
}

const isUploaded = (src: string | null) => !!src && src.startsWith("/media/menu/");

/** Taslak ayarı formun gizli alanlarına dönüştürür (görünür kontroller ad taşımaz). */
function configFields(c: MenuConfigView): Record<string, string> {
  const bool = (v: boolean) => (v ? "1" : "0");
  return {
    logoAssetId: c.logoAssetId ?? "",
    coverAssetId: c.coverAssetId ?? "",
    legacyLogoUrl: !c.logoAssetId && c.logoSrc && !isUploaded(c.logoSrc) ? c.logoSrc : "",
    backgroundColor: c.backgroundColor,
    accentColor: c.accentColor,
    textColor: c.textColor ?? "",
    themeStyle: c.themeStyle,
    fontPair: c.fontPair,
    cornerStyle: c.cornerStyle,
    surfaceStyle: c.surfaceStyle,
    density: c.density,
    headerAlign: c.headerAlign,
    priceStyle: c.priceStyle,
    tagline: c.tagline ?? "",
    showImages: bool(c.showImages),
    showDescriptions: bool(c.showDescriptions),
    showCategoryNav: bool(c.showCategoryNav),
    showFeatured: bool(c.showFeatured),
  };
}

// ─────────────────────────────────────────────── Küçük kontroller

function Segmented<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <label
            key={option}
            className={`cursor-pointer rounded-field border px-3 py-1.5 text-[13px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-fg ${
              value === option ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} className="sr-only" />
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? "border-fg bg-fg" : "border-line bg-raised"}`}
      >
        <span
          className={`absolute top-[2px] size-[18px] rounded-full transition-transform motion-reduce:transition-none ${
            checked ? "translate-x-[22px] bg-bg" : "translate-x-[2px] bg-muted"
          }`}
        />
      </button>
    </div>
  );
}

function ColorField({ label, value, hint, onChange }: { label: string; value: string; hint?: string; onChange: (value: string) => void }) {
  const id = useId();
  const valid = HEX_COLOR.test(value);
  return (
    <Field label={label} htmlFor={id} hint={hint} error={valid ? undefined : "#RRGGBB biçiminde girin (ör. #080808)."}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} renk seçici`}
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-field border border-line bg-raised p-1"
        />
        <input id={id} value={value} maxLength={7} spellCheck={false} onChange={(e) => onChange(e.target.value.trim())} className="input font-mono !text-[13px]" />
      </div>
    </Field>
  );
}

function AssetField({
  label,
  kind,
  src,
  shape,
  hint,
  defaultAspect,
  onChange,
}: {
  label: string;
  kind: AssetKind;
  src: string | null;
  shape: "circle" | "wide" | "square";
  hint?: string;
  defaultAspect?: string;
  onChange: (asset: { assetId: string; src: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const frame = shape === "circle" ? "size-14 rounded-full" : shape === "wide" ? "h-14 w-24 rounded-field" : "size-14 rounded-field";
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <div
          className={`${frame} flex shrink-0 items-center justify-center overflow-hidden border border-line bg-raised bg-cover bg-center`}
          style={src ? { backgroundImage: `url("${src}")` } : undefined}
          role={src ? "img" : undefined}
          aria-label={src ? label : undefined}
        >
          {!src && <span className="text-[11px] text-muted">Yok</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            {src ? "Değiştir" : "Yükle"}
          </Button>
          {src && (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Kaldır
            </Button>
          )}
        </div>
      </div>
      {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{hint}</p>}
      <ImageCropper
        kind={kind}
        defaultAspect={defaultAspect}
        open={open}
        onClose={() => setOpen(false)}
        onUploaded={(asset) => onChange({ assetId: asset.assetId, src: asset.src })}
      />
    </div>
  );
}

// ─────────────────────────────────────────────── Tasarım

function DesignPanel({
  draft,
  saved,
  title,
  setDraft,
}: {
  draft: MenuConfigView;
  saved: MenuConfigView;
  title: string;
  setDraft: (config: MenuConfigView) => void;
}) {
  const [state, action] = useActionState(saveMenuConfigAction, IDLE);
  const [undo, setUndo] = useState<{ previous: MenuConfigView; name: string } | null>(null);
  useActionToast(state, () => setUndo(null));

  const set = <K extends keyof MenuConfigView>(key: K, value: MenuConfigView[K]) => setDraft({ ...draft, [key]: value });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const autoText = draft.textColor === null;
  const fg = !autoText && HEX_COLOR.test(draft.textColor!) ? draft.textColor! : readableForeground(draft.backgroundColor);
  const contrast = HEX_COLOR.test(draft.backgroundColor) ? contrastRatio(fg, draft.backgroundColor) : 21;
  const error = firstError(state);

  function selectTemplate(id: ThemeStyle) {
    if (id === draft.themeStyle) return;
    setUndo({ previous: draft, name: templateById(id).name });
    setDraft(applyTemplate(draft, id));
  }

  return (
    <form action={action} className="space-y-6" noValidate>
      {Object.entries(configFields(draft)).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {error && <FormAlert tone="error">{error}</FormAlert>}

      <Card>
        <CardHeader title="Şablon" description="Bir şablona dokunun; önizleme anında değişir. Ardından aşağıdaki ayarlarla kişiselleştirin." />
        <div className="space-y-3 p-5">
          {undo && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-line bg-raised px-3 py-2 text-[13px]">
              <span>
                <span className="font-medium text-fg">{undo.name}</span> uygulandı: düzen, renkler ve yazı tipi şablondan geldi.
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(undo.previous);
                  setUndo(null);
                }}
              >
                Geri al
              </Button>
            </div>
          )}
          <TemplateGallery config={draft} title={title} onSelect={selectTemplate} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Marka" description="Logo ve kapak görseli yükleyip menüde görünecek alanı kırpın." />
        <div className="grid gap-6 p-5 sm:grid-cols-2">
          <AssetField
            label="Logo"
            kind="LOGO"
            shape="circle"
            src={draft.logoSrc}
            hint="Yüklenmezse ince çizgili dairesel motif kullanılır."
            onChange={(asset) => setDraft({ ...draft, logoAssetId: asset?.assetId ?? null, logoSrc: asset?.src ?? null })}
          />
          <AssetField
            label="Kapak görseli"
            kind="COVER"
            shape="wide"
            src={draft.coverSrc}
            hint="İsteğe bağlı; menünün en üstünde geniş görsel olarak görünür."
            onChange={(asset) => setDraft({ ...draft, coverAssetId: asset?.assetId ?? null, coverSrc: asset?.src ?? null })}
          />
          <Field label="Slogan" htmlFor="menu-tagline" hint={`Ör. "Karaköy · Her gün 18:00–02:00" · en fazla ${MAX_TAGLINE} karakter`} className="sm:col-span-2">
            <input
              id="menu-tagline"
              className="input"
              maxLength={MAX_TAGLINE}
              value={draft.tagline ?? ""}
              onChange={(e) => set("tagline", e.target.value || null)}
            />
          </Field>
          <Segmented label="Başlık hizası" value={draft.headerAlign} options={HEADER_ALIGNS} labels={HEADER_ALIGN_LABELS} onChange={(v) => set("headerAlign", v)} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Renkler" />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <ColorField label="Arka plan" value={draft.backgroundColor} onChange={(v) => set("backgroundColor", v)} />
          <ColorField label="Vurgu" value={draft.accentColor} hint="Seçili sekme, öne çıkan rozetler ve bazı şablonlarda fiyat." onChange={(v) => set("accentColor", v)} />
          <div className="sm:col-span-2">
            <Toggle
              label="Yazı rengini otomatik seç"
              hint="Arka plan açıksa koyu, koyuysa açık yazı kullanılır."
              checked={autoText}
              onChange={(auto) => set("textColor", auto ? null : readableForeground(draft.backgroundColor))}
            />
            {!autoText && <ColorField label="Yazı rengi" value={draft.textColor ?? ""} onChange={(v) => set("textColor", v)} />}
          </div>
          {contrast < 4.5 && (
            <div className="sm:col-span-2">
              <FormAlert tone="info">
                Yazı ile arka plan arasındaki kontrast düşük ({contrast.toFixed(1)}:1). Okunabilirlik için WCAG en az 4.5:1 önerir; loş
                ortamlarda menü zor okunabilir.
              </FormAlert>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Tipografi ve biçim" />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Segmented label="Yazı tipi" value={draft.fontPair} options={FONT_PAIRS} labels={FONT_PAIR_LABELS} onChange={(v) => set("fontPair", v)} />
          <Segmented label="Köşeler" value={draft.cornerStyle} options={CORNER_STYLES} labels={CORNER_STYLE_LABELS} onChange={(v) => set("cornerStyle", v)} />
          <Segmented label="Kart stili" value={draft.surfaceStyle} options={SURFACE_STYLES} labels={SURFACE_STYLE_LABELS} onChange={(v) => set("surfaceStyle", v)} />
          <Segmented label="Yoğunluk" value={draft.density} options={DENSITIES} labels={DENSITY_LABELS} onChange={(v) => set("density", v)} />
          <Segmented label="Fiyat gösterimi" value={draft.priceStyle} options={PRICE_STYLES} labels={PRICE_STYLE_LABELS} onChange={(v) => set("priceStyle", v)} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Bölümler" description="Menüde nelerin görüneceğini seçin." />
        <div className="divide-y divide-line px-5">
          <Toggle label="Öne çıkanlar" hint="“Öne çıkan” işaretli ürünler menünün başında ayrı bir bölümde gösterilir." checked={draft.showFeatured} onChange={(v) => set("showFeatured", v)} />
          <Toggle label="Kategori sekmeleri" hint="Üstte sabit kalan, dokununca ilgili bölüme giden sekmeler." checked={draft.showCategoryNav} onChange={(v) => set("showCategoryNav", v)} />
          <Toggle label="Ürün fotoğrafları" checked={draft.showImages} onChange={(v) => set("showImages", v)} />
          <Toggle label="Ürün açıklamaları" checked={draft.showDescriptions} onChange={(v) => set("showDescriptions", v)} />
        </div>
      </Card>

      <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/95 px-4 py-3 shadow-[0_12px_40px_rgb(0_0_0/0.5)] backdrop-blur">
        <p className={`text-[13px] ${dirty ? "text-fg" : "text-muted"}`}>{dirty ? "Kaydedilmemiş değişiklikler var." : "Tasarım kaydedildi."}</p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(saved);
                setUndo(null);
              }}
            >
              Vazgeç
            </Button>
          )}
          <SubmitButton size="sm" pendingLabel="Kaydediliyor">
            Tasarımı kaydet
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────── Kategoriler

function CategoryFields({ category, idPrefix, err }: { category?: MenuCategoryView; idPrefix: string; err: (k: string) => string | undefined }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
      <Field label="Kategori adı" htmlFor={`${idPrefix}-name`} error={err("name")} required>
        <input id={`${idPrefix}-name`} name="name" className="input" defaultValue={category?.name ?? ""} maxLength={60} autoComplete="off" placeholder="Ör. Kokteyller" />
      </Field>
      <Field label="Sıra" htmlFor={`${idPrefix}-order`} error={err("order")}>
        <input id={`${idPrefix}-order`} name="order" type="number" min={0} max={9999} className="input" defaultValue={category?.order ?? ""} placeholder="Otomatik" />
      </Field>
      <Field label="Kısa açıklama" htmlFor={`${idPrefix}-description`} error={err("description")} className="sm:col-span-2">
        <input
          id={`${idPrefix}-description`}
          name="description"
          className="input"
          defaultValue={category?.description ?? ""}
          maxLength={140}
          placeholder="İsteğe bağlı, ör. Ev yapımı şuruplarla"
        />
      </Field>
    </div>
  );
}

function CategoryRow({ category }: { category: MenuCategoryView }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updateCategoryAction, IDLE);
  useActionToast(state, () => setEditing(false));
  const err = (k: string) => fieldError(state, k);

  if (editing) {
    return (
      <li className="border-line px-5 py-4 [&+li]:border-t">
        <form action={action} className="space-y-3" noValidate>
          <input type="hidden" name="categoryId" value={category.id} />
          {state.status === "error" && !state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}
          <CategoryFields category={category} idPrefix={`cat-${category.id}`} err={err} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
            <SubmitButton size="sm" pendingLabel="Kaydediliyor">
              Kaydet
            </SubmitButton>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-2 border-line px-5 py-3.5 [&+li]:border-t">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{category.name}</p>
        <p className="truncate text-[13px] text-muted">
          {category.items.length} ürün · sıra {category.order}
          {category.description ? ` · ${category.description}` : ""}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        Düzenle
      </Button>
      <ConfirmDialog
        trigger="Sil"
        triggerVariant="ghost"
        title="Kategoriyi sil"
        description={
          category.items.length > 0
            ? `"${category.name}" kategorisi, içindeki ${category.items.length} ürün ve fotoğrafları silinir. Bu işlem geri alınamaz.`
            : `"${category.name}" kategorisi silinir. Bu işlem geri alınamaz.`
        }
        confirmLabel="Kategoriyi sil"
        action={deleteCategoryAction}
        fields={{ categoryId: category.id }}
      />
    </li>
  );
}

function CategoryPanel({ categories }: { categories: MenuCategoryView[] }) {
  const [state, action] = useActionState(createCategoryAction, IDLE);
  const [formKey, setFormKey] = useState(0);
  useActionToast(state, () => setFormKey((k) => k + 1));
  const err = (k: string) => fieldError(state, k);

  return (
    <Card>
      <CardHeader title="Kategoriler" description="Menü bölümleri. Sekmelerde bu sırayla görünür." />
      <form key={formKey} action={action} className="space-y-3 border-b border-line p-5" noValidate>
        {state.status === "error" && !state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}
        <CategoryFields idPrefix="new-category" err={err} />
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Ekleniyor">Kategori ekle</SubmitButton>
        </div>
      </form>
      {categories.length === 0 ? (
        <EmptyState compact title="Kategori yok" description="Ürün ekleyebilmek için önce bir kategori oluşturun." />
      ) : (
        <ul>
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} />
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────── Ürünler

function ItemFields({
  categories,
  item,
  idPrefix,
  err,
  photoAspect,
}: {
  categories: MenuCategoryView[];
  item?: MenuItemView;
  idPrefix: string;
  err: (k: string) => string | undefined;
  photoAspect: string;
}) {
  const [photo, setPhoto] = useState<{ assetId: string | null; src: string | null }>({
    assetId: item?.imageAssetId ?? null,
    src: item?.imageSrc ?? null,
  });
  const [badges, setBadges] = useState<MenuBadge[]>(item?.badges ?? []);
  const [featured, setFeatured] = useState(item?.isFeatured ?? false);
  const [available, setAvailable] = useState(item?.isAvailable ?? true);

  const toggleBadge = (badge: MenuBadge) =>
    setBadges((current) => (current.includes(badge) ? current.filter((b) => b !== badge) : current.length < MAX_BADGES ? [...current, badge] : current));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="imageAssetId" value={photo.assetId ?? ""} />
      <input type="hidden" name="legacyImage" value={!photo.assetId && photo.src ? photo.src : ""} />
      <input type="hidden" name="isFeatured" value={featured ? "1" : "0"} />
      <input type="hidden" name="isAvailable" value={available ? "1" : "0"} />
      {badges.map((b) => (
        <input key={b} type="hidden" name="badges" value={b} />
      ))}

      <div className="sm:col-span-2">
        <AssetField
          label="Ürün fotoğrafı"
          kind="ITEM_PHOTO"
          shape="square"
          src={photo.src}
          defaultAspect={photoAspect}
          hint="Yükledikten sonra menüde görünecek alanı kırparak seçin."
          onChange={(asset) => setPhoto({ assetId: asset?.assetId ?? null, src: asset?.src ?? null })}
        />
        {err("imageAssetId") && <p className="mt-1.5 text-[13px] text-negative">{err("imageAssetId")}</p>}
      </div>

      <Field label="Kategori" htmlFor={`${idPrefix}-categoryId`} error={err("categoryId")} required>
        <select id={`${idPrefix}-categoryId`} name="categoryId" className="input" defaultValue={item?.categoryId ?? categories[0]?.id}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ürün adı" htmlFor={`${idPrefix}-name`} error={err("name")} required>
        <input id={`${idPrefix}-name`} name="name" className="input" defaultValue={item?.name ?? ""} maxLength={80} autoComplete="off" />
      </Field>
      <Field label="Fiyat" htmlFor={`${idPrefix}-price`} error={err("price")} required hint="Ör. 240 veya 240,50">
        <input
          id={`${idPrefix}-price`}
          name="price"
          className="input"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={item ? String(item.price).replace(".", ",") : ""}
        />
      </Field>
      <Field label="Sıra" htmlFor={`${idPrefix}-order`} error={err("order")} hint="Boş bırakılırsa kategorinin sonuna eklenir.">
        <input id={`${idPrefix}-order`} name="order" type="number" min={0} max={9999} className="input" defaultValue={item?.order ?? ""} />
      </Field>
      <Field label="Açıklama" htmlFor={`${idPrefix}-description`} error={err("description")} className="sm:col-span-2">
        <textarea id={`${idPrefix}-description`} name="description" className="input" rows={2} maxLength={300} defaultValue={item?.description ?? ""} />
      </Field>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-[13px] font-medium">
          Rozetler <span className="font-normal text-muted">(en fazla {MAX_BADGES})</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {BADGES.map((badge) => {
            const checked = badges.includes(badge);
            const disabled = !checked && badges.length >= MAX_BADGES;
            return (
              <button
                key={badge}
                type="button"
                aria-pressed={checked}
                disabled={disabled}
                onClick={() => toggleBadge(badge)}
                className={`rounded-full border px-3 py-1 text-[12px] transition-colors disabled:opacity-40 ${
                  checked ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg"
                }`}
              >
                {BADGE_LABELS[badge]}
              </button>
            );
          })}
        </div>
        {err("badges") && <p className="mt-1.5 text-[13px] text-negative">{err("badges")}</p>}
      </fieldset>

      <div className="divide-y divide-line sm:col-span-2">
        <Toggle label="Öne çıkan ürün" hint="Tasarımda “Öne çıkanlar” açıksa menünün başında gösterilir." checked={featured} onChange={setFeatured} />
        <Toggle label="Menüde göster" hint="Kapatılırsa ürün silinmez, yalnızca menüde görünmez." checked={available} onChange={setAvailable} />
      </div>
    </div>
  );
}

function ItemRow({
  item,
  categories,
  categoryName,
  photoAspect,
}: {
  item: MenuItemView;
  categories: MenuCategoryView[];
  categoryName: string;
  photoAspect: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updateMenuItemAction, IDLE);
  useActionToast(state, () => setEditing(false));
  const err = (k: string) => fieldError(state, k);

  if (editing) {
    return (
      <li className="border-line px-5 py-4 [&+li]:border-t">
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="itemId" value={item.id} />
          {state.status === "error" && !state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}
          <ItemFields categories={categories} item={item} idPrefix={`item-${item.id}`} err={err} photoAspect={photoAspect} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
            <SubmitButton size="sm" pendingLabel="Kaydediliyor">
              Kaydet
            </SubmitButton>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 border-line px-5 py-3.5 [&+li]:border-t">
      <div
        className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-field border border-line bg-raised bg-cover bg-center"
        style={item.imageSrc ? { backgroundImage: `url("${item.imageSrc}")` } : undefined}
        role={item.imageSrc ? "img" : undefined}
        aria-label={item.imageSrc ? `${item.name} fotoğrafı` : undefined}
      >
        {!item.imageSrc && <span className="text-[10px] text-muted">Foto yok</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium text-fg">{item.name}</p>
          {item.isFeatured && <Badge tone="positive">Öne çıkan</Badge>}
          {!item.isAvailable && <Badge tone="muted">Gizli</Badge>}
        </div>
        <p className="truncate text-[13px] text-muted">
          {categoryName} · <span data-numeric>{formatPrice(item.price)}</span>
          {item.badges.length > 0 ? ` · ${item.badges.map((b) => BADGE_LABELS[b]).join(", ")}` : ""}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        Düzenle
      </Button>
      <ConfirmDialog
        trigger="Sil"
        triggerVariant="ghost"
        title="Ürünü sil"
        description={`"${item.name}" ve fotoğrafı menüden kaldırılır. Bu işlem geri alınamaz.`}
        confirmLabel="Ürünü sil"
        action={deleteMenuItemAction}
        fields={{ itemId: item.id }}
      />
    </li>
  );
}

function ItemPanel({ categories, photoAspect }: { categories: MenuCategoryView[]; photoAspect: string }) {
  const [state, action] = useActionState(createMenuItemAction, IDLE);
  const [formKey, setFormKey] = useState(0);
  const [open, setOpen] = useState(false);
  useActionToast(state, () => setFormKey((k) => k + 1));
  const err = (k: string) => fieldError(state, k);
  const items = categories.flatMap((c) => c.items.map((item) => ({ item, categoryName: c.name })));

  return (
    <Card>
      <CardHeader
        title="Ürünler"
        description={`${items.length} ürün`}
        action={
          categories.length > 0 && (
            <Button size="sm" variant={open ? "ghost" : "secondary"} onClick={() => setOpen((v) => !v)}>
              {open ? "Formu kapat" : "Ürün ekle"}
            </Button>
          )
        }
      />
      {categories.length === 0 ? (
        <EmptyState compact title="Önce kategori ekleyin" description="Ürünler bir kategoriye bağlıdır." />
      ) : (
        <>
          {open && (
            <form key={formKey} action={action} className="space-y-4 border-b border-line p-5" noValidate>
              {state.status === "error" && !state.fieldErrors && <FormAlert tone="error">{state.message}</FormAlert>}
              <ItemFields categories={categories} idPrefix="new-item" err={err} photoAspect={photoAspect} />
              <div className="flex justify-end">
                <SubmitButton pendingLabel="Ekleniyor">Ürünü ekle</SubmitButton>
              </div>
            </form>
          )}
          {items.length === 0 ? (
            <EmptyState compact title="Ürün yok" description="“Ürün ekle” ile ilk ürünü oluşturun." />
          ) : (
            <ul>
              {items.map(({ item, categoryName }) => (
                <ItemRow key={item.id} item={item} categories={categories} categoryName={categoryName} photoAspect={photoAspect} />
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────── Kampanya popup'ı

type CampaignOptions = {
  perks: { id: string; name: string; venueId: string | null; perCustomerLimit: number; validUntil: Date | null }[];
  venues: { id: string; name: string }[];
};

function PublicLink({ label, path, hint }: { label: string; path: string; hint?: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${path}`;
  return (
    <div>
      <p className="text-[13px] font-medium">{label}</p>
      <div className="mt-1.5 flex gap-2">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="input font-mono !text-xs" aria-label={label} />
        <CopyButton value={url} />
        <a href={path} target="_blank" rel="noopener" className="inline-flex h-10 shrink-0 items-center rounded-field border border-line px-3 text-[13px] text-muted hover:border-line-strong hover:text-fg">
          Aç
        </a>
      </div>
      {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

function CampaignPanel({
  draft,
  saved,
  setDraft,
  options,
  slug,
  hasPublicContent,
}: {
  draft: MenuCampaignView;
  saved: MenuCampaignView;
  setDraft: (campaign: MenuCampaignView) => void;
  options: CampaignOptions;
  slug: string;
  hasPublicContent: boolean;
}) {
  const [state, action] = useActionState(saveMenuCampaignAction, IDLE);
  useActionToast(state);
  const err = (k: string) => fieldError(state, k);
  const set = <K extends keyof MenuCampaignView>(key: K, value: MenuCampaignView[K]) => setDraft({ ...draft, [key]: value });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const perk = options.perks.find((p) => p.id === draft.perkId) ?? null;
  const perkVenue = perk?.venueId ? options.venues.find((v) => v.id === perk.venueId) : null;
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;

  const hidden: Record<string, string> = {
    isActive: draft.isActive ? "1" : "0",
    title: draft.title,
    description: draft.description ?? "",
    ctaLabel: draft.ctaLabel,
    imageAssetId: draft.imageAssetId ?? "",
    perkId: draft.perkId ?? "",
    venueId: draft.venueId ?? "",
    delaySeconds: String(draft.delaySeconds),
    privacyUrl: draft.privacyUrl ?? "",
  };

  return (
    <form action={action} className="space-y-6" noValidate>
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {generalError && <FormAlert tone="error">{generalError}</FormAlert>}

      <Card>
        <CardHeader title="Yayın" description="Popup, müşteriye açık menüde gösterilir; düğmesi kayıt sayfasını açar." />
        <div className="space-y-5 px-5 pb-5">
          <div className="divide-y divide-line">
            <Toggle
              label="Popup menüde görünsün"
              hint={draft.isActive ? "Kaydettiğinizde menüyü açan herkese gösterilir." : "Kapalıyken popup gösterilmez; kayıt sayfası yine çalışır."}
              checked={draft.isActive}
              onChange={(v) => set("isActive", v)}
            />
          </div>
          <PublicLink
            label="Müşteriye açık menü"
            path={publicMenuPath(slug)}
            hint={hasPublicContent ? "Menü QR'ınızı bu adrese yönlendirin." : "Menüde görünür ürün yok; sayfa şu an boş görünür."}
          />
          <PublicLink label="Kayıt sayfası" path={signupPath(slug)} hint="Popup düğmesi bu sayfayı açar; doğrudan da paylaşılabilir." />
        </div>
      </Card>

      <Card>
        <CardHeader title="Popup içeriği" />
        <div className="grid gap-5 p-5">
          <Field label="Başlık" htmlFor="campaign-title" error={err("title")} required hint={`Ör. "Üye ol, ilk kokteylin bizden" · en fazla ${CAMPAIGN_LIMITS.title} karakter`}>
            <input id="campaign-title" className="input" maxLength={CAMPAIGN_LIMITS.title} value={draft.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Açıklama" htmlFor="campaign-description" error={err("description")} hint={`En fazla ${CAMPAIGN_LIMITS.description} karakter`}>
            <textarea
              id="campaign-description"
              className="input"
              rows={3}
              maxLength={CAMPAIGN_LIMITS.description}
              value={draft.description ?? ""}
              onChange={(e) => set("description", e.target.value || null)}
            />
          </Field>
          <Field label="Düğme metni" htmlFor="campaign-cta" error={err("ctaLabel")} hint="Ör. Hemen katıl, İkramını al">
            <input id="campaign-cta" className="input" maxLength={CAMPAIGN_LIMITS.cta} value={draft.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} />
          </Field>
          <div>
            <AssetField
              label="Popup görseli"
              kind="CAMPAIGN"
              shape="wide"
              src={draft.imageSrc}
              hint="İsteğe bağlı; 4:3 kırpılır."
              onChange={(asset) => setDraft({ ...draft, imageAssetId: asset?.assetId ?? null, imageSrc: asset?.src ?? null })}
            />
            {err("imageAssetId") && <p className="mt-1.5 text-[13px] text-negative">{err("imageAssetId")}</p>}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Kayıt ve ikram" description="Popup'tan kayıt olanlar CRM'e “QR menü” kaynağıyla eklenir." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field
            label="Yeni üyeye ikram"
            htmlFor="campaign-perk"
            error={err("perkId")}
            className="sm:col-span-2"
            hint="Seçilirse menüden yeni üye olan kişiye bu avantajın kişiye özel QR'ı verilir. Avantajlar QR Menü › Avantajlar'dan tanımlanır."
          >
            <select
              id="campaign-perk"
              className="input"
              value={draft.perkId ?? ""}
              onChange={(e) => {
                const next = options.perks.find((p) => p.id === e.target.value) ?? null;
                setDraft({
                  ...draft,
                  perkId: next?.id ?? null,
                  perkName: next?.name ?? null,
                  perkTerms: null,
                  venueId: next?.venueId ?? draft.venueId,
                });
              }}
            >
              <option value="">İkram yok, yalnızca üyelik</option>
              {options.perks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · kişi başı {p.perCustomerLimit}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Üyelik mekanı"
            htmlFor="campaign-venue"
            error={err("venueId")}
            hint={perkVenue ? `Avantaj ${perkVenue.name} mekanında geçerli olduğu için üyelik de orada açılır.` : "Kayıt olanlar bu mekanın üyesi olur."}
          >
            <select
              id="campaign-venue"
              className="input"
              value={draft.venueId ?? ""}
              disabled={!!perkVenue}
              onChange={(e) => set("venueId", e.target.value || null)}
            >
              {options.venues.length !== 1 && <option value="">Mekan seçin</option>}
              {options.venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Gösterim gecikmesi (saniye)" htmlFor="campaign-delay" error={err("delaySeconds")} hint="Menü açıldıktan kaç saniye sonra.">
            <input
              id="campaign-delay"
              type="number"
              min={0}
              max={CAMPAIGN_LIMITS.maxDelaySeconds}
              className="input"
              value={draft.delaySeconds}
              onChange={(e) => set("delaySeconds", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Aydınlatma metni adresi"
            htmlFor="campaign-privacy"
            error={err("privacyUrl")}
            className="sm:col-span-2"
            hint="KVKK aydınlatma metninizin bulunduğu sayfa. Kayıt formunda bağlantı olarak gösterilir; metnin içeriği işletmenin sorumluluğundadır."
          >
            <input
              id="campaign-privacy"
              type="url"
              inputMode="url"
              className="input"
              placeholder="https://..."
              value={draft.privacyUrl ?? ""}
              onChange={(e) => set("privacyUrl", e.target.value || null)}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Nasıl çalışır?" />
        <ol className="list-decimal space-y-2 py-5 pr-5 pl-10 text-[13px] leading-relaxed text-muted">
          <li>Menü açıldıktan {draft.delaySeconds} saniye sonra popup görünür; kapatan kişiye 24 saat tekrar gösterilmez.</li>
          <li>Düğme kayıt sayfasını açar: ad, soyad, telefon, isteğe bağlı e-posta. İletişim izinleri kanal kanal ve işaretsiz sorulur.</li>
          <li>Kayıt CRM'e “QR menü” kaynağıyla düşer, mekan üyeliği açılır; ikram seçildiyse kişiye özel QR sayfası açılır.</li>
          <li>Telefon doğrulaması yoktur: aynı telefon veya e-posta zaten kayıtlıysa hiçbir bilgi değiştirilmez ve ikram verilmez.</li>
        </ol>
      </Card>

      <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/95 px-4 py-3 shadow-[0_12px_40px_rgb(0_0_0/0.5)] backdrop-blur">
        <p className={`text-[13px] ${dirty ? "text-fg" : "text-muted"}`}>
          {dirty ? "Kaydedilmemiş değişiklikler var." : saved.isActive ? "Popup menüde yayında." : "Popup kapalı."}
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
              Vazgeç
            </Button>
          )}
          <SubmitButton size="sm" pendingLabel="Kaydediliyor">
            Kampanyayı kaydet
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────── Sayfa düzeni

const PHOTO_ASPECT: Record<ThemeStyle, string> = {
  MINIMAL: "square",
  CLASSIC: "square",
  BOLD: "square",
  CARDS: "square",
  GRID: "landscape",
  EDITORIAL: "landscape",
};

type BuilderTab = "design" | "content" | "campaign";

function Tabs({ tab, setTab, counts, campaignActive }: { tab: BuilderTab; setTab: (tab: BuilderTab) => void; counts: ReactNode; campaignActive: boolean }) {
  const tabs: { id: BuilderTab; label: string; extra?: ReactNode }[] = [
    { id: "design", label: "Tasarım" },
    { id: "content", label: "İçerik", extra: counts },
    { id: "campaign", label: "Kampanya", extra: campaignActive ? "yayında" : undefined },
  ];
  return (
    <div role="tablist" aria-label="Menü oluşturucu bölümleri" className="flex gap-1 rounded-field border border-line bg-surface p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`menu-tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          aria-controls={`menu-panel-${t.id}`}
          onClick={() => setTab(t.id)}
          className={`flex-1 rounded-[8px] px-3 py-2 text-sm transition-colors ${tab === t.id ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
        >
          {t.label}
          {t.extra && <span className="ml-1.5 hidden text-[12px] text-muted sm:inline">{t.extra}</span>}
        </button>
      ))}
    </div>
  );
}

export function MenuBuilder({
  menu,
  title,
  campaign,
  campaignOptions,
  slug,
}: {
  menu: MenuView;
  title: string;
  campaign: MenuCampaignView;
  campaignOptions: CampaignOptions;
  slug: string;
}) {
  const serverConfig = JSON.stringify(menu.config);
  const serverCampaign = JSON.stringify(campaign);
  const [draft, setDraft] = useState<MenuConfigView>(menu.config);
  const [campaignDraft, setCampaignDraft] = useState<MenuCampaignView>(campaign);
  const [tab, setTab] = useState<BuilderTab>("design");
  // Sunucudaki kayıt değiştiğinde (kaydetme sonrası) taslaklar eşitlenir.
  useEffect(() => setDraft(JSON.parse(serverConfig) as MenuConfigView), [serverConfig]);
  useEffect(() => setCampaignDraft(JSON.parse(serverCampaign) as MenuCampaignView), [serverCampaign]);
  const hasPublicContent = menu.categories.some((c) => c.items.some((i) => i.isAvailable));

  const itemCount = menu.categories.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">
        <Tabs tab={tab} setTab={setTab} counts={`${menu.categories.length} kategori · ${itemCount} ürün`} campaignActive={campaign.isActive} />
        <div id={`menu-panel-${tab}`} role="tabpanel" aria-labelledby={`menu-tab-${tab}`} className="space-y-6">
          {tab === "design" && <DesignPanel draft={draft} saved={menu.config} title={title} setDraft={setDraft} />}
          {tab === "content" && (
            <>
              <CategoryPanel categories={menu.categories} />
              <ItemPanel categories={menu.categories} photoAspect={PHOTO_ASPECT[draft.themeStyle]} />
            </>
          )}
          {tab === "campaign" && (
            <CampaignPanel
              draft={campaignDraft}
              saved={campaign}
              setDraft={setCampaignDraft}
              options={campaignOptions}
              slug={slug}
              hasPublicContent={hasPublicContent}
            />
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="eyebrow">Canlı önizleme</p>
          <span className="text-[12px] text-muted">
            {tab === "campaign" ? (campaignDraft.isActive ? "Popup · yayında" : "Popup · kapalı") : templateById(draft.themeStyle).name}
          </span>
        </div>
        <PhoneFrame
          background={draft.backgroundColor}
          overlay={tab === "campaign" ? <CampaignPopupPreview campaign={campaignDraft} config={draft} /> : undefined}
        >
          <MenuPreview config={draft} categories={menu.categories} title={title} />
        </PhoneFrame>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          Tasarım değişiklikleri kaydetmeden önce de burada görünür. Ürün ve kategori değişiklikleri kaydedilince yansır; gizlenen
          ürünler önizlemede de görünmez.
        </p>
      </aside>
    </div>
  );
}
