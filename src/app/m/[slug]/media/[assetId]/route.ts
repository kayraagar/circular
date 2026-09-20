import { readPublicMenuAssetBySlug } from "@/modules/menu/public";

/**
 * Müşteriye açık menü görseli. Yalnızca kaydedilmiş menüde kullanılan görseller servis edilir
 * (logo, kapak, menüde görünen ürün, yayındaki kampanya); diğer her durumda 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; assetId: string }> }) {
  const { slug, assetId } = await params;
  const asset = await readPublicMenuAssetBySlug(slug, assetId);
  if (!asset) return new Response("Görsel bulunamadı.", { status: 404 });

  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.sizeBytes),
      // Ürün gizlenir veya kampanya kapatılırsa bir gün içinde önbellekten düşer.
      "Cache-Control": "public, max-age=86400",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
