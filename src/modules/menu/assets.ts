import "server-only";
import { db, type Tx } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isOneOf } from "@/lib/domain";
import { ASSET_KINDS, ASSET_LIMITS, assetUrl, type AssetKind } from "./theme";

/**
 * Menü görselleri: yükleme, doğrulama, okuma ve temizlik.
 * Kırpma ve sıkıştırma tarayıcıda yapılır; sunucu gelen baytları yeniden doğrular.
 */

export type ImageInfo = { mimeType: "image/jpeg" | "image/png"; width: number; height: number };

/** Başlık baytlarından biçim ve boyut okur. Tarayıcının bildirdiği MIME türüne güvenilmez. */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  // PNG imzası + IHDR parçası (genişlik/yükseklik 16–23. baytlar)
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && png.every((b, i) => bytes[i] === b)) {
    if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: SOI ile başlar; boyutlar SOFn işaretçisinde
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1; // dolgu baytı
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        offset += 2; // uzunluk alanı olmayan işaretçiler
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2) return null;
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return { mimeType: "image/jpeg", width, height };
      }
      offset += 2 + length;
    }
  }
  return null;
}

/** Hiçbir ayara veya ürüne bağlanmamış görsellerin silinmeden önce bekleme süresi (yarım bırakılan formlar için). */
const ORPHAN_GRACE_MS = 24 * 3600 * 1000;

const UNREFERENCED = {
  logoFor: { none: {} },
  coverFor: { none: {} },
  itemFor: { none: {} },
  campaignFor: { none: {} },
} as const;

export type UploadedAsset = { assetId: string; src: string; width: number; height: number; kind: AssetKind };

export async function uploadMenuAsset(ctx: ServiceContext, input: { kind: string; file: unknown }): Promise<UploadedAsset> {
  assertCan(ctx, "menu.manage");
  if (!isOneOf(ASSET_KINDS, input.kind)) throw new ValidationError({ kind: ["Geçersiz görsel türü."] });
  const kind = input.kind;

  const file = input.file;
  if (!(file instanceof Blob) || file.size === 0) throw new ValidationError({ file: ["Görsel seçin."] });
  if (file.size > ASSET_LIMITS.maxBytes) {
    throw new ValidationError({ file: [`Görsel en fazla ${Math.round(ASSET_LIMITS.maxBytes / 1000)} KB olabilir.`] });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = inspectImage(bytes);
  if (!info) throw new ValidationError({ file: ["Yalnızca JPEG veya PNG görsel yüklenebilir."] });
  const shortSide = Math.min(info.width, info.height);
  const longSide = Math.max(info.width, info.height);
  if (shortSide < ASSET_LIMITS.minSide || longSide > ASSET_LIMITS.maxSide) {
    throw new ValidationError({
      file: [`Görsel kenarları ${ASSET_LIMITS.minSide}–${ASSET_LIMITS.maxSide} piksel arasında olmalı.`],
    });
  }

  await cleanupOrphanAssets(ctx.tenantId);
  const asset = await db.menuAsset.create({
    data: {
      tenantId: ctx.tenantId,
      kind,
      mimeType: info.mimeType,
      data: bytes,
      width: info.width,
      height: info.height,
      sizeBytes: bytes.length,
      createdByUserId: ctx.userId,
    },
    select: { id: true },
  });
  return { assetId: asset.id, src: assetUrl(asset.id), width: info.width, height: info.height, kind };
}

/**
 * Bir ayara/ürüne bağlanacak görseli doğrular: bu tenant'a ait ve beklenen türde mi?
 * Boş değer "görsel yok" demektir.
 */
export async function findUsableAsset(
  ctx: ServiceContext,
  assetId: string,
  kinds: readonly AssetKind[],
): Promise<{ id: string | null; valid: boolean }> {
  if (!assetId) return { id: null, valid: true };
  const asset = await db.menuAsset.findFirst({
    where: { id: assetId, tenantId: ctx.tenantId, kind: { in: [...kinds] } },
    select: { id: true },
  });
  return asset ? { id: asset.id, valid: true } : { id: null, valid: false };
}

/** Artık hiçbir ayarda veya üründe kullanılmayan görselleri siler. */
export async function deleteAssetsIfUnused(tx: Tx, tenantId: string, assetIds: (string | null | undefined)[]) {
  const ids = [...new Set(assetIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return 0;
  const result = await tx.menuAsset.deleteMany({ where: { tenantId, id: { in: ids }, ...UNREFERENCED } });
  return result.count;
}

/** Yüklenip hiç kullanılmamış (yarım bırakılmış) görselleri temizler. */
export async function cleanupOrphanAssets(tenantId: string, now = Date.now()) {
  const result = await db.menuAsset.deleteMany({
    where: { tenantId, createdAt: { lt: new Date(now - ORPHAN_GRACE_MS) }, ...UNREFERENCED },
  });
  return result.count;
}

const ASSET_ID = /^[a-z0-9]{20,40}$/;

/**
 * Herkese açık menü görseli. Yalnızca kaydedilmiş menüde gerçekten kullanılan görseller döner:
 * logo, kapak, menüde görünen ürünün fotoğrafı, yayındaki kampanyanın görseli.
 * Yüklenip kaydedilmemiş ya da gizlenmiş ürüne ait görsel dışarı açılmaz.
 */
export async function readPublicMenuAsset(tenantId: string, assetId: string) {
  if (!ASSET_ID.test(assetId)) return null;
  return db.menuAsset.findFirst({
    where: {
      id: assetId,
      tenantId,
      OR: [
        { logoFor: { some: {} } },
        { coverFor: { some: {} } },
        { itemFor: { some: { isAvailable: true } } },
        { campaignFor: { some: { isActive: true } } },
      ],
    },
    select: { data: true, mimeType: true, sizeBytes: true },
  });
}

/** Görsel servisi için: yalnızca kullanıcının aktif tenant'ına ait görsel döner. */
export async function readMenuAsset(ctx: ServiceContext, assetId: string) {
  assertCan(ctx, "menu.manage");
  if (!ASSET_ID.test(assetId)) throw new NotFoundError("Görsel bulunamadı.");
  const asset = await db.menuAsset.findFirst({
    where: { id: assetId, tenantId: ctx.tenantId },
    select: { data: true, mimeType: true, sizeBytes: true },
  });
  if (!asset) throw new NotFoundError("Görsel bulunamadı.");
  return asset;
}
