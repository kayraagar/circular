/**
 * CSV ayrıştırma ve sütun eşleme — istemci bileşenleri de import edebilsin diye
 * veritabanına dokunmaz.
 *
 * Türkçe Excel noktalı virgülle kaydeder, İngilizce sürüm virgülle; ayraç satırdaki
 * kullanımdan tahmin edilir. UTF-8 BOM ve Windows satır sonları temizlenir.
 */

export const MAX_ROWS = 5000;
export const MAX_BYTES = 2 * 1024 * 1024;

/** Ayracı ilk satırdaki alan sayısına göre seçer. */
export function detectSeparator(headerLine: string): ";" | "," | "\t" {
  const counts: [";" | "," | "\t", number][] = [
    [";", (headerLine.match(/;/g) ?? []).length],
    [",", (headerLine.match(/,/g) ?? []).length],
    ["\t", (headerLine.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}

/** Tırnaklı alanları ve içlerindeki ayraç/satır sonlarını doğru okuyan basit CSV ayrıştırıcı. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n"));
  const sep = detectSeparator(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export const IMPORT_FIELDS = ["firstName", "lastName", "phone", "email", "birthDate", "tags", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  firstName: "Ad",
  lastName: "Soyad",
  phone: "Telefon",
  email: "E-posta",
  birthDate: "Doğum tarihi",
  tags: "Etiketler",
  notes: "Not",
};

/** Başlık adlarından sütun eşlemesi tahmini (Türkçe ve İngilizce yaygın yazımlar). */
const HEADER_HINTS: Record<ImportField, string[]> = {
  firstName: ["ad", "isim", "adi", "adı", "first name", "firstname", "name"],
  lastName: ["soyad", "soyadi", "soyadı", "last name", "lastname", "surname"],
  phone: ["telefon", "tel", "gsm", "cep", "numara", "phone", "mobile"],
  email: ["e-posta", "eposta", "email", "e mail", "mail"],
  birthDate: ["dogum", "doğum", "dogum tarihi", "doğum tarihi", "birth", "birthday", "birthdate"],
  tags: ["etiket", "etiketler", "tag", "tags", "segment"],
  notes: ["not", "notlar", "aciklama", "açıklama", "note", "notes"],
};

function fold(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Her alan için sütun indeksi (-1 = eşleşmedi). İlk satır başlık kabul edilir. */
export function guessMapping(header: string[]): Record<ImportField, number> {
  const folded = header.map(fold);
  const mapping = {} as Record<ImportField, number>;
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const hints = HEADER_HINTS[field].map(fold);
    let index = folded.findIndex((h, i) => !used.has(i) && hints.includes(h));
    if (index === -1) index = folded.findIndex((h, i) => !used.has(i) && h !== "" && hints.some((hint) => h.startsWith(hint)));
    mapping[field] = index;
    if (index !== -1) used.add(index);
  }
  return mapping;
}

/** Başlık satırı mı? Alanlardan biri başlık ipucuna benziyorsa evet. */
export function looksLikeHeader(row: string[]): boolean {
  const folded = row.map(fold);
  return Object.values(HEADER_HINTS).some((hints) => hints.some((hint) => folded.includes(fold(hint))));
}
