import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { localDayKey } from "@/lib/datetime";
import { createCustomerAction } from "@/modules/customers/actions";
import { listTags } from "@/modules/customers/service";
import { PageHeader } from "@/components/ui/primitives";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Müşteri ekle" };

export default async function NewCustomerPage() {
  const ctx = await requirePermission("customers.create");
  const tags = await listTags(ctx.service);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: "/customers", label: "Müşteriler" }} eyebrow={ctx.tenant.name} title="Müşteri ekle" />
      <CustomerForm
        mode="create"
        action={createCustomerAction}
        initial={{ firstName: "", lastName: "", phone: "", email: "", birthDate: "", notes: "", tags: [] }}
        tagSuggestions={tags.map((t) => t.name)}
        cancelHref="/customers"
        today={localDayKey(new Date())}
      />
    </div>
  );
}
