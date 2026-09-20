import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/context";
import { can } from "@/lib/authz";
import type { SearchParams } from "@/lib/page";
import { formatShortDate } from "@/lib/datetime";
import { formatPhone } from "@/lib/normalize";
import { CHANNELS, CHANNEL_LABELS, CUSTOMER_SOURCES, CUSTOMER_SOURCE_LABELS, labelOf } from "@/lib/domain";
import { listCustomers, listTags, parseCustomerFilters } from "@/modules/customers/service";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";
import { IconPlus, IconSearch } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Müşteriler" };

const nf = new Intl.NumberFormat("tr-TR");
const CHANNEL_SHORT = { WHATSAPP: "WA", SMS: "SMS", EMAIL: "E-posta" } as const;

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("customers.view");
  const filters = parseCustomerFilters(await searchParams);
  const [list, tags] = await Promise.all([listCustomers(ctx.service, filters), listTags(ctx.service)]);
  const canCreate = can(ctx.membership.role, "customers.create");

  const activeParams: Record<string, string> = {};
  if (filters.q) activeParams.q = filters.q;
  if (filters.tagId) activeParams.tag = filters.tagId;
  if (filters.source) activeParams.source = filters.source;
  if (filters.consent) activeParams.consent = filters.consent;
  if (filters.status === "archived") activeParams.status = "archived";
  if (filters.sort === "name") activeParams.sort = "name";
  const filtered = Boolean(filters.q || filters.tagId || filters.source || filters.consent || filters.status === "archived");

  return (
    <>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title="Müşteriler"
        description="İşletme genelinde tek müşteri kaydı. Aynı kişi farklı etkinliklere katıldığında yeni kayıt açılmaz."
        actions={
          canCreate && (
            <ButtonLink href="/customers/new" variant="primary">
              <IconPlus size={15} /> Müşteri ekle
            </ButtonLink>
          )
        }
      />

      <form method="get" role="search" aria-label="Müşteri ara ve filtrele" className="card mb-4 flex flex-wrap gap-2.5 p-3">
        <div className="relative min-w-0 flex-[1_1_100%] md:flex-[2_1_18rem]">
          <label htmlFor="q" className="sr-only">
            İsim, telefon veya e-posta
          </label>
          <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input id="q" name="q" type="search" defaultValue={filters.q} placeholder="İsim, telefon veya e-posta" className="input !pl-9" />
        </div>
        <div className="min-w-0 flex-[1_1_9.5rem]">
          <label htmlFor="tag" className="sr-only">
            Etiket
          </label>
          <select id="tag" name="tag" defaultValue={filters.tagId} className="input">
            <option value="">Tüm etiketler</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.count})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-[1_1_9.5rem]">
          <label htmlFor="source" className="sr-only">
            Kayıt kaynağı
          </label>
          <select id="source" name="source" defaultValue={filters.source} className="input">
            <option value="">Tüm kaynaklar</option>
            {CUSTOMER_SOURCES.map((s) => (
              <option key={s} value={s}>
                {CUSTOMER_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-[1_1_9.5rem]">
          <label htmlFor="consent" className="sr-only">
            İletişim izni
          </label>
          <select id="consent" name="consent" defaultValue={filters.consent} className="input">
            <option value="">İzin filtresi yok</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]} izni var
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-[1_1_9.5rem]">
          <label htmlFor="status" className="sr-only">
            Durum
          </label>
          <select id="status" name="status" defaultValue={filters.status} className="input">
            <option value="active">Aktif müşteriler</option>
            <option value="archived">Arşivlenenler</option>
          </select>
        </div>
        <div className="flex flex-[1_1_100%] gap-2 sm:flex-none">
          <button type="submit" className={buttonClass("secondary", "md", "flex-1 sm:flex-none")}>
            Filtrele
          </button>
          {filtered && (
            <Link href="/customers" className={buttonClass("ghost", "md")}>
              Temizle
            </Link>
          )}
        </div>
      </form>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[13px] text-muted" aria-live="polite">
          {filtered ? "Filtreye uyan " : ""}
          <span className="font-mono text-fg" data-numeric>
            {nf.format(list.total)}
          </span>{" "}
          müşteri
        </p>
        <nav aria-label="Sıralama" className="flex gap-3 text-[13px]">
          {(["newest", "name"] as const).map((s) => {
            const params = new URLSearchParams({ ...activeParams, sort: s });
            if (s === "newest") params.delete("sort");
            return (
              <Link
                key={s}
                href={`/customers?${params.toString()}`}
                aria-current={filters.sort === s ? "true" : undefined}
                className={filters.sort === s ? "text-fg" : "text-muted hover:text-fg"}
              >
                {s === "newest" ? "En yeni" : "İsme göre"}
              </Link>
            );
          })}
        </nav>
      </div>

      <Card>
        {list.items.length === 0 ? (
          filtered ? (
            <EmptyState
              title="Filtrelere uyan müşteri bulunamadı"
              description="Arama terimini kısaltmayı veya filtreleri kaldırmayı deneyin."
              action={<ButtonLink href="/customers">Filtreleri temizle</ButtonLink>}
            />
          ) : (
            <EmptyState
              title="Henüz müşteri yok"
              description="Müşteri ekleyebilir veya bir etkinliğin guest listesinden yeni kişi kaydedebilirsiniz."
              action={
                canCreate && (
                  <ButtonLink href="/customers/new" variant="primary">
                    <IconPlus size={15} /> İlk müşteriyi ekle
                  </ButtonLink>
                )
              }
            />
          )
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[680px] text-left text-sm">
                <caption className="sr-only">Müşteri listesi</caption>
                <thead>
                  <tr className="border-b border-line">
                    {["Müşteri", "İletişim", "Etiketler", "Kaynak", "İzinler", "Eklenme"].map((h) => (
                      <th key={h} scope="col" className={`eyebrow px-4 py-3 font-normal first:pl-5 last:pr-5 ${h === "Kaynak" ? "hidden xl:table-cell" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((c) => (
                    <tr key={c.id} className="group relative border-line transition-colors hover:bg-raised/50 [&+tr]:border-t">
                      <td className="py-3.5 pr-4 pl-5">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} size={32} />
                          <div className="min-w-0">
                            <Link href={`/customers/${c.id}`} className="font-medium whitespace-nowrap text-fg after:absolute after:inset-0">
                              {c.name}
                            </Link>
                            {c.registrationCount > 0 && (
                              <p className="text-xs text-muted">{c.registrationCount} etkinlik kaydı</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-mono text-[13px] whitespace-nowrap text-fg">{formatPhone(c.phone) || "—"}</p>
                        <p className="max-w-[200px] truncate text-xs text-muted">{c.email ?? ""}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex max-w-[200px] flex-wrap gap-1">
                          {c.tags.length === 0 ? <span className="text-muted">—</span> : c.tags.slice(0, 3).map((t) => <Badge key={t.id}>{t.name}</Badge>)}
                          {c.tags.length > 3 && <Badge tone="muted">+{c.tags.length - 3}</Badge>}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3.5 text-[13px] text-muted xl:table-cell">{labelOf(CUSTOMER_SOURCE_LABELS, c.source)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex gap-1">
                          {c.grantedChannels.length === 0 ? (
                            <span className="text-[13px] text-muted">Yok</span>
                          ) : (
                            CHANNELS.filter((ch) => c.grantedChannels.includes(ch)).map((ch) => (
                              <Badge key={ch} tone="positive" mono>
                                {CHANNEL_SHORT[ch]}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 pr-5 pl-4 font-mono text-[12px] whitespace-nowrap text-muted">{formatShortDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="lg:hidden">
              {list.items.map((c) => (
                <li key={c.id} className="border-line [&+li]:border-t">
                  <Link href={`/customers/${c.id}`} className="flex items-start gap-3 px-4 py-3.5 active:bg-raised">
                    <Avatar name={c.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate font-medium text-fg">{c.name}</p>
                        <span className="shrink-0 font-mono text-[11px] text-muted">{formatShortDate(c.createdAt)}</span>
                      </div>
                      <p className="truncate font-mono text-[12px] text-muted">{formatPhone(c.phone) || c.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.tags.slice(0, 2).map((t) => (
                          <Badge key={t.id}>{t.name}</Badge>
                        ))}
                        {c.grantedChannels.map((ch) => (
                          <Badge key={ch} tone="positive" mono>
                            {CHANNEL_SHORT[ch]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination basePath="/customers" params={activeParams} page={list.page} pageCount={list.pageCount} />
          </>
        )}
      </Card>
    </>
  );
}
