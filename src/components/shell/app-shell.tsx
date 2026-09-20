import Link from "next/link";
import type { ReactNode } from "react";
import type { AppContext } from "@/lib/context";
import { ROLE_LABELS, VENUE_TYPE_LABELS, labelOf } from "@/lib/domain";
import { can } from "@/lib/authz";
import { logoutAction, switchTenantAction, switchVenueAction } from "@/modules/auth/actions";
import { AssistantDock } from "@/components/assistant/assistant-dock";
import { BrandMark } from "@/components/ui/brand-mark";
import { Avatar } from "@/components/ui/primitives";
import { IconLogout, IconPin } from "@/components/ui/icons";
import { navFor } from "./nav";
import { SidebarNav } from "./sidebar-nav";
import { MobileNav } from "./mobile-nav";
import { ScopeMenu } from "./scope-menu";

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="m3 4.5 3 3 3-3" />
    </svg>
  );
}

function TenantBlock({ ctx }: { ctx: AppContext }) {
  const inner = (
    <span className="flex items-center gap-3 rounded-field border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong">
      <span className="min-w-0 flex-1">
        <span className="eyebrow block">İşletme</span>
        <span className="mt-1 block truncate text-sm font-medium text-fg">{ctx.tenant.name}</span>
        <span className="block truncate text-xs text-muted">{ROLE_LABELS[ctx.membership.role]}</span>
      </span>
      {ctx.memberships.length > 1 && (
        <span className="text-muted">
          <Chevron />
        </span>
      )}
    </span>
  );
  if (ctx.memberships.length <= 1) return <div>{inner}</div>;
  return (
    <ScopeMenu
      action={switchTenantAction}
      name="tenantId"
      label="İşletme değiştir"
      current={ctx.tenant.id}
      options={ctx.memberships.map((m) => ({ value: m.tenantId, label: m.tenantName, hint: ROLE_LABELS[m.role] }))}
    >
      {inner}
    </ScopeMenu>
  );
}

function SidebarContent({ ctx }: { ctx: AppContext }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pb-6">
        <Link href="/" className="inline-flex rounded-md text-fg" aria-label="Ana sayfa">
          <BrandMark />
        </Link>
      </div>
      <TenantBlock ctx={ctx} />
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto pl-2">
        <SidebarNav items={navFor(ctx.membership.role)} />
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-line px-1 pt-4">
        <Avatar name={ctx.user.name} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-fg">{ctx.user.name}</p>
          <p className="truncate text-xs text-muted">{ctx.user.email}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            aria-label="Çıkış yap"
            title="Çıkış yap"
            className="inline-flex size-9 items-center justify-center rounded-field text-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <IconLogout size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}

function VenueScope({ ctx }: { ctx: AppContext }) {
  if (!can(ctx.membership.role, "events.view") || ctx.venues.length === 0) return null;
  const label = ctx.activeVenue?.name ?? (ctx.venues.length > 1 ? "Tüm mekanlar" : ctx.venues[0].name);
  const trigger = (
    <span className="inline-flex h-9 max-w-[62vw] items-center gap-2 rounded-field border border-line px-3 text-[13px] text-fg transition-colors hover:border-line-strong sm:max-w-xs">
      <IconPin size={15} className="shrink-0 text-muted" />
      <span className="truncate">{label}</span>
      {ctx.venues.length > 1 && (
        <span className="text-muted">
          <Chevron />
        </span>
      )}
    </span>
  );
  if (ctx.venues.length <= 1) return <div aria-label="Mekan">{trigger}</div>;
  return (
    <ScopeMenu
      action={switchVenueAction}
      name="venueId"
      label="Mekan filtresi"
      current={ctx.activeVenue?.id ?? ""}
      align="right"
      options={[
        { value: "", label: "Tüm mekanlar", hint: `${ctx.venues.length} mekan` },
        ...ctx.venues.map((v) => ({
          value: v.id,
          label: v.name,
          hint: [labelOf(VENUE_TYPE_LABELS, v.type), v.city].filter(Boolean).join(" · "),
        })),
      ]}
    >
      {trigger}
    </ScopeMenu>
  );
}

export function AppShell({ ctx, children }: { ctx: AppContext; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-[70] rounded-field bg-fg px-3 py-2 text-sm text-bg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        İçeriğe geç
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-line px-4 py-6 lg:block">
        <SidebarContent ctx={ctx} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md sm:px-6 lg:px-10">
          <MobileNav>
            <SidebarContent ctx={ctx} />
          </MobileNav>
          <Link href="/" className="rounded-md text-fg lg:hidden" aria-label="Ana sayfa">
            <BrandMark size={20} wordmark={false} />
          </Link>
          <p className="hidden truncate font-mono text-[12px] text-muted lg:block">
            {ctx.tenant.name}
            {ctx.activeVenue ? ` / ${ctx.activeVenue.name}` : ""}
          </p>
          <div className="ml-auto">
            <VenueScope ctx={ctx} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
      {can(ctx.membership.role, "assistant.use") && (
        <AssistantDock scope={{ venueId: ctx.activeVenue?.id ?? null, venueLabel: ctx.activeVenue?.name ?? null }} />
      )}
    </div>
  );
}
