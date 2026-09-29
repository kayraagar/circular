import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from "@/lib/errors";
import { foldText, fullName } from "@/lib/normalize";
import { createRateLimiter } from "@/lib/rate-limit";
import { CHANNELS, VENUE_TYPE_LABELS, isOneOf, labelOf, type Channel, type VenueType } from "@/lib/domain";
import { findContactConflict, parseContactFields } from "@/modules/customers/service";
import { logActivity } from "@/modules/activity/service";
import { readTenantLegal } from "@/modules/legal/tenant-legal";
import { registrationStats } from "@/modules/events/service";
import { SERIALIZABLE, createPass } from "@/modules/passes/internal";
import { derivePassToken } from "@/modules/passes/token";
import { VENUE_SIGNUP_CONSENT_TEXTS, VENUE_SIGNUP_CONSENT_VERSION, VENUE_SIGNUP_NOTE } from "./rules";

/**
 * Mekanın müşteriye açık sayfası (`/v/<kısa-ad>`).
 *
 * Üç şey yapar: mekanı tanıtır, yaklaşan yayındaki etkinlikleri listeler ve kişinin kendi
 * kaydını açmasına izin verir. Üç kavram burada da ayrıdır:
 *  - **CRM kaydı**: kişinin işletmedeki profili,
 *  - **Mekan üyeliği** (`VenueMembership`): bu mekanı takip ettiği,
 *  - **İletişim izni** (`ContactConsent`): kanal kanal, ayrı onay kutularıyla.
 * Etkinliğe kayıt olmak tek başına iletişim izni **vermez**.
 *
 * Sayfa yalnızca açık (`isActive`) mekanı ve yayındaki (`PUBLISHED`) etkinlikleri gösterir.
 */

const signupLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 5, prefix: "venue-signup:" });
export async function resetVenuePageRateLimit() {
  await signupLimiter.reset();
}

export type PublicEvent = {
  id: string;
  name: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  /** Kayıt penceresi durumu; yalnızca "OPEN" iken kayıt alınır. */
  registration: "OPEN" | "NOT_YET" | "CLOSED" | "FULL";
  opensAt: Date | null;
  closesAt: Date | null;
  capacity: number | null;
  spotsLeft: number | null;
};

export type PublicVenue = {
  venueId: string;
  tenantId: string;
  name: string;
  slug: string;
  typeLabel: string;
  city: string | null;
  address: string | null;
  tenantName: string;
  /** Menü yayındaysa müşteriye açık menü adresi. */
  menuPath: string | null;
  events: PublicEvent[];
  legal: Awaited<ReturnType<typeof readTenantLegal>>;
};

/** Kayıt penceresi: açılış verilmemişse etkinlik yayınlandığı an açıktır, kapanış yoksa başlangıçta kapanır. */
export function registrationState(
  event: { startsAt: Date; registrationOpensAt: Date | null; registrationClosesAt: Date | null; capacity: number | null },
  taken: number,
  now: Date,
): { state: PublicEvent["registration"]; opensAt: Date | null; closesAt: Date | null; spotsLeft: number | null } {
  const opensAt = event.registrationOpensAt;
  const closesAt = event.registrationClosesAt ?? event.startsAt;
  const spotsLeft = event.capacity === null ? null : Math.max(0, event.capacity - taken);
  if (opensAt && opensAt > now) return { state: "NOT_YET", opensAt, closesAt, spotsLeft };
  if (closesAt <= now) return { state: "CLOSED", opensAt, closesAt, spotsLeft };
  if (spotsLeft !== null && spotsLeft <= 0) return { state: "FULL", opensAt, closesAt, spotsLeft };
  return { state: "OPEN", opensAt, closesAt, spotsLeft };
}

export async function getPublicVenue(slug: string, now = new Date()): Promise<PublicVenue | null> {
  const venue = await db.venue.findUnique({
    where: { slug },
    include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
  });
  if (!venue || !venue.isActive || venue.tenant.status !== "ACTIVE") return null;

  const [events, menu, legal] = await Promise.all([
    db.event.findMany({
      where: { venueId: venue.id, status: "PUBLISHED", endsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 20,
    }),
    db.menuConfig.findUnique({ where: { tenantId: venue.tenantId }, select: { id: true } }),
    readTenantLegal(venue.tenantId),
  ]);

  const taken = await registrationStats(venue.tenantId, events.map((e) => e.id));
  return {
    venueId: venue.id,
    tenantId: venue.tenantId,
    name: venue.name,
    slug: venue.slug,
    typeLabel: labelOf(VENUE_TYPE_LABELS, venue.type as VenueType),
    city: venue.city,
    address: venue.address,
    tenantName: venue.tenant.name,
    menuPath: menu ? `/m/${venue.tenant.slug}` : null,
    events: events.map((e) => {
      const r = registrationState(e, taken.get(e.id)?.people ?? 0, now);
      return {
        id: e.id,
        name: e.name,
        description: e.description,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        registration: r.state,
        opensAt: r.opensAt,
        closesAt: r.closesAt,
        capacity: e.capacity,
        spotsLeft: r.spotsLeft,
      };
    }),
    legal,
  };
}

export type VenueSignupInput = {
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  email?: unknown;
  /** Bal küpü alanı: insanlara gizlidir, otomatik doldurucular doldurur. */
  website?: unknown;
  consents?: unknown;
  /** Doluysa kişi aynı anda bu etkinliğe de kaydolur. */
  eventId?: unknown;
  partySize?: unknown;
};

export type VenueSignupResult =
  | { status: "created"; tenantId: string; phone: string | null; passToken: string | null; eventName: string | null }
  | { status: "existing" }
  | { status: "ignored" };

/**
 * Kişinin kendi kaydı. Bilgisi zaten kayıtlıysa **hiçbir şey değiştirilmez** (`existing`):
 * herkese açık form mevcut kaydı güncelleyemez, yoksa başkasının kaydı ele geçirilebilirdi.
 */
export async function venueSignup(slug: string, raw: VenueSignupInput, meta: { ip: string; now?: Date }): Promise<VenueSignupResult> {
  const now = meta.now ?? new Date();
  const venue = await getPublicVenue(slug, now);
  if (!venue) throw new NotFoundError("Mekan bulunamadı.");

  const limit = await signupLimiter.hit(`${meta.ip}|${venue.venueId}`);
  if (!limit.allowed) {
    throw new ConflictError(
      `Kısa sürede çok fazla deneme yapıldı. ${Math.max(1, Math.ceil(limit.retryAfterSec / 60))} dakika sonra tekrar deneyin.`,
      "RATE_LIMITED",
    );
  }
  if (typeof raw.website === "string" && raw.website.trim() !== "") return { status: "ignored" };

  const errors: FieldErrors = {};
  const add = (key: string, message: string) => (errors[key] = [...(errors[key] ?? []), message]);
  const contact = parseContactFields(
    { firstName: raw.firstName ?? "", lastName: raw.lastName ?? "", phone: raw.phone ?? "", email: raw.email ?? "" },
    errors,
  );
  const phoneEntered = typeof raw.phone === "string" && raw.phone.trim() !== "";
  if (contact && !phoneEntered && !errors.phone) add("phone", "Telefon numarası gerekli.");

  const requested = Array.isArray(raw.consents) ? raw.consents : [];
  const channels = [...new Set(requested.filter((c): c is Channel => isOneOf(CHANNELS, c)))];
  if (requested.some((c) => !isOneOf(CHANNELS, c))) add("consents", "Geçersiz iletişim tercihi.");
  if (contact && channels.includes("EMAIL") && !contact.email) add("email", "E-posta ile duyuru almak için e-posta adresinizi yazın.");

  // Etkinlik seçilmişse kayıt penceresi ve kapasite kontrol edilir.
  const eventId = typeof raw.eventId === "string" && raw.eventId.trim() ? raw.eventId.trim() : null;
  const event = eventId ? venue.events.find((e) => e.id === eventId) : null;
  if (eventId && !event) add("eventId", "Etkinlik bulunamadı.");
  if (event && event.registration !== "OPEN") {
    add("eventId", event.registration === "FULL" ? "Bu etkinlik doldu." : "Bu etkinliğin kayıtları kapalı.");
  }
  const partySize = Math.min(Math.max(Number(raw.partySize) || 1, 1), 10);
  if (event && event.spotsLeft !== null && partySize > event.spotsLeft) {
    add("partySize", `Bu etkinlikte ${event.spotsLeft} kişilik yer kaldı.`);
  }
  if (Object.keys(errors).length > 0 || !contact) throw new ValidationError(errors);

  if (await findContactConflict(venue.tenantId, contact)) return { status: "existing" };

  const actor = { tenantId: venue.tenantId, userId: null };
  // Serializable: kapasite kontrolü ile kayıt arasında başka bir kayıt araya girmemeli.
  const created = await db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        tenantId: venue.tenantId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        searchName: foldText(`${contact.firstName} ${contact.lastName}`),
        phone: contact.phone,
        email: contact.email,
        source: "EVENT_PAGE",
        sourceVenueId: venue.venueId,
      },
    });
    const customerName = fullName(customer);
    await logActivity(tx, actor, {
      action: "customer.self_registered",
      entityType: "customer",
      entityId: customer.id,
      customerId: customer.id,
      metadata: { customerName, venueName: venue.name },
    });

    for (const channel of channels) {
      const consent = await tx.contactConsent.create({
        data: {
          tenantId: venue.tenantId,
          customerId: customer.id,
          channel,
          status: "GRANTED",
          source: "PUBLIC_SIGNUP",
          note: VENUE_SIGNUP_NOTE,
          consentTextVersion: VENUE_SIGNUP_CONSENT_VERSION,
          grantedAt: now,
        },
      });
      await logActivity(tx, actor, {
        action: "consent.granted",
        entityType: "consent",
        entityId: consent.id,
        customerId: customer.id,
        metadata: { customerName, channel, note: VENUE_SIGNUP_NOTE, text: VENUE_SIGNUP_CONSENT_TEXTS[channel] },
      });
    }

    await tx.venueMembership.create({
      data: { tenantId: venue.tenantId, venueId: venue.venueId, customerId: customer.id, source: "EVENT_PAGE", joinedAt: now },
    });

    if (!event) return { phone: customer.phone, passToken: null as string | null, eventName: null as string | null };

    // Kapasite işlem içinde yeniden sayılır: form gönderilirken son yerler dolmuş olabilir.
    if (event.capacity !== null) {
      const sum = await tx.eventRegistration.aggregate({
        where: { eventId: event.id, tenantId: venue.tenantId, accessStatus: "ACTIVE" },
        _sum: { partySize: true },
      });
      if ((sum._sum.partySize ?? 0) + partySize > event.capacity) {
        throw new ConflictError("Bu etkinlikte yeterli yer kalmadı.", "EVENT_FULL");
      }
    }

    const registration = await tx.eventRegistration.create({
      data: {
        tenantId: venue.tenantId,
        eventId: event.id,
        customerId: customer.id,
        partySize,
        channel: "PUBLIC_PAGE",
        completionStatus: "SELF_COMPLETED",
      },
    });
    await logActivity(tx, actor, {
      action: "registration.self_registered",
      entityType: "registration",
      entityId: registration.id,
      customerId: customer.id,
      eventId: event.id,
      metadata: { customerName, eventName: event.name, partySize },
    });

    // Yeni kayıt olan kişiye giriş QR'ı hemen verilir (kendi bilgisiyle kaydoldu).
    const pass = await createPass(tx, {
      tenantId: venue.tenantId,
      purpose: "EVENT_ENTRY",
      customerId: customer.id,
      registrationId: registration.id,
      maxUses: 1,
      issuedByUserId: null,
    });
    await logActivity(tx, actor, {
      action: "pass.issued",
      entityType: "pass",
      entityId: pass.id,
      customerId: customer.id,
      eventId: event.id,
      metadata: { customerName, eventName: event.name, purpose: "EVENT_ENTRY" },
    });
    return { phone: customer.phone, passToken: derivePassToken(pass.id), eventName: event.name };
  }, SERIALIZABLE);

  return { status: "created", tenantId: venue.tenantId, phone: created.phone, passToken: created.passToken, eventName: created.eventName };
}
