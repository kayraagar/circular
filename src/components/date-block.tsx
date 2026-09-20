import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/datetime";

const day = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, day: "numeric" });
const month = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, month: "short" });
const weekday = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, weekday: "short" });

/** Etkinlik tarih bloğu (Istanbul). */
export function DateBlock({ date, muted = false }: { date: Date; muted?: boolean }) {
  return (
    <span
      className={`flex w-14 shrink-0 flex-col items-center rounded-xl border border-line py-2 ${muted ? "opacity-50" : ""}`}
      aria-hidden
    >
      <span className="font-mono text-[10px] tracking-wider text-muted uppercase">{month.format(date)}</span>
      <span className="font-display text-xl leading-tight font-medium text-fg" data-numeric>
        {day.format(date)}
      </span>
      <span className="font-mono text-[10px] text-muted">{weekday.format(date)}</span>
    </span>
  );
}
