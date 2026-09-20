import Link from "next/link";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { describeActivity } from "@/modules/activity/describe";
import type { ActivityItem } from "@/modules/activity/service";
import { EmptyState } from "@/components/ui/primitives";

const linkCls = "text-fg underline-offset-4 decoration-line-strong hover:underline";

export function ActivityFeed({
  items,
  hideContext = false,
  emptyText = "Müşteri, etkinlik ve guest işlemleri burada görünecek.",
}: {
  items: ActivityItem[];
  hideContext?: boolean;
  emptyText?: string;
}) {
  if (items.length === 0) return <EmptyState compact title="Henüz aktivite yok" description={emptyText} />;
  const now = new Date();
  return (
    <ol>
      {items.map((item) => {
        const d = describeActivity(item);
        return (
          <li key={item.id} className="flex gap-3 border-line px-5 py-3.5 [&+li]:border-t">
            <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full border border-accent" />
            <div className="min-w-0 flex-1 text-sm leading-relaxed">
              <p className="text-pretty">
                <span className="text-fg">{item.actorName ?? "Sistem"}</span> <span className="text-muted">{d.verb}</span>
                {d.subject && (
                  <>
                    <span className="text-muted">: </span>
                    <Link href={d.subject.href} className={linkCls}>
                      {d.subject.label}
                    </Link>
                  </>
                )}
                {d.context && !hideContext && (
                  <>
                    <span className="text-muted"> · </span>
                    {d.context.href ? (
                      <Link href={d.context.href} className={linkCls}>
                        {d.context.label}
                      </Link>
                    ) : (
                      d.context.label
                    )}
                  </>
                )}
              </p>
              <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[12px] text-muted">
                <time
                  dateTime={item.createdAt.toISOString()}
                  title={formatDateTime(item.createdAt)}
                  className="shrink-0 font-mono text-[11px] whitespace-nowrap"
                >
                  {formatRelative(item.createdAt, now)}
                </time>
                {d.detail && <span className="truncate">· {d.detail}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
