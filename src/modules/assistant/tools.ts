import "server-only";
import { db } from "@/lib/db";
import { can, venueScope, type Permission, type ServiceContext } from "@/lib/authz";
import { AppError, ValidationError } from "@/lib/errors";
import { formatRange, parseLocalDateTime } from "@/lib/datetime";
import { cleanText, fullName } from "@/lib/normalize";
import { CHANNELS, CHANNEL_LABELS, isOneOf, labelOf, type Channel } from "@/lib/domain";
import { createCustomer, customerSearchWhere, getCustomerForEdit, setConsent, updateCustomer } from "@/modules/customers/service";
import { createEvent } from "@/modules/events/service";
import { addGuestToEvent } from "@/modules/guests/service";
import { startEmailCampaign } from "@/modules/campaigns/email-service";
import { startSmsCampaign } from "@/modules/campaigns/sms-service";
import { summarizeAudience } from "@/modules/campaigns/audience";
import { CAMPAIGN_CHANNEL_LABELS, SEGMENT_COPY, SEGMENT_KEYS, type SegmentKey } from "@/modules/campaigns/rules";

/**
 * Asistanın çalıştırabildiği işlemler ("araçlar").
 *
 * Her araç mevcut servis fonksiyonunu KULLANICININ kendi ServiceContext'i ile çağırır:
 * yetki kontrolü, işletme/mekan kapsamı, doğrulama ve aktivite kaydı olduğu gibi işler.
 * Modelin ürettiği değerler doğrudan veritabanına yazılmaz; her zaman servisin zod
 * doğrulamasından geçer. Silme ve arşivleme aracı bilerek yoktur.
 *
 * confirm = true olan araçlar (dışarıya mesaj gönderenler) çalıştırılmadan önce
 * kullanıcıya özet gösterilip onay istenir.
 */

export type ToolResult =
  | { ok: true; title: string; detail?: string; links?: { href: string; label: string }[] }
  | { ok: false; message: string; options?: string[] };

export type AssistantTool = {
  name: string;
  description: string;
  permission: Permission;
  confirm: boolean;
  parameters: Record<string, unknown>;
  run: (ctx: ServiceContext, args: Record<string, unknown>, now: Date) => Promise<ToolResult>;
};

const str = (args: Record<string, unknown>, key: string) => cleanText(typeof args[key] === "string" ? (args[key] as string) : "");
const strList = (args: Record<string, unknown>, key: string) =>
  Array.isArray(args[key]) ? (args[key] as unknown[]).filter((x): x is string => typeof x === "string").map((x) => cleanText(x)).filter(Boolean) : [];

/** Servis hatalarını kullanıcıya gösterilecek tek satıra çevirir. */
function failure(error: unknown): ToolResult {
  if (error instanceof ValidationError) {
    const messages = Object.values(error.fieldErrors).flatMap((v) => v ?? []);
    return { ok: false, message: messages[0] ?? error.message };
  }
  if (error instanceof AppError) return { ok: false, message: error.message };
  console.error("[assistant] araç hatası", error);
  return { ok: false, message: "İşlem tamamlanamadı. Lütfen panelden deneyin." };
}

// ─────────────────────────────────────────────── Çözümleyiciler

type Resolved<T> = { ok: true; value: T } | { ok: false; result: ToolResult };

/** Ad veya numaradan tek bir müşteri bulur; birden fazla eşleşmede seçim ister, tahmin etmez. */
async function resolveCustomer(ctx: ServiceContext, query: string): Promise<Resolved<{ id: string; name: string }>> {
  const search = query ? customerSearchWhere(query) : undefined;
  if (!search) return { ok: false, result: { ok: false, message: "Kimi kastettiğinizi yazın (ad soyad veya telefon)." } };
  const rows = await db.customer.findMany({
    where: { tenantId: ctx.tenantId, archivedAt: null, ...search },
    select: { id: true, firstName: true, lastName: true, phone: true },
    orderBy: { searchName: "asc" },
    take: 6,
  });
  if (rows.length === 0) return { ok: false, result: { ok: false, message: `“${query}” ile eşleşen müşteri yok. Önce kaydı oluşturmam gerekir.` } };
  if (rows.length > 1) {
    return {
      ok: false,
      result: { ok: false, message: `“${query}” için ${rows.length} kişi eşleşti; hangisi olduğunu yazın.`, options: rows.map((r) => fullName(r)) },
    };
  }
  return { ok: true, value: { id: rows[0].id, name: fullName(rows[0]) } };
}

/** Etkinlik adından tek bir etkinlik bulur (bitmemiş olanlar önce). */
async function resolveEvent(ctx: ServiceContext, query: string, now: Date): Promise<Resolved<{ id: string; name: string }>> {
  const name = cleanText(query);
  const where = { tenantId: ctx.tenantId, ...venueScope(ctx), status: { not: "CANCELLED" as const }, endsAt: { gte: now } };
  const rows = await db.event.findMany({
    where: name ? { ...where, name: { contains: name, mode: "insensitive" } } : where,
    select: { id: true, name: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
    take: 6,
  });
  if (rows.length === 0) return { ok: false, result: { ok: false, message: name ? `“${name}” adında yaklaşan bir etkinlik yok.` : "Yaklaşan etkinlik yok." } };
  if (rows.length > 1 && name === "") {
    return { ok: false, result: { ok: false, message: "Hangi etkinlik olduğunu yazın.", options: rows.map((r) => `${r.name} · ${formatRange(r.startsAt, r.endsAt)}`) } };
  }
  if (rows.length > 1) {
    return { ok: false, result: { ok: false, message: `“${name}” ile ${rows.length} etkinlik eşleşti; tam adını yazın.`, options: rows.map((r) => r.name) } };
  }
  return { ok: true, value: { id: rows[0].id, name: rows[0].name } };
}

/** Mekan adından mekan bulur; tek mekan varsa onu kullanır. */
async function resolveVenue(ctx: ServiceContext, query: string): Promise<Resolved<{ id: string; name: string }>> {
  const name = cleanText(query);
  const rows = await db.venue.findMany({
    where: { tenantId: ctx.tenantId, isActive: true, ...(ctx.venueIds ? { id: { in: ctx.venueIds } } : {}), ...(name ? { name: { contains: name, mode: "insensitive" } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 6,
  });
  if (rows.length === 1) return { ok: true, value: rows[0] };
  if (rows.length === 0) return { ok: false, result: { ok: false, message: name ? `“${name}” adında bir mekan yok.` : "Erişebildiğiniz bir mekan yok." } };
  return { ok: false, result: { ok: false, message: "Hangi mekan olduğunu yazın.", options: rows.map((r) => r.name) } };
}

// ─────────────────────────────────────────────── Araçlar

const musteriEkle: AssistantTool = {
  name: "musteri_ekle",
  description: "CRM'e yeni müşteri kaydı ekler. Telefon veya e-postadan en az biri gerekir.",
  permission: "customers.create",
  confirm: false,
  parameters: {
    type: "object",
    properties: {
      ad: { type: "string", description: "Kişinin adı" },
      soyad: { type: "string", description: "Kişinin soyadı" },
      telefon: { type: "string", description: "Telefon numarası, ör. 0532 123 45 67" },
      eposta: { type: "string", description: "E-posta adresi" },
      etiketler: { type: "array", items: { type: "string" }, description: "Eklenecek etiketler" },
      not: { type: "string", description: "Müşteri kartına yazılacak not" },
    },
    required: ["ad", "soyad"],
  },
  async run(ctx, args) {
    try {
      const customer = await createCustomer(ctx, {
        firstName: str(args, "ad"),
        lastName: str(args, "soyad"),
        phone: str(args, "telefon"),
        email: str(args, "eposta"),
        tags: strList(args, "etiketler"),
        notes: str(args, "not"),
        source: "MANUAL",
      });
      return {
        ok: true,
        title: `${fullName(customer)} müşteri olarak eklendi.`,
        detail: "Kayıt aktivite geçmişine yazıldı. İletişim izni ayrıca işaretlenmelidir.",
        links: [{ href: `/customers/${customer.id}`, label: "Müşteri kartını aç" }],
      };
    } catch (error) {
      return failure(error);
    }
  },
};

const etiketEkle: AssistantTool = {
  name: "etiket_ekle",
  description: "Kayıtlı bir müşteriye etiket ekler. Mevcut etiketler korunur.",
  permission: "customers.update",
  confirm: false,
  parameters: {
    type: "object",
    properties: {
      kisi: { type: "string", description: "Müşterinin adı veya telefon numarası" },
      etiketler: { type: "array", items: { type: "string" }, description: "Eklenecek etiketler" },
    },
    required: ["kisi", "etiketler"],
  },
  async run(ctx, args) {
    const tags = strList(args, "etiketler");
    if (tags.length === 0) return { ok: false, message: "Hangi etiketi ekleyeceğimi yazın." };
    const found = await resolveCustomer(ctx, str(args, "kisi"));
    if (!found.ok) return found.result;
    try {
      const current = await getCustomerForEdit(ctx, found.value.id);
      const merged = [...current.tagNames, ...tags];
      await updateCustomer(ctx, found.value.id, {
        firstName: current.firstName,
        lastName: current.lastName,
        phone: current.phone ?? "",
        email: current.email ?? "",
        birthDate: current.birthDate ?? "",
        notes: current.notes ?? "",
        tags: merged,
      });
      return {
        ok: true,
        title: `${found.value.name} kaydına ${tags.map((t) => `“${t}”`).join(", ")} etiketi eklendi.`,
        links: [{ href: `/customers/${found.value.id}`, label: "Müşteri kartını aç" }],
      };
    } catch (error) {
      return failure(error);
    }
  },
};

const izinKaydet: AssistantTool = {
  name: "izin_kaydet",
  description:
    "Bir müşterinin iletişim iznini kaydeder veya kaldırır. İzin verilirken iznin nasıl alındığı mutlaka yazılmalıdır; kullanıcı söylemediyse bu aracı çağırma, önce sor.",
  permission: "consents.manage",
  confirm: false,
  parameters: {
    type: "object",
    properties: {
      kisi: { type: "string", description: "Müşterinin adı veya telefon numarası" },
      kanal: { type: "string", enum: [...CHANNELS], description: "İzin kanalı" },
      verildi: { type: "boolean", description: "true: izin verildi, false: izin kaldırıldı" },
      nasil_alindi: { type: "string", description: "İznin nasıl alındığı, ör. 'kayıt formunda onayladı'" },
    },
    required: ["kisi", "kanal", "verildi", "nasil_alindi"],
  },
  async run(ctx, args) {
    const channel = str(args, "kanal").toUpperCase();
    if (!isOneOf(CHANNELS, channel)) return { ok: false, message: "Kanal WhatsApp, SMS veya e-posta olabilir." };
    const grant = args.verildi !== false;
    const note = str(args, "nasil_alindi");
    if (grant && note.length < 3) return { ok: false, message: "İzni kaydetmem için nasıl alındığını yazmanız gerekiyor." };
    const found = await resolveCustomer(ctx, str(args, "kisi"));
    if (!found.ok) return found.result;
    try {
      await setConsent(ctx, { customerId: found.value.id, channel, grant, note });
      return {
        ok: true,
        title: `${found.value.name} için ${labelOf(CHANNEL_LABELS, channel)} izni ${grant ? "kaydedildi" : "kaldırıldı"}.`,
        detail: grant ? `Kayda düşülen açıklama: “${note}”` : undefined,
        links: [{ href: `/customers/${found.value.id}`, label: "Müşteri kartını aç" }],
      };
    } catch (error) {
      return failure(error);
    }
  },
};

const guestEkle: AssistantTool = {
  name: "guest_ekle",
  description: "Yaklaşan bir etkinliğin misafir (guest) listesine kişi ekler.",
  permission: "guests.manage",
  confirm: false,
  parameters: {
    type: "object",
    properties: {
      etkinlik: { type: "string", description: "Etkinliğin adı" },
      ad: { type: "string" },
      soyad: { type: "string" },
      telefon: { type: "string", description: "Telefon numarası zorunludur" },
      kisi_sayisi: { type: "integer", description: "Kaç kişi geleceği, varsayılan 1" },
    },
    required: ["etkinlik", "ad", "soyad", "telefon"],
  },
  async run(ctx, args, now) {
    const event = await resolveEvent(ctx, str(args, "etkinlik"), now);
    if (!event.ok) return event.result;
    const partySize = Number(args.kisi_sayisi);
    try {
      await addGuestToEvent(
        ctx,
        event.value.id,
        {
          firstName: str(args, "ad"),
          lastName: str(args, "soyad"),
          phone: str(args, "telefon"),
          partySize: Number.isFinite(partySize) && partySize > 0 ? partySize : 1,
          source: "ORGANIC",
        },
        now,
      );
      const people = Number.isFinite(partySize) && partySize > 1 ? ` (${partySize} kişi)` : "";
      return {
        ok: true,
        title: `${str(args, "ad")} ${str(args, "soyad")}${people}, ${event.value.name} misafir listesine eklendi.`,
        detail: "Giriş QR'ı etkinlik ekranındaki misafir kartından paylaşılır.",
        links: [{ href: `/events/${event.value.id}/guests`, label: "Misafir listesini aç" }],
      };
    } catch (error) {
      return failure(error);
    }
  },
};

const etkinlikOlustur: AssistantTool = {
  name: "etkinlik_olustur",
  description:
    "Yeni etkinlik oluşturur. Tarihler 'YYYY-MM-DDTHH:mm' biçiminde ve İstanbul saatiyle verilmelidir. Kullanıcı yayınlamasını istemediyse taslak olarak kaydedilir.",
  permission: "events.manage",
  confirm: false,
  parameters: {
    type: "object",
    properties: {
      ad: { type: "string", description: "Etkinlik adı" },
      mekan: { type: "string", description: "Mekan adı; işletmenin tek mekanı varsa boş bırakılabilir" },
      baslangic: { type: "string", description: "Başlangıç, ör. 2026-10-03T23:00" },
      bitis: { type: "string", description: "Bitiş, ör. 2026-10-04T04:00" },
      kapasite: { type: "integer", description: "Kapasite (opsiyonel)" },
      yayinla: { type: "boolean", description: "true ise yayına alır, aksi halde taslak kalır" },
    },
    required: ["ad", "baslangic", "bitis"],
  },
  async run(ctx, args) {
    const startsAt = str(args, "baslangic");
    const endsAt = str(args, "bitis");
    if (!parseLocalDateTime(startsAt) || !parseLocalDateTime(endsAt)) {
      return { ok: false, message: "Etkinliğin tarih ve saatini net yazın, ör. “3 Ekim 23:00 – 4 Ekim 04:00”." };
    }
    const venue = await resolveVenue(ctx, str(args, "mekan"));
    if (!venue.ok) return venue.result;
    const capacity = Number(args.kapasite);
    const publish = args.yayinla === true;
    try {
      const event = await createEvent(ctx, {
        name: str(args, "ad"),
        venueId: venue.value.id,
        startsAt,
        endsAt,
        capacity: Number.isFinite(capacity) && capacity > 0 ? String(capacity) : "",
        status: publish ? "PUBLISHED" : "DRAFT",
      });
      return {
        ok: true,
        title: `“${event.name}” ${publish ? "yayına alındı" : "taslak olarak oluşturuldu"}.`,
        detail: `${venue.value.name} · ${formatRange(event.startsAt, event.endsAt)}`,
        links: [{ href: `/events/${event.id}`, label: "Etkinliği aç" }],
      };
    } catch (error) {
      return failure(error);
    }
  },
};

const kampanyaGonder: AssistantTool = {
  name: "kampanya_gonder",
  description:
    "Seçilen kitleye SMS veya e-posta kampanyası gönderir. Gerçek kişilere mesaj gider ve geri alınamaz; bu yüzden kullanıcıya önce özet gösterilip onayı alınır.",
  permission: "campaigns.manage",
  confirm: true,
  parameters: {
    type: "object",
    properties: {
      kanal: { type: "string", enum: ["SMS", "EMAIL"], description: "Gönderim kanalı" },
      kitle: { type: "string", enum: [...SEGMENT_KEYS], description: "Hazır kitle anahtarı" },
      metin: { type: "string", description: "Gönderilecek mesaj metni; kişinin adı için {{ad}} kullanılabilir" },
      konu: { type: "string", description: "Yalnızca e-postada: konu başlığı" },
    },
    required: ["kanal", "kitle", "metin"],
  },
  async run(ctx, args, now) {
    const channel = str(args, "kanal").toUpperCase();
    const segment = str(args, "kitle") as SegmentKey;
    const body = typeof args.metin === "string" ? args.metin.trim() : "";
    if (channel !== "SMS" && channel !== "EMAIL") {
      return { ok: false, message: "WhatsApp gönderimi Meta onaylı şablon gerektirir; kampanya ekranından yapılmalı." };
    }
    if (!(SEGMENT_KEYS as readonly string[]).includes(segment)) return { ok: false, message: "Hangi kitleye gönderileceğini seçin." };
    if (body.length < 10) return { ok: false, message: "Gönderilecek metni yazın." };
    const audience = { kind: "SEGMENT" as const, key: segment };
    try {
      const campaign =
        channel === "SMS"
          ? await startSmsCampaign(ctx, { audience, body }, now)
          : await startEmailCampaign(ctx, { audience, body, subject: str(args, "konu") || SEGMENT_COPY[segment].label }, now);
      return {
        ok: true,
        title: `${CAMPAIGN_CHANNEL_LABELS[channel]} kampanyası başlatıldı.`,
        detail: `${SEGMENT_COPY[segment].label} kitlesi · durumlar sağlayıcıdan geldikçe güncellenir.`,
        links: [{ href: `/campaigns/${campaign.id}`, label: "Kampanyayı izle" }],
      };
    } catch (error) {
      return failure(error);
    }
  },
};

export const ASSISTANT_TOOLS: AssistantTool[] = [musteriEkle, etiketEkle, izinKaydet, guestEkle, etkinlikOlustur, kampanyaGonder];

export function toolByName(name: string): AssistantTool | null {
  return ASSISTANT_TOOLS.find((t) => t.name === name) ?? null;
}

/** Kullanıcının yetkili olduğu araçlar — modele yalnızca bunlar tanıtılır. */
export function toolsFor(ctx: ServiceContext): AssistantTool[] {
  return ASSISTANT_TOOLS.filter((t) => can(ctx.role, t.permission));
}

/** Onay ekranında gösterilecek özet: gerçekten kaç kişiye gideceği dahil. */
export async function describeAction(ctx: ServiceContext, tool: AssistantTool, args: Record<string, unknown>, now: Date) {
  const rows: { label: string; value: string }[] = [];
  if (tool.name === "kampanya_gonder") {
    const channel = str(args, "kanal").toUpperCase() === "EMAIL" ? "EMAIL" : "SMS";
    const segment = str(args, "kitle") as SegmentKey;
    rows.push({ label: "Kanal", value: CAMPAIGN_CHANNEL_LABELS[channel] });
    if ((SEGMENT_KEYS as readonly string[]).includes(segment)) {
      rows.push({ label: "Kitle", value: SEGMENT_COPY[segment].label });
      try {
        const summary = await summarizeAudience(ctx, { kind: "SEGMENT", key: segment }, now, channel);
        rows.push({ label: "Gönderilecek kişi", value: `${summary.sendable} kişi` });
      } catch {
        // Kitle sayısı okunamazsa onay ekranı yine de gösterilir; sayı gönderim anında yeniden hesaplanır.
      }
    }
  }
  return rows;
}

export type { Channel };
