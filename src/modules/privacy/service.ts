import "server-only";
import { db, type Tx } from "@/lib/db";
import { assertCan, type ServiceContext } from "@/lib/authz";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/normalize";
import { logActivity } from "@/modules/activity/service";

/**
 * KVKK ilgili kişi hakları (m.11): veriye erişim/taşınabilirlik, anonimleştirme ve kalıcı silme.
 *
 * İki silme biçimi vardır ve ikisi de geri alınamaz:
 *
 *  - **Anonimleştirme** (önerilen): kişinin kimlik ve iletişim bilgileri her yerden silinir,
 *    ziyaret/kayıt sayıları anonim istatistik olarak kalır. KVKK m.7'nin "anonim hâle getirme"
 *    karşılığıdır ve işletmenin geçmiş raporları bozulmaz.
 *  - **Kalıcı silme**: kişiye ait tüm satırlar veritabanından kaldırılır. Geçmiş raporlardaki
 *    sayılar da düşer.
 *
 * Her iki işlemde de aktivite geçmişindeki ad/telefon/e-posta gibi anlık görüntüler temizlenir —
 * yoksa "silinen" kişi denetim kaydında okunmaya devam ederdi.
 */

const ANON_FIRST = "Silinmiş";
const ANON_LAST = "kayıt";

/** Aktivite kaydı metadata'sında kişisel veri taşıyabilecek alanlar. */
const PERSONAL_METADATA_KEYS = [
  "customerName",
  "name",
  "fullName",
  "firstName",
  "lastName",
  "phone",
  "email",
  "toPhone",
  "toEmail",
  "contact",
  "guestName",
  "birthDate",
  "note",
  "notes",
];

/**
 * Aktivite kaydındaki kişisel anlık görüntüleri temizler.
 * Eylem ve zaman korunur (denetim izi kaybolmaz), ad ve iletişim bilgisi silinir.
 */
async function scrubActivityMetadata(tx: Tx, tenantId: string, customerId: string, label: string) {
  const rows = await tx.activityLog.findMany({
    where: { tenantId, customerId },
    select: { id: true, metadata: true },
  });
  for (const row of rows) {
    if (!row.metadata) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      await tx.activityLog.update({ where: { id: row.id }, data: { metadata: null } });
      continue;
    }
    let changed = false;
    for (const key of PERSONAL_METADATA_KEYS) {
      if (key in parsed) {
        parsed[key] = key === "customerName" || key === "name" ? label : null;
        changed = true;
      }
    }
    if (changed) await tx.activityLog.update({ where: { id: row.id }, data: { metadata: JSON.stringify(parsed) } });
  }
}

async function loadCustomer(ctx: ServiceContext, customerId: string) {
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId: ctx.tenantId } });
  if (!customer) throw new NotFoundError("Müşteri bulunamadı.");
  return customer;
}

// ─────────────────────────────────────────────── Anonimleştirme

/**
 * Kişinin kimlik ve iletişim bilgilerini kalıcı olarak siler; ziyaret ve kayıt sayıları
 * anonim olarak kalır. Geri alınamaz.
 */
export async function anonymizeCustomer(ctx: ServiceContext, customerId: string, now = new Date()) {
  assertCan(ctx, "privacy.manage");
  const customer = await loadCustomer(ctx, customerId);
  if (customer.anonymizedAt) throw new ConflictError("Bu kayıt zaten anonimleştirilmiş.", "ALREADY_ANONYMIZED");
  const name = fullName(customer);

  await db.$transaction(async (tx) => {
    // Kişisel bağlantılar: etiketler, izinler ve kişiye özel QR'lar silinir.
    await tx.customerTag.deleteMany({ where: { customerId, tenantId: ctx.tenantId } });
    await tx.contactConsent.deleteMany({ where: { customerId, tenantId: ctx.tenantId } });
    await tx.pass.deleteMany({ where: { customerId, tenantId: ctx.tenantId } });
    // Etkinlik notu serbest metindir; kişi hakkında bilgi taşıyabilir.
    await tx.eventRegistration.updateMany({ where: { customerId, tenantId: ctx.tenantId }, data: { note: null } });
    // Gönderilmiş mesajların alıcı adresi silinir; sayılar (teslim/okundu) kalır.
    await tx.campaignMessage.updateMany({ where: { customerId, tenantId: ctx.tenantId }, data: { toPhone: null, toEmail: null } });

    await tx.customer.update({
      where: { id: customerId },
      data: {
        firstName: ANON_FIRST,
        lastName: ANON_LAST,
        searchName: "",
        phone: null,
        email: null,
        birthDate: null,
        notes: null,
        anonymizedAt: now,
        archivedAt: customer.archivedAt ?? now,
      },
    });

    await scrubActivityMetadata(tx, ctx.tenantId, customerId, `${ANON_FIRST} ${ANON_LAST}`);
    await logActivity(tx, ctx, {
      action: "customer.anonymized",
      entityType: "customer",
      entityId: customerId,
      customerId,
      // Silinen kişinin adı kayda yazılmaz; yalnızca işlemin yapıldığı bilinir.
      metadata: { nameLength: name.length },
    });
  });

  return { id: customerId };
}

// ─────────────────────────────────────────────── Kalıcı silme

/**
 * Kişiye ait bütün satırları siler. Kampanya mesajları kişiden koparılır (gönderim sayıları
 * kampanya raporunda kalır, kime gittiği kalmaz). Geri alınamaz.
 */
export async function deleteCustomerPermanently(ctx: ServiceContext, customerId: string) {
  assertCan(ctx, "privacy.manage");
  const customer = await loadCustomer(ctx, customerId);

  await db.$transaction(async (tx) => {
    // CampaignMessage.customerId (NoAction) silmeyi engeller: önce bağ koparılır.
    await tx.campaignMessage.updateMany({
      where: { customerId, tenantId: ctx.tenantId },
      data: { customerId: null, toPhone: null, toEmail: null },
    });
    await scrubActivityMetadata(tx, ctx.tenantId, customerId, "Silinmiş kayıt");
    await tx.activityLog.updateMany({ where: { tenantId: ctx.tenantId, customerId }, data: { customerId: null } });
    // Kalan bağlar (etiket, izin, üyelik, kayıt, giriş, QR, avantaj) cascade ile düşer.
    await tx.customer.delete({ where: { id: customerId } });
    await logActivity(tx, ctx, {
      action: "customer.deleted",
      entityType: "customer",
      entityId: customerId,
      metadata: { source: customer.source },
    });
  });

  return { id: customerId };
}

// ─────────────────────────────────────────────── Veriye erişim / taşınabilirlik

export type CustomerExport = {
  exportedAt: string;
  tenant: { name: string };
  /** KVKK m.11-b/c: hangi verinin işlendiği ve amacı */
  customer: Record<string, unknown>;
  tags: string[];
  consents: Record<string, unknown>[];
  venueMemberships: Record<string, unknown>[];
  eventRegistrations: Record<string, unknown>[];
  checkIns: Record<string, unknown>[];
  perkRedemptions: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  activity: Record<string, unknown>[];
};

/**
 * Kişinin işletmede tutulan tüm verisi (makine okunur JSON).
 * Başvuru sahibine verilmek üzere üretilir; panelden indirilir.
 */
export async function exportCustomerData(ctx: ServiceContext, customerId: string, now = new Date()): Promise<CustomerExport> {
  assertCan(ctx, "privacy.manage");
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId: ctx.tenantId },
    include: {
      tenant: { select: { name: true } },
      tags: { include: { tag: { select: { name: true } } } },
      consents: true,
      venueMemberships: { include: { venue: { select: { name: true } } } },
      registrations: { include: { event: { select: { name: true, startsAt: true } } } },
      checkIns: { include: { event: { select: { name: true } } } },
      perkRedemptions: { include: { perk: { select: { name: true } } } },
      campaignMessages: { include: { campaign: { select: { name: true, channel: true } } } },
    },
  });
  if (!customer) throw new NotFoundError("Müşteri bulunamadı.");
  const activity = await db.activityLog.findMany({
    where: { tenantId: ctx.tenantId, customerId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return {
    exportedAt: now.toISOString(),
    tenant: { name: customer.tenant.name },
    customer: {
      ad: customer.firstName,
      soyad: customer.lastName,
      telefon: customer.phone,
      ePosta: customer.email,
      dogumTarihi: customer.birthDate,
      notlar: customer.notes,
      kaynak: customer.source,
      kayitTarihi: customer.createdAt.toISOString(),
      arsivlendi: customer.archivedAt?.toISOString() ?? null,
      anonimlestirildi: customer.anonymizedAt?.toISOString() ?? null,
    },
    tags: customer.tags.map((t) => t.tag.name),
    consents: customer.consents.map((c) => ({
      kanal: c.channel,
      durum: c.status,
      kaynak: c.source,
      metinSurumu: c.consentTextVersion,
      verildi: c.grantedAt?.toISOString() ?? null,
      geriAlindi: c.revokedAt?.toISOString() ?? null,
      not: c.note,
    })),
    venueMemberships: customer.venueMemberships.map((m) => ({
      mekan: m.venue.name,
      kaynak: m.source,
      katilim: m.joinedAt.toISOString(),
      ayrilis: m.leftAt?.toISOString() ?? null,
    })),
    eventRegistrations: customer.registrations.map((r) => ({
      etkinlik: r.event.name,
      tarih: r.event.startsAt.toISOString(),
      kisiSayisi: r.partySize,
      kanal: r.channel,
      durum: r.accessStatus,
      kayitTarihi: r.createdAt.toISOString(),
    })),
    checkIns: customer.checkIns.map((c) => ({ etkinlik: c.event?.name ?? null, giris: c.checkedInAt.toISOString(), kisiSayisi: c.admittedCount })),
    perkRedemptions: customer.perkRedemptions.map((r) => ({ avantaj: r.perk.name, kullanim: r.redeemedAt.toISOString() })),
    messages: customer.campaignMessages.map((m) => ({
      kampanya: m.campaign.name,
      kanal: m.campaign.channel,
      durum: m.status,
      gonderim: m.acceptedAt?.toISOString() ?? null,
      teslim: m.deliveredAt?.toISOString() ?? null,
    })),
    activity: activity.map((a) => ({
      islem: a.action,
      tarih: a.createdAt.toISOString(),
      ayrinti: a.metadata ? (JSON.parse(a.metadata) as unknown) : null,
    })),
  };
}
