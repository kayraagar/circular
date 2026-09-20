/**
 * Tarih/saat yardımcıları.
 * - Veritabanında her zaman UTC (Date) saklanır.
 * - Kullanıcıya her zaman Europe/Istanbul gösterilir, sunucunun saat diliminden bağımsızdır.
 * - Form girdileri ("YYYY-MM-DDTHH:mm") Istanbul duvar saati olarak yorumlanır.
 */
export const APP_TIME_ZONE = "Europe/Istanbul";
export const APP_LOCALE = "tr-TR";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zonedParts(date: Date) {
  const map: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return map as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Verilen andaki Istanbul ofseti (ms). */
function offsetMs(date: Date) {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-09-20T22:00" (Istanbul) → UTC Date. Geçersiz girdide null. */
export function parseLocalDateTime(value: string): Date | null {
  const m = LOCAL_INPUT_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let result = guess - offsetMs(new Date(guess));
  const second = guess - offsetMs(new Date(result));
  if (second !== result) result = second;
  const date = new Date(result);
  // 31 Şubat gibi taşan tarihleri reddet
  const back = zonedParts(date);
  if (back.year !== y || back.month !== mo || back.day !== d) return null;
  return date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC Date → datetime-local input değeri (Istanbul). */
export function toLocalInputValue(date: Date | null | undefined): string {
  if (!date) return "";
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Istanbul'a göre takvim günü anahtarı: "2026-09-15" */
export function localDayKey(date: Date): string {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

const fmtDateTime = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtDate = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});
const fmtShortDate = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
});
const fmtWeekday = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, weekday: "short" });
const fmtTime = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDateTime = (d: Date) => fmtDateTime.format(d);
export const formatDate = (d: Date) => fmtDate.format(d);
export const formatShortDate = (d: Date) => fmtShortDate.format(d);
export const formatWeekday = (d: Date) => fmtWeekday.format(d);
export const formatTime = (d: Date) => fmtTime.format(d);

/** "20 Eyl 22:00 – 04:00" gibi etkinlik aralığı. */
export function formatRange(start: Date, end: Date) {
  const sameDay = localDayKey(start) === localDayKey(end);
  const nextDay = !sameDay && end.getTime() - start.getTime() < 24 * 3600 * 1000;
  if (sameDay || nextDay) {
    return `${formatShortDate(start)} ${formatTime(start)} – ${formatTime(end)}${nextDay ? " (+1)" : ""}`;
  }
  return `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

const rtf = new Intl.RelativeTimeFormat(APP_LOCALE, { numeric: "auto" });

export function formatRelative(date: Date, now = new Date()) {
  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "az önce";
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(diffSec / 86400), "day");
  return formatDateTime(date);
}

/** Doğum tarihi "YYYY-MM-DD" → "12 Mart 1994" (saat dilimi uygulanmaz, takvim tarihidir). */
export function formatBirthDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(APP_LOCALE, { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function isValidCalendarDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
