import type { NextRequest } from "next/server";
import { getAppContext } from "@/lib/context";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { readMenuAsset } from "@/modules/menu/assets";

/**
 * Menü görseli (logo, kapak, ürün fotoğrafı).
 * Şimdilik yalnızca panel içi önizleme içindir: oturum ve aktif tenant zorunludur.
 * Başka tenant'ın görseli ile hiç var olmayan görsel ayırt edilmez (404).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const app = await getAppContext();
  if (!app) return new Response("Oturum gerekli.", { status: 401 });

  try {
    const asset = await readMenuAsset(app.service, assetId);
    return new Response(new Uint8Array(asset.data), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.sizeBytes),
        // Görsel kimliği değişmez; yeni yükleme yeni kimlik alır.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return new Response("Görsel bulunamadı.", { status: 404 });
    }
    throw error;
  }
}
