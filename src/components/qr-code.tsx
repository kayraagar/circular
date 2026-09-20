/**
 * QR görseli. Okunabilirlik için koyu modüller açık zemin üzerinde; sessiz bölge path'e dahildir.
 * Logo veya süsleme QR'ın üzerine bindirilmez.
 */
export function QrCode({
  qr,
  size = 240,
  label,
}: {
  qr: { viewBox: number; d: string };
  size?: number;
  label: string;
}) {
  return (
    <div className="inline-flex rounded-[20px] bg-fg p-2" style={{ width: size, maxWidth: "100%" }}>
      <svg
        viewBox={`0 0 ${qr.viewBox} ${qr.viewBox}`}
        role="img"
        aria-label={label}
        shapeRendering="crispEdges"
        className="block h-auto w-full"
      >
        <path d={qr.d} fill="#080808" />
      </svg>
    </div>
  );
}
