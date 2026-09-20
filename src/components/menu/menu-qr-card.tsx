import { qrSvgPath } from "@/lib/qr/encoder";
import { CopyButton } from "@/components/copy-button";
import { QrCode } from "@/components/qr-code";
import { Card, CardHeader } from "@/components/ui/primitives";

/**
 * Masaya konacak menü QR'ı. Kod, menünün herkese açık adresini taşır;
 * menü güncellendiğinde aynı kod geçerli kalır (yeniden basmak gerekmez).
 */
export function MenuQrCard({ url }: { url: string }) {
  return (
    <Card className="h-fit">
      <CardHeader title="Menü QR kodu" description="Masaya koyacağınız kod. Menüyü değiştirseniz de bu kod geçerli kalır." />
      <div className="space-y-4 p-5">
        <div className="flex justify-center">
          <QrCode qr={qrSvgPath(url)} size={200} label="Menü QR kodu" />
        </div>
        <div className="flex flex-wrap gap-2">
          <input readOnly value={url} aria-label="Menü adresi" className="input min-w-0 flex-1 basis-40 font-mono !text-xs" />
          <CopyButton value={url} />
        </div>
        <p className="text-[12px] leading-relaxed text-muted">
          Yazdırmak için: sayfayı yazdırın ya da koda sağ tıklayıp görseli kaydedin. Basmadan önce telefonunuzun kamerasıyla okutup kontrol edin.
        </p>
      </div>
    </Card>
  );
}
