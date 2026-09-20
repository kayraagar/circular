import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { orNotFound } from "@/lib/page";
import { localDayKey } from "@/lib/datetime";
import { formatPhone, fullName } from "@/lib/normalize";
import { CUSTOMER_SOURCE_LABELS, labelOf } from "@/lib/domain";
import { updateCustomerAction } from "@/modules/customers/actions";
import { getCustomerForEdit, listTags } from "@/modules/customers/service";
import { PageHeader } from "@/components/ui/primitives";
import { CustomerForm } from "../../customer-form";

export const metadata: Metadata = { title: "Müşteriyi düzenle" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("customers.update");
  const { id } = await params;
  const [customer, tags] = await Promise.all([orNotFound(getCustomerForEdit(ctx.service, id)), listTags(ctx.service)]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: `/customers/${customer.id}`, label: fullName(customer) }}
        eyebrow={`Kayıt kaynağı: ${labelOf(CUSTOMER_SOURCE_LABELS, customer.source)}`}
        title="Müşteriyi düzenle"
        description="İletişim izinleri müşteri profilindeki İletişim tercihleri bölümünden ayrıca yönetilir."
      />
      <CustomerForm
        mode="edit"
        action={updateCustomerAction.bind(null, customer.id)}
        initial={{
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: formatPhone(customer.phone),
          email: customer.email ?? "",
          birthDate: customer.birthDate ?? "",
          notes: customer.notes ?? "",
          tags: customer.tagNames,
        }}
        tagSuggestions={tags.map((t) => t.name)}
        cancelHref={`/customers/${customer.id}`}
        today={localDayKey(new Date())}
      />
    </div>
  );
}
