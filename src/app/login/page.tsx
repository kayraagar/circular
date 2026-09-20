import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand } from "@/config/brand";
import { getAppContext, getSession } from "@/lib/context";
import { homePathForRole, safeNextPath } from "@/lib/routes";
import { firstParam, type SearchParams } from "@/lib/page";
import { BrandMark } from "@/components/ui/brand-mark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Giriş" };

const DEMO_ACCOUNTS = [
  { email: "sahip@orbita.example", label: "Orbita · İşletme sahibi" },
  { email: "crm@orbita.example", label: "Orbita · CRM yöneticisi" },
  { email: "sahip@lumen.example", label: "Lumen · İşletme sahibi" },
  { email: "danisman@circular.example", label: "İki işletmede üyelik" },
  { email: "kapi@orbita.example", label: "Orbita · Kapı görevlisi" },
];

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (session) {
    const ctx = await getAppContext();
    redirect(ctx ? homePathForRole(ctx.membership.role) : "/no-access");
  }
  const next = safeNextPath(firstParam((await searchParams).next)) ?? "";
  const showDemo = process.env.SHOW_DEMO_ACCOUNTS === "true";

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <BrandMark />
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-12">
            <p className="eyebrow">İşletme paneli</p>
            <h1 className="mt-3 text-[34px] leading-tight font-medium">Tekrar hoş geldiniz</h1>
            <p className="mt-2 text-sm text-muted">Müşterilerinizi, etkinliklerinizi ve guest listelerinizi yönetin.</p>
            <div className="mt-8">
              <LoginForm next={next} demoAccounts={showDemo ? DEMO_ACCOUNTS : []} />
            </div>
          </div>
        </div>
        <p className="font-mono text-[11px] text-muted">
          © {new Date().getFullYear()} {brand.name}
        </p>
      </div>
      <div aria-hidden className="relative hidden overflow-hidden border-l border-line bg-surface lg:block">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="#2A2A2A">
            {[80, 150, 220, 290, 360, 430, 500].map((r, i) => (
              <circle key={r} cx="560" cy="470" r={r} strokeDasharray={i % 2 ? "2 6" : undefined} />
            ))}
          </g>
          <circle cx="560" cy="470" r="6" fill="#F7F7F5" />
          <circle cx="342" cy="345" r="3.5" fill="#A6A6A6" />
          <circle cx="772" cy="640" r="3.5" fill="#595959" />
          <circle cx="495" cy="755" r="3" fill="#A6A6A6" />
        </svg>
        <div className="absolute bottom-12 left-12 max-w-sm">
          <p className="eyebrow">Döngü</p>
          <p className="mt-3 font-display text-2xl leading-snug font-medium text-fg">
            Kayıt, ziyaret ve iletişim izni ayrı sinyallerdir.
          </p>
          <p className="mt-2 text-sm text-muted">
            {brand.name} her birini ayrı ölçer; müşterinizi gerçek verilerle tanırsınız.
          </p>
        </div>
      </div>
    </div>
  );
}
