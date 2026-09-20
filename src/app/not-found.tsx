import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
      <BrandMark />
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md text-center">
          <p className="eyebrow">404</p>
          <h1 className="mt-3 text-3xl font-medium">Sayfa bulunamadı</h1>
          <p className="mt-3 text-sm text-muted">Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir.</p>
          <Link href="/" className={buttonClass("secondary", "md", "mt-6")}>
            Ana sayfaya dön
          </Link>
        </div>
      </div>
    </div>
  );
}
