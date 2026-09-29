/**
 * KVKK başvuru sabitleri — istemci bileşenleri de import eder, bu yüzden veritabanına
 * veya "server-only" modüllere dokunmaz.
 */

export const REQUEST_KINDS = ["ACCESS", "ERASURE", "RECTIFICATION", "OBJECTION", "PORTABILITY", "OTHER"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  ACCESS: "Bilgi talebi (m.11/a-b)",
  ERASURE: "Silme / yok etme (m.7, m.11/e)",
  RECTIFICATION: "Düzeltme (m.11/d)",
  OBJECTION: "İtiraz (m.11/g)",
  PORTABILITY: "Veriyi alma / aktarma",
  OTHER: "Diğer",
};

export const REQUEST_CHANNELS = ["EMAIL", "KEP", "POST", "IN_PERSON", "OTHER"] as const;
export type RequestChannel = (typeof REQUEST_CHANNELS)[number];

export const REQUEST_CHANNEL_LABELS: Record<RequestChannel, string> = {
  EMAIL: "E-posta",
  KEP: "KEP",
  POST: "Posta / noter",
  IN_PERSON: "Şahsen",
  OTHER: "Diğer",
};

/** KVKK m.13/2: başvuruya en geç otuz gün içinde cevap verilir. */
export const RESPONSE_DAYS = 30;
