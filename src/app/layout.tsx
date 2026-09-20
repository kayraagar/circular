import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

// latin-ext: ç ğ ı İ ö ş ü. Yükleme başarısız olursa globals.css'teki sistem fontlarına düşer.
const display = Space_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-space-grotesk", display: "swap" });
const sans = Manrope({ subsets: ["latin", "latin-ext"], variable: "--font-manrope", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.tagline,
  applicationName: brand.name,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#080808",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
