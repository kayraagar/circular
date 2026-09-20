import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { PerkForm } from "./perk-form";

export const metadata: Metadata = { title: "Avantaj oluştur" };

export default async function NewPerkPage() {
  const ctx = await requirePermission("perks.manage");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: "/menu/perks", label: "Avantajlar" }} eyebrow={ctx.tenant.name} title="Avantaj oluştur" />
      {ctx.venues.length === 0 ? (
        <div className="card">
          <EmptyState title="Erişebildiğiniz mekan yok" description="Avantaj tanımlamak için en az bir mekana erişiminiz olmalı." />
        </div>
      ) : (
        <PerkForm venues={ctx.venues} allowAllVenues={ctx.service.venueIds === null} />
      )}
    </div>
  );
}
