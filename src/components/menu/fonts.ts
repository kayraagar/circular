import { Fraunces, Oswald } from "next/font/google";

// Menü şablonlarının ek yazı tipleri (latin-ext: Türkçe karakterler).
// Yalnızca menü oluşturucu ve müşteriye açık menü sayfalarında kullanılır.
export const menuSerif = Fraunces({ subsets: ["latin", "latin-ext"], variable: "--font-menu-serif", display: "swap" });
export const menuCondensed = Oswald({ subsets: ["latin", "latin-ext"], variable: "--font-menu-condensed", display: "swap" });

export const menuFontVariables = `${menuSerif.variable} ${menuCondensed.variable}`;
