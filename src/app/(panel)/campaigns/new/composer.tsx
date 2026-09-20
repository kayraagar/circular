"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { previewCampaignAction, sendLiveCampaignAction, sendTestCampaignAction } from "@/modules/campaigns/actions";
import { sendEmailCampaignAction, sendEmailTestAction, sendSmsCampaignAction, sendSmsTestAction } from "@/modules/campaigns/channel-actions";
import type { AudienceSpec, SegmentOption } from "@/modules/campaigns/audience";
import type { CampaignPreview } from "@/modules/campaigns/campaign-service";
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CONSENTED_SEGMENT,
  EMAIL_LIMITS,
  EXCLUSION_LABELS,
  SMS_LIMITS,
  SAMPLE_FIRST_NAME,
  composeSms,
  formatUsd,
  smsSegments,
  type CampaignChannel,
  type ExclusionReason,
} from "@/modules/campaigns/rules";
import type { TemplateView } from "@/modules/campaigns/templates";
import { formatDate } from "@/lib/datetime";
import { EmailPreview } from "@/components/campaigns/email-preview";
import { SmsBubble } from "@/components/campaigns/sms-bubble";
import { WhatsAppBubble } from "@/components/campaigns/whatsapp-bubble";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, FormAlert } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";
import { CustomerPicker, type Selected } from "./customer-picker";

type Mode = "SUGGESTED" | "BULK" | "SELECTED";
type Options = {
  suggested: SegmentOption[];
  bulk: SegmentOption[];
  tags: { id: string; name: string; customerCount: number }[];
  events: { id: string; name: string; startsAt: Date; venueName: string; checkInCount: number }[];
};
export type ChannelSetup = {
  whatsapp: { ready: boolean };
  sms: { ready: boolean; msgheader: string | null; legalFooter: string };
  email: { ready: boolean; senderName: string; legalFooter: string };
};

const MODES: { key: Mode; label: string }[] = [
  { key: "SUGGESTED", label: "Önerilen" },
  { key: "BULK", label: "Toplu" },
  { key: "SELECTED", label: "Tek tek" },
];

const CHANNEL_HINT: Record<CampaignChannel, string> = {
  WHATSAPP: "Meta onaylı şablonla",
  SMS: "Netgsm, onaylı başlıkla",
  EMAIL: "Circular adresinden, işletme adıyla",
};

function Step({ n, title, description, children }: { n: number; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="inline-flex size-6 items-center justify-center rounded-full border border-line text-[12px] text-muted" aria-hidden>
              {n}
            </span>
            {title}
          </span>
        }
        description={description}
      />
      <div className="p-5">{children}</div>
    </Card>
  );
}

function SegmentCard({ option, channel, active, onSelect }: { option: SegmentOption; channel: CampaignChannel; active: boolean; onSelect: () => void }) {
  const reachable = option.reachableBy[channel];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`flex h-full flex-col rounded-field border p-3.5 text-left transition-colors ${
        active ? "border-fg bg-raised" : "border-line hover:border-line-strong hover:bg-raised/60"
      }`}
    >
      <span className="text-sm font-medium text-fg">{option.label}</span>
      <span className="mt-1 text-[12px] leading-relaxed text-muted">{option.description}</span>
      <span className="mt-auto pt-3 text-[12px] text-muted" data-numeric>
        <span className="text-fg">{option.total}</span> kişi · <span className={reachable ? "text-positive" : ""}>{reachable} gönderime uygun</span>
      </span>
      {option.note && <span className="mt-1 text-[11px] leading-relaxed text-caution">{option.note}</span>}
    </button>
  );
}

/** Metin alanına imlecin olduğu yere {{ad}} ekler. */
function useNameInserter(value: string, setValue: (v: string) => void, max: number) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = () => {
    const el = ref.current;
    const token = "{{ad}}";
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    setValue((value.slice(0, start) + token + value.slice(end)).slice(0, max));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return { ref, insert };
}

/**
 * Kampanya oluşturucu: kanal → kitle → mesaj → özet ve gönderim.
 * Sayılar sunucuda gerçek kayıtlardan ve seçilen kanalın izinlerinden hesaplanır.
 */
export function CampaignComposer({
  options,
  templates,
  setup,
  businessName,
  initialChannel,
}: {
  options: Options;
  templates: TemplateView[];
  setup: ChannelSetup;
  businessName: string;
  initialChannel: CampaignChannel;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<CampaignChannel>(initialChannel);
  const [mode, setMode] = useState<Mode>("SUGGESTED");
  const [audience, setAudience] = useState<AudienceSpec | null>(null);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [smsBody, setSmsBody] = useState("");
  const [email, setEmail] = useState({ subject: "", body: "", ctaLabel: "", ctaUrl: "" });
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<"TEST" | "LIVE" | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const smsInserter = useNameInserter(smsBody, setSmsBody, SMS_LIMITS.body);
  const emailInserter = useNameInserter(email.body, (v) => setEmail((e) => ({ ...e, body: v })), EMAIL_LIMITS.body);

  // Tek tek seçimde kitle seçilen kişilerden oluşur
  const effectiveAudience: AudienceSpec | null = useMemo(() => {
    if (mode === "SELECTED") return selected.length ? { kind: "SELECTED", customerIds: selected.map((s) => s.id) } : null;
    return audience;
  }, [mode, audience, selected]);
  const audienceKey = JSON.stringify(effectiveAudience);

  useEffect(() => {
    if (!effectiveAudience) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const result = await previewCampaignAction({ audience: effectiveAudience, channel });
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setPreview(result.data);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(result.message);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // audienceKey kitlenin içerik karşılaştırması
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey, channel]);

  const switchChannel = (next: CampaignChannel) => {
    if (next === channel) return;
    // "İzni olan herkes" kitlesi kanala özeldir; yeni kanalın karşılığına geçer
    if (audience?.kind === "SEGMENT" && Object.values(CONSENTED_SEGMENT).includes(audience.key as (typeof CONSENTED_SEGMENT)[CampaignChannel])) {
      setAudience({ kind: "SEGMENT", key: CONSENTED_SEGMENT[next] });
    }
    setChannel(next);
    setPreview(null);
    setSendError(null);
  };

  const template = templates.find((t) => t.id === templateId) ?? null;
  const isActive = (spec: AudienceSpec) => mode !== "SELECTED" && JSON.stringify(audience) === JSON.stringify(spec);
  const bulkOption = options.bulk.find((o) => o.key === CONSENTED_SEGMENT[channel]);

  const smsEstimate = smsSegments(smsBody.trim() ? composeSms(smsBody, setup.sms.legalFooter, SAMPLE_FIRST_NAME) : "");
  const contentMissing =
    channel === "WHATSAPP"
      ? !template
        ? "Onaylı bir şablon seçin."
        : null
      : channel === "SMS"
        ? smsBody.trim().length < 5
          ? "SMS metnini yazın."
          : null
        : email.subject.trim().length < 3 || email.body.trim().length < 10
          ? "E-posta konusunu ve metnini yazın."
          : email.ctaLabel.trim() && !/^https?:\/\/\S+$/.test(email.ctaUrl.trim())
            ? "Düğme bağlantısı https:// ile başlamalı."
            : null;
  const channelReady = setup[channel === "WHATSAPP" ? "whatsapp" : channel === "SMS" ? "sms" : "email"].ready;

  const liveDisabledReason =
    contentMissing ??
    (!preview ? "Kitle seçin." : preview.liveBlock ? preview.liveBlock.message : preview.sendable === 0 ? "Bu kitlede gönderime uygun kişi yok." : null);
  const testDisabledReason = !channelReady
    ? channel === "WHATSAPP"
      ? "WhatsApp numarası bağlı değil."
      : channel === "SMS"
        ? "Netgsm SMS hesabı bağlı değil."
        : "E-posta gönderimi ayarlanmadı."
    : (contentMissing ??
      (preview && preview.testRecipientCount === 0 ? (channel === "EMAIL" ? "E-posta ekranından test adresi ekleyin." : "WhatsApp ekranından test numarası ekleyin.") : null));

  const emailInput = { subject: email.subject, body: email.body, ctaLabel: email.ctaLabel || undefined, ctaUrl: email.ctaUrl || undefined };

  const finish = (result: { ok: true; data: { campaignId: string } } | { ok: false; message: string }, message: string) => {
    setSending(null);
    dialogRef.current?.close();
    if (result.ok) {
      toast(message);
      router.push(`/campaigns/${result.data.campaignId}`);
    } else setSendError(result.message);
  };

  const sendTest = async () => {
    setSending("TEST");
    setSendError(null);
    const testName = name ? `Test · ${name}` : undefined;
    const result =
      channel === "WHATSAPP"
        ? template
          ? await sendTestCampaignAction({ templateId: template.id, name: testName })
          : ({ ok: false, message: "Şablon seçin." } as const)
        : channel === "SMS"
          ? await sendSmsTestAction({ body: smsBody, name: testName })
          : await sendEmailTestAction({ ...emailInput, name: testName });
    finish(result, "Test gönderimi başladı.");
  };

  const sendLive = async () => {
    if (!effectiveAudience) return;
    setSending("LIVE");
    setSendError(null);
    const result =
      channel === "WHATSAPP"
        ? template
          ? await sendLiveCampaignAction({ templateId: template.id, audience: effectiveAudience, name })
          : ({ ok: false, message: "Şablon seçin." } as const)
        : channel === "SMS"
          ? await sendSmsCampaignAction({ audience: effectiveAudience, body: smsBody, name })
          : await sendEmailCampaignAction({ ...emailInput, audience: effectiveAudience, name });
    finish(result, "Kampanya gönderimi başladı.");
  };

  const exclusions = preview ? (Object.entries(preview.exclusions) as [ExclusionReason, number][]).filter(([, n]) => n > 0) : [];
  const costLabel =
    channel === "WHATSAPP" ? "Tahmini Meta ücreti" : channel === "SMS" ? "Tahmini SMS adedi" : "E-posta adedi";
  const costValue = !preview
    ? "—"
    : channel === "WHATSAPP"
      ? formatUsd(preview.estimatedCostMicroUsd)
      : channel === "SMS"
        ? smsEstimate.segments
          ? `~${(preview.sendable * smsEstimate.segments).toLocaleString("tr-TR")}`
          : "—"
        : preview.sendable.toLocaleString("tr-TR");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <Step n={1} title="Kanal">
          <div role="radiogroup" aria-label="Kanal" className="grid gap-2 sm:grid-cols-3">
            {CAMPAIGN_CHANNELS.map((ch) => {
              const ready = setup[ch === "WHATSAPP" ? "whatsapp" : ch === "SMS" ? "sms" : "email"].ready;
              return (
                <button
                  key={ch}
                  type="button"
                  role="radio"
                  aria-checked={channel === ch}
                  onClick={() => switchChannel(ch)}
                  className={`rounded-field border p-3 text-left transition-colors ${channel === ch ? "border-fg bg-raised" : "border-line hover:border-line-strong"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-fg">
                    <span className={`size-2 rounded-full ${ready ? "bg-positive" : "bg-caution"}`} aria-hidden />
                    {CAMPAIGN_CHANNEL_LABELS[ch]}
                  </span>
                  <span className="mt-1 block text-[12px] text-muted">{ready ? CHANNEL_HINT[ch] : "Kurulum tamamlanmadı"}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Instagram&apos;da toplu mesaj gönderilemez; DM otomatik yanıtları{" "}
            <Link href="/campaigns/instagram" className="text-fg underline underline-offset-4">
              Instagram ekranından
            </Link>{" "}
            yönetilir.
          </p>
        </Step>

        <Step n={2} title="Kitle" description={`Sayılar gerçek kayıtlardan hesaplanır; gönderime uygun = ${channel === "EMAIL" ? "e-posta adresi" : "telefonu"} ve ${CAMPAIGN_CHANNEL_LABELS[channel]} izni olan aktif müşteri.`}>
          <div role="tablist" aria-label="Kitle seçimi" className="mb-4 inline-flex gap-1 rounded-field border border-line p-0.5 text-[13px]">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={mode === m.key}
                onClick={() => setMode(m.key)}
                className={`rounded-[8px] px-3 py-1.5 transition-colors ${mode === m.key ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "SUGGESTED" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {options.suggested.map((o) => {
                const spec: AudienceSpec = { kind: "SEGMENT", key: o.key };
                return <SegmentCard key={o.key} option={o} channel={channel} active={isActive(spec)} onSelect={() => setAudience(spec)} />;
              })}
            </div>
          )}

          {mode === "BULK" && (
            <div className="space-y-4">
              {bulkOption && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <SegmentCard
                    option={bulkOption}
                    channel={channel}
                    active={isActive({ kind: "SEGMENT", key: bulkOption.key })}
                    onSelect={() => setAudience({ kind: "SEGMENT", key: bulkOption.key })}
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="audience-tag" className="mb-1.5 block text-[13px] font-medium">
                    Etiketteki müşteriler
                  </label>
                  <select
                    id="audience-tag"
                    className="input"
                    value={audience?.kind === "TAG" ? audience.tagId : ""}
                    onChange={(e) => setAudience(e.target.value ? { kind: "TAG", tagId: e.target.value } : null)}
                  >
                    <option value="">{options.tags.length ? "Etiket seçin" : "Etiket yok"}</option>
                    {options.tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.customerCount})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="audience-event" className="mb-1.5 block text-[13px] font-medium">
                    Etkinliğe gelenler
                  </label>
                  <select
                    id="audience-event"
                    className="input"
                    value={audience?.kind === "EVENT" ? audience.eventId : ""}
                    onChange={(e) => setAudience(e.target.value ? { kind: "EVENT", eventId: e.target.value } : null)}
                  >
                    <option value="">{options.events.length ? "Etkinlik seçin" : "Girişi olan etkinlik yok"}</option>
                    {options.events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} · {formatDate(ev.startsAt)} · {ev.checkInCount} giriş
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {mode === "SELECTED" && <CustomerPicker selected={selected} onChange={setSelected} channel={channel} />}
        </Step>

        <Step n={3} title="Mesaj" description={channel === "WHATSAPP" ? "Yalnızca Meta'nın onayladığı şablonlar listelenir." : undefined}>
          {channel === "WHATSAPP" &&
            (templates.length === 0 ? (
              <EmptyState
                compact
                title="Onaylı şablon yok"
                description="WhatsApp kampanyası için önce bir şablon oluşturup Meta onayına gönderin."
                action={
                  <ButtonLink href="/campaigns/templates" size="sm">
                    Şablon oluştur
                  </ButtonLink>
                }
              />
            ) : (
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">Şablon</legend>
                {templates.map((t) => (
                  <label
                    key={t.id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-field border p-3 transition-colors ${
                      templateId === t.id ? "border-fg bg-raised" : "border-line hover:border-line-strong"
                    }`}
                  >
                    <input type="radio" name="template" value={t.id} checked={templateId === t.id} onChange={() => setTemplateId(t.id)} className="mt-1 accent-white" />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13px] text-fg">{t.name}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted">{t.bodyText}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}

          {channel === "SMS" && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="sms-body" className="text-[13px] font-medium">
                  SMS metni
                </label>
                <Button size="sm" variant="ghost" className="!h-7" onClick={smsInserter.insert}>
                  + Müşterinin adı
                </Button>
              </div>
              <textarea
                ref={smsInserter.ref}
                id="sms-body"
                rows={4}
                maxLength={SMS_LIMITS.body}
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                placeholder="Merhaba {{ad}}, bu cuma DJ gecesinde seni bekliyoruz!"
                className="input"
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Sonuna yasal bilgi (unvan/MERSIS ve ret bilgisi) otomatik eklenir.{" "}
                {!setup.sms.legalFooter && (
                  <Link href="/campaigns/sms" className="text-fg underline underline-offset-4">
                    SMS ekranından ayarlayın.
                  </Link>
                )}
              </p>
            </div>
          )}

          {channel === "EMAIL" && (
            <div className="space-y-4">
              <div>
                <label htmlFor="email-subject" className="mb-1.5 block text-[13px] font-medium">
                  Konu
                </label>
                <input
                  id="email-subject"
                  className="input"
                  maxLength={EMAIL_LIMITS.subject}
                  value={email.subject}
                  onChange={(e) => setEmail((v) => ({ ...v, subject: e.target.value }))}
                  placeholder="Bu cuma bizdesiniz"
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label htmlFor="email-body" className="text-[13px] font-medium">
                    Metin
                  </label>
                  <Button size="sm" variant="ghost" className="!h-7" onClick={emailInserter.insert}>
                    + Müşterinin adı
                  </Button>
                </div>
                <textarea
                  ref={emailInserter.ref}
                  id="email-body"
                  rows={7}
                  maxLength={EMAIL_LIMITS.body}
                  value={email.body}
                  onChange={(e) => setEmail((v) => ({ ...v, body: e.target.value }))}
                  placeholder={"Merhaba {{ad}},\n\nBu cuma DJ gecesinde sizi bekliyoruz."}
                  className="input"
                />
                <p className="mt-1.5 text-[12px] text-muted">Boş satır yeni paragraf başlatır. Yasal bilgi ve &quot;Abonelikten çık&quot; bağlantısı otomatik eklenir.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="email-cta-label" className="mb-1.5 block text-[13px] font-medium">
                    Düğme metni <span className="text-xs font-normal text-muted">(opsiyonel)</span>
                  </label>
                  <input
                    id="email-cta-label"
                    className="input"
                    maxLength={EMAIL_LIMITS.ctaLabel}
                    value={email.ctaLabel}
                    onChange={(e) => setEmail((v) => ({ ...v, ctaLabel: e.target.value }))}
                    placeholder="Listeye yazıl"
                  />
                </div>
                <div>
                  <label htmlFor="email-cta-url" className="mb-1.5 block text-[13px] font-medium">
                    Düğme bağlantısı
                  </label>
                  <input
                    id="email-cta-url"
                    className="input"
                    type="url"
                    maxLength={EMAIL_LIMITS.ctaUrl}
                    value={email.ctaUrl}
                    onChange={(e) => setEmail((v) => ({ ...v, ctaUrl: e.target.value }))}
                    placeholder="https://"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="mt-4">
            <label htmlFor="campaign-name" className="mb-1.5 block text-[13px] font-medium">
              Kampanya adı <span className="text-xs font-normal text-muted">(opsiyonel)</span>
            </label>
            <input id="campaign-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={preview?.label ?? "Ör. Cuma daveti"} />
          </div>
        </Step>

        <Step n={4} title="Gönder">
          {!effectiveAudience ? (
            <p className="text-sm text-muted">Özeti görmek için bir kitle seçin.</p>
          ) : previewError ? (
            <FormAlert tone="error">{previewError}</FormAlert>
          ) : !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Hesaplanıyor
            </p>
          ) : (
            <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-field border border-line p-3">
                  <p className="text-[12px] text-muted">Kitlede</p>
                  <p className="mt-1 font-display text-2xl font-medium" data-numeric>
                    {preview.total}
                  </p>
                </div>
                <div className="rounded-field border border-line p-3">
                  <p className="text-[12px] text-muted">Gönderilecek</p>
                  <p className="mt-1 font-display text-2xl font-medium" data-numeric>
                    {preview.sendable}
                  </p>
                </div>
                <div className="rounded-field border border-line p-3">
                  <p className="text-[12px] text-muted">{costLabel}</p>
                  <p className="mt-1 font-display text-2xl font-medium" data-numeric>
                    {costValue}
                  </p>
                </div>
              </div>
              {exclusions.length > 0 && (
                <ul className="space-y-1 text-[13px] text-muted">
                  {exclusions.map(([reason, n]) => (
                    <li key={reason} data-numeric>
                      {n} kişi gönderilmeyecek: {EXCLUSION_LABELS[reason]}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[12px] leading-relaxed text-muted">
                {channel === "WHATSAPP" &&
                  `Ücret tahmini yalnızca Türkiye numaraları için, Meta'nın ${preview.rateAsOf} pazarlama mesajı ücretiyle hesaplanır; teslim edilmeyen mesaj ücretlendirilmez. `}
                {channel === "SMS" &&
                  `SMS adedi örnek adla, yasal bilgi dahil yaklaşık hesaplanır${smsEstimate.segments > 1 ? ` (mesaj başına ${smsEstimate.segments} SMS)` : ""}. Netgsm İYS'de onayı olmayan numaraya iletmez. `}
                {channel === "EMAIL" && "Ücret Circular'ın e-posta servisi planına dahildir. "}
                Gönderim anında izinler yeniden kontrol edilir.
              </p>
              {preview.liveBlock && <FormAlert tone="info">{preview.liveBlock.message}</FormAlert>}
            </div>
          )}

          {sendError && (
            <div className="mt-4">
              <FormAlert tone="error">{sendError}</FormAlert>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="primary" disabled={Boolean(liveDisabledReason) || sending !== null || loading} onClick={() => dialogRef.current?.showModal()}>
              {preview && !liveDisabledReason ? `Kampanyayı gönder · ${preview.sendable} kişi` : "Kampanyayı gönder"}
            </Button>
            <Button disabled={Boolean(testDisabledReason) || sending !== null} onClick={sendTest}>
              {sending === "TEST" && <Spinner />}
              {channel === "EMAIL" ? "Test adreslerine gönder" : "Test numaralarına gönder"}
              {preview?.testRecipientCount ? ` (${preview.testRecipientCount})` : ""}
            </Button>
          </div>
          {(liveDisabledReason || testDisabledReason) && (
            <p className="mt-2 text-[12px] text-muted">
              {liveDisabledReason && `Kampanya: ${liveDisabledReason} `}
              {testDisabledReason && `Test: ${testDisabledReason}`}
            </p>
          )}
        </Step>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-2 text-[13px] font-medium text-muted">Mesaj önizlemesi</p>
        {channel === "WHATSAPP" &&
          (template ? (
            <WhatsAppBubble template={template} businessName={businessName} />
          ) : (
            <div className="rounded-card border border-dashed border-line p-6 text-center text-[13px] text-muted">Şablon seçildiğinde mesaj burada görünür.</div>
          ))}
        {channel === "SMS" && <SmsBubble body={smsBody} footer={setup.sms.legalFooter} header={setup.sms.msgheader} />}
        {channel === "EMAIL" && (
          <EmailPreview
            content={{ subject: email.subject, body: email.body, ctaLabel: email.ctaLabel || null, ctaUrl: email.ctaUrl || null }}
            senderName={setup.email.senderName}
            legalFooter={setup.email.legalFooter}
          />
        )}
        <p className="mt-2 text-[12px] text-muted">Önizlemede örnek ad kullanılır; gönderimde her kişinin kendi adı yazılır.</p>
      </aside>

      <dialog ref={dialogRef} className="m-auto w-[min(440px,calc(100vw-32px))] rounded-card border border-line bg-surface p-0 text-fg backdrop:bg-black/70">
        {preview && (
          <div className="p-5">
            <h2 className="font-display text-lg font-medium">{CAMPAIGN_CHANNEL_LABELS[channel]} kampanyasını gönder</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              <span className="text-fg">{preview.sendable} kişiye</span>{" "}
              {channel === "WHATSAPP" ? (
                <>
                  <span className="font-mono text-[13px] text-fg">{template?.name}</span> şablonu
                </>
              ) : channel === "SMS" ? (
                "SMS"
              ) : (
                <>
                  &quot;<span className="text-fg">{email.subject}</span>&quot; konulu e-posta
                </>
              )}{" "}
              gönderilecek ({preview.label}). Gönderim başladıktan sonra geri alınamaz.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => dialogRef.current?.close()} disabled={sending === "LIVE"}>
                Vazgeç
              </Button>
              <Button variant="primary" onClick={sendLive} disabled={sending === "LIVE"}>
                {sending === "LIVE" && <Spinner />}
                Gönder
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
