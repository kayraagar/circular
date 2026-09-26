import type { MetadataRoute } from "next";

/**
 * Token taşıyan adresler arama motorlarına kapatılır: giriş QR'ı, avantaj QR'ı,
 * PR davet linki, ekip daveti ve abonelikten çıkma bağlantısı. Sayfalarda ayrıca
 * noindex vardır; bu dosya taramayı en baştan engeller.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/pass/", "/q/", "/davet/", "/ekip/", "/abonelik/", "/api/"],
    },
  };
}
