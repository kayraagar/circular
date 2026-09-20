import type { Metadata } from "next";
import { requirePermission } from "@/lib/context";
import { firstParam, type SearchParams } from "@/lib/page";
import { getChannelOverview } from "@/modules/campaigns/accounts";
import { getAudienceOptions } from "@/modules/campaigns/audience";
import { getEmailOverview } from "@/modules/campaigns/email-service";
import { getSmsAccount } from "@/modules/campaigns/sms-service";
import { listTemplates } from "@/modules/campaigns/templates";
import { PageHeader } from "@/components/ui/primitives";
import { CampaignComposer } from "./composer";

export const metadata: Metadata = { title: "Yeni kampanya" };

const CHANNEL_PARAM = { whatsapp: "WHATSAPP", sms: "SMS", eposta: "EMAIL" } as const;

export default async function NewCampaignPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("campaigns.manage");
  const kanal = firstParam((await searchParams).kanal) as keyof typeof CHANNEL_PARAM;
  const [options, templates, overview, sms, email] = await Promise.all([
    getAudienceOptions(ctx.service),
    listTemplates(ctx.service),
    getChannelOverview(ctx.service),
    getSmsAccount(ctx.service),
    getEmailOverview(ctx.service),
  ]);
  const account = overview.account;

  return (
    <>
      <PageHeader
        back={{ href: "/campaigns", label: "Kampanyalar" }}
        eyebrow="Kampanyalar"
        title="Yeni kampanya"
        description="Kanalı ve kitleyi seçin, mesajı hazırlayın ve tek tuşla gönderin."
      />
      <CampaignComposer
        options={options}
        templates={templates.filter((t) => t.usable)}
        setup={{
          whatsapp: { ready: account?.status === "ACTIVE" && account.tokenUsable },
          sms: { ready: sms?.status === "ACTIVE" && sms.passwordUsable, msgheader: sms?.status === "ACTIVE" ? sms.msgheader : null, legalFooter: sms?.legalFooter ?? "" },
          email: {
            ready: email.provider.ready && Boolean(email.settings),
            senderName: email.settings?.senderName ?? ctx.tenant.name,
            legalFooter: email.settings?.legalFooter ?? "",
          },
        }}
        businessName={account?.verifiedName ?? ctx.tenant.name}
        initialChannel={CHANNEL_PARAM[kanal] ?? "WHATSAPP"}
      />
    </>
  );
}
