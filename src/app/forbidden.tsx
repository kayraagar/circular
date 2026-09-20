import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { buttonClass } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
      <BrandMark />
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md text-center">
          <p className="eyebrow">403</p>
          <h1 className="mt-3 text-3xl font-medium">Bu sayfaya erişim yetkiniz yok</h1>
          <p className="mt-3 text-sm text-muted">
            Rolünüz bu bölümü görüntülemeye izin vermiyor. Erişim gerekiyorsa işletme yöneticinizle görüşün.
          </p>
          <Link href="/" className={buttonClass("secondary", "md", "mt-6")}>
            Ana sayfaya dön
          </Link>
        </div>
      </div>
    </div>
  );
}
