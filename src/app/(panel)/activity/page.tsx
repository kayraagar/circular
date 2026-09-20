import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { firstParam, type SearchParams } from "@/lib/page";
import { listActivity } from "@/modules/activity/service";
import { ActivityFeed } from "@/components/activity-feed";
import { Card, PageHeader } from "@/components/ui/primitives";
import { IconArrowLeft, IconArrowRight } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Aktivite geçmişi" };

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("activity.view");
  const pageNum = Math.max(1, Number.parseInt(firstParam((await searchParams).page), 10) || 1);
  const { items, hasMore } = await listActivity(ctx.service, { limit: 30, page: pageNum });
  const btn = "inline-flex h-8 items-center gap-1.5 rounded-field border border-line px-3 text-[13px] text-fg hover:border-line-strong";

  return (
    <>
      <PageHeader
        back={{ href: "/dashboard", label: "Genel Bakış" }}
        eyebrow={ctx.tenant.name}
        title="Aktivite geçmişi"
        description="Panelde yapılan müşteri, izin, etkinlik ve guest işlemleri. Kayıtlar işlemle aynı anda yazılır ve değiştirilemez."
      />
      <Card>
        <ActivityFeed items={items} />
        {(pageNum > 1 || hasMore) && (
          <nav aria-label="Sayfalama" className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="font-mono text-[12px] text-muted">Sayfa {pageNum}</span>
            <div className="flex gap-2">
              {pageNum > 1 && (
                <Link href={`/activity?page=${pageNum - 1}`} className={btn}>
                  <IconArrowLeft size={13} /> Daha yeni
                </Link>
              )}
              {hasMore && (
                <Link href={`/activity?page=${pageNum + 1}`} className={btn}>
                  Daha eski <IconArrowRight size={13} />
                </Link>
              )}
            </div>
          </nav>
        )}
      </Card>
    </>
  );
}
