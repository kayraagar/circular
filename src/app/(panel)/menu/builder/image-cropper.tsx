"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { uploadMenuAssetAction } from "@/modules/menu/actions";
import type { UploadedAsset } from "@/modules/menu/assets";
import { ASSET_LIMITS, type AssetKind } from "@/modules/menu/theme";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";

/**
 * Görsel kırpma ve yükleme — kütüphanesiz (canvas + pointer olayları).
 * Kullanıcı sürükleyerek konumlandırır, kaydırıcıyla yakınlaştırır; seçilen alan
 * tarayıcıda sabit boyuta çizilir, 850 KB altına sıkıştırılır ve yüklenir.
 */

type Aspect = { id: string; label: string; ratio: number };

const ITEM_ASPECTS: Aspect[] = [
  { id: "square", label: "Kare 1:1", ratio: 1 },
  { id: "landscape", label: "Yatay 4:3", ratio: 4 / 3 },
  { id: "wide", label: "Geniş 16:9", ratio: 16 / 9 },
];

const KIND_SETUP: Record<AssetKind, { title: string; aspects: Aspect[]; longSide: number; allowContain: boolean; circleGuide: boolean }> = {
  LOGO: { title: "Logo", aspects: [{ id: "square", label: "Kare", ratio: 1 }], longSide: 512, allowContain: true, circleGuide: true },
  COVER: { title: "Kapak görseli", aspects: [{ id: "wide", label: "Geniş 16:9", ratio: 16 / 9 }], longSide: 1600, allowContain: false, circleGuide: false },
  ITEM_PHOTO: { title: "Ürün fotoğrafı", aspects: ITEM_ASPECTS, longSide: 1200, allowContain: false, circleGuide: false },
  CAMPAIGN: { title: "Kampanya görseli", aspects: [{ id: "landscape", label: "Yatay 4:3", ratio: 4 / 3 }], longSide: 1200, allowContain: false, circleGuide: false },
};

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_ZOOM = 4;

type Loaded = { url: string; width: number; height: number; image: HTMLImageElement; name: string };

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export function ImageCropper({
  kind,
  defaultAspect,
  open,
  onClose,
  onUploaded,
}: {
  kind: AssetKind;
  defaultAspect?: string;
  open: boolean;
  onClose: () => void;
  onUploaded: (asset: UploadedAsset) => void;
}) {
  const setup = KIND_SETUP[kind];
  const titleId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [aspect, setAspect] = useState<Aspect>(setup.aspects.find((a) => a.id === defaultAspect) ?? setup.aspects[0]);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const reset = useCallback(() => {
    setLoaded((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(null);
    setBusy(false);
  }, []);

  useEffect(() => () => reset(), [reset]);

  // Çerçeve genişliği değiştikçe (pencere, oran) yükseklik yeniden hesaplanır.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ width: el.clientWidth, height: el.clientWidth / aspect.ratio });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect, loaded]);

  // Kaplama ölçeği: görsel çerçeveyi tamamen doldurur. Logo için "tamamı görünsün" daha küçük ölçeğe izin verir.
  const coverScale = loaded && frame.width ? Math.max(frame.width / loaded.width, frame.height / loaded.height) : 1;
  const containScale = loaded && frame.width ? Math.min(frame.width / loaded.width, frame.height / loaded.height) : 1;
  const minZoom = setup.allowContain ? Math.min(1, containScale / coverScale) : 1;
  const displayWidth = loaded ? loaded.width * coverScale * zoom : 0;
  const displayHeight = loaded ? loaded.height * coverScale * zoom : 0;

  const clampOffset = useCallback(
    (next: { x: number; y: number }, width = displayWidth, height = displayHeight) => {
      const maxX = Math.abs(width - frame.width) / 2;
      const maxY = Math.abs(height - frame.height) / 2;
      return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
    },
    [displayWidth, displayHeight, frame.width, frame.height],
  );

  // Oran veya yakınlaştırma değişince konum çerçeve içinde kalır.
  useEffect(() => {
    setOffset((current) => clampOffset(current));
  }, [clampOffset]);

  async function selectFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError("JPEG, PNG veya WebP bir görsel seçin.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("Görsel 15 MB'den büyük olamaz.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      setError("Görsel okunamadı. Farklı bir dosya deneyin.");
      return;
    }
    if (Math.min(image.naturalWidth, image.naturalHeight) < ASSET_LIMITS.minSide) {
      URL.revokeObjectURL(url);
      setError(`Görsel en az ${ASSET_LIMITS.minSide}×${ASSET_LIMITS.minSide} piksel olmalı.`);
      return;
    }
    setLoaded((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { url, width: image.naturalWidth, height: image.naturalHeight, image, name: file.name };
    });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!loaded || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    setOffset((current) => clampOffset({ x: current.x + dx, y: current.y + dy }));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!loaded) return;
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: step, y: 0 },
      ArrowRight: { x: -step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
    };
    if (moves[event.key]) {
      event.preventDefault();
      setOffset((current) => clampOffset({ x: current.x + moves[event.key].x, y: current.y + moves[event.key].y }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom((z) => Math.min(MAX_ZOOM, z + 0.1));
    } else if (event.key === "-") {
      event.preventDefault();
      setZoom((z) => Math.max(minZoom, z - 0.1));
    }
  }

  function changeZoom(next: number) {
    if (!loaded) return;
    const value = Math.min(MAX_ZOOM, Math.max(minZoom, next));
    const ratio = value / zoom;
    setZoom(value);
    // Yakınlaştırma çerçeve merkezine göre yapılır.
    setOffset((current) =>
      clampOffset(
        { x: current.x * ratio, y: current.y * ratio },
        loaded.width * coverScale * value,
        loaded.height * coverScale * value,
      ),
    );
  }

  async function cropAndUpload() {
    if (!loaded || !frame.width) return;
    setBusy(true);
    setError(null);
    try {
      const outWidth = aspect.ratio >= 1 ? setup.longSide : Math.round(setup.longSide * aspect.ratio);
      const outHeight = Math.round(outWidth / aspect.ratio);
      const k = outWidth / frame.width;
      const canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      const png = kind === "LOGO";
      if (!png) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, outWidth, outHeight);
      }
      const left = frame.width / 2 - displayWidth / 2 + offset.x;
      const top = frame.height / 2 - displayHeight / 2 + offset.y;
      context.drawImage(loaded.image, left * k, top * k, displayWidth * k, displayHeight * k);

      let blob: Blob | null = null;
      if (png) {
        blob = await toBlob(canvas, "image/png");
      }
      // PNG sınırı aşarsa veya fotoğrafsa JPEG: kalite sınırın altına inene kadar düşürülür.
      for (const quality of [0.88, 0.8, 0.72, 0.64, 0.56]) {
        if (blob && blob.size <= ASSET_LIMITS.maxBytes) break;
        if (png) {
          context.globalCompositeOperation = "destination-over";
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, outWidth, outHeight);
          context.globalCompositeOperation = "source-over";
        }
        blob = await toBlob(canvas, "image/jpeg", quality);
      }
      if (!blob || blob.size > ASSET_LIMITS.maxBytes) {
        setError("Görsel yeterince küçültülemedi. Daha küçük bir dosya deneyin.");
        return;
      }

      const form = new FormData();
      form.set("kind", kind);
      form.set("file", blob, blob.type === "image/png" ? "gorsel.png" : "gorsel.jpg");
      const result = await uploadMenuAssetAction(form);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onUploaded(result.asset);
      reset();
      onClose();
    } catch {
      setError("Görsel işlenemedi. Sayfayı yenileyip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card border border-line bg-surface p-0 text-fg shadow-[0_24px_80px_rgb(0_0_0/0.6)] open:animate-enter"
    >
      <div className="space-y-4 p-6">
        <div>
          <p className="eyebrow">Görsel</p>
          <h2 id={titleId} className="mt-1 text-lg font-medium">
            {setup.title} yükle ve kırp
          </h2>
        </div>

        {error && <FormAlert tone="error">{error}</FormAlert>}

        {!loaded ? (
          <label
            htmlFor={inputId}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-field border border-dashed border-line-strong bg-raised px-6 py-12 text-center transition-colors hover:border-fg"
          >
            <svg viewBox="0 0 48 48" className="size-10 text-muted" aria-hidden>
              <g fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="24" cy="24" r="22" strokeOpacity="0.4" />
                <path d="M24 31V17m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            </svg>
            <span className="text-sm font-medium">Dosya seçin</span>
            <span className="text-[12px] text-muted">JPEG, PNG veya WebP · en fazla 15 MB</span>
            <input
              id={inputId}
              type="file"
              accept={ACCEPTED.join(",")}
              className="sr-only"
              onChange={(event) => {
                void selectFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        ) : (
          <>
            {setup.aspects.length > 1 && (
              <div role="radiogroup" aria-label="Kırpma oranı" className="flex flex-wrap gap-2">
                {setup.aspects.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={a.id === aspect.id}
                    onClick={() => setAspect(a)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                      a.id === aspect.id ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            <div
              ref={frameRef}
              role="application"
              aria-label="Kırpma alanı. Sürükleyerek veya ok tuşlarıyla konumlandırın, artı ve eksi ile yakınlaştırın."
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              className="relative w-full cursor-grab touch-none overflow-hidden rounded-field bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#141414_0%_50%)] bg-[length:16px_16px] select-none active:cursor-grabbing"
              style={{ height: frame.height || undefined, aspectRatio: frame.height ? undefined : String(aspect.ratio) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- yerel nesne adresi; next/image uygulanamaz */}
              <img
                src={loaded.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{
                  width: displayWidth,
                  height: displayHeight,
                  left: frame.width / 2 - displayWidth / 2 + offset.x,
                  top: frame.height / 2 - displayHeight / 2 + offset.y,
                }}
              />
              {/* Üçte bir kılavuz çizgileri */}
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/20" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/20" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/20" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/20" />
                {setup.circleGuide && <div className="absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]" />}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button size="sm" variant="ghost" aria-label="Uzaklaştır" onClick={() => changeZoom(zoom - 0.1)} disabled={zoom <= minZoom}>
                −
              </Button>
              <input
                type="range"
                aria-label="Yakınlaştırma"
                min={minZoom}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(event) => changeZoom(Number(event.target.value))}
                className="h-1 flex-1 cursor-pointer accent-white"
              />
              <Button size="sm" variant="ghost" aria-label="Yakınlaştır" onClick={() => changeZoom(zoom + 0.1)} disabled={zoom >= MAX_ZOOM}>
                +
              </Button>
            </div>
            <p className="text-[12px] leading-relaxed text-muted">
              Sürükleyerek konumlandırın. {setup.circleGuide ? "Daire, logonun menüde görünen alanıdır. " : ""}
              Çerçeve içindeki alan menüye eklenir.
            </p>
          </>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close} disabled={busy}>
              Vazgeç
            </Button>
            {loaded && (
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Başka görsel
              </Button>
            )}
          </div>
          <Button variant="primary" onClick={() => void cropAndUpload()} disabled={!loaded || busy}>
            {busy && <Spinner />}
            {busy ? "Yükleniyor" : "Kırp ve kullan"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
