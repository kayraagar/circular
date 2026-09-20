import type { Role } from "./domain";
import { ForbiddenError } from "./errors";

/**
 * Rol → izin haritası. Arayüz de bunu kullanır ama asıl kontrol
 * servis fonksiyonlarında (assertCan) sunucu tarafında yapılır.
 */
const PERMISSIONS = {
  "dashboard.view": ["OWNER_ADMIN", "CRM_MANAGER"],
  "customers.view": ["OWNER_ADMIN", "CRM_MANAGER"],
  "customers.create": ["OWNER_ADMIN", "CRM_MANAGER"],
  "customers.update": ["OWNER_ADMIN", "CRM_MANAGER"],
  "customers.archive": ["OWNER_ADMIN"],
  "consents.manage": ["OWNER_ADMIN", "CRM_MANAGER"],
  "events.view": ["OWNER_ADMIN", "CRM_MANAGER"],
  "events.manage": ["OWNER_ADMIN", "CRM_MANAGER"],
  "guests.manage": ["OWNER_ADMIN", "CRM_MANAGER"],
  "activity.view": ["OWNER_ADMIN", "CRM_MANAGER"],
  // Raporlar: dönemsel giriş, kayıt, kazanım ve kampanya sonuçları
  "reports.view": ["OWNER_ADMIN", "CRM_MANAGER"],
  "settings.view": ["OWNER_ADMIN"],
  // Hazırlanıyor modülleri (yalnızca bilgi sayfaları)
  "modules.preview": ["OWNER_ADMIN", "CRM_MANAGER"],
  // Güvenli QR
  "passes.issue": ["OWNER_ADMIN", "CRM_MANAGER"],
  "door.checkin": ["OWNER_ADMIN", "DOOR"],
  // Yanlış kaydedilen girişi silmek veri düzeltmesidir: yalnızca işletme sahibi.
  "checkin.undo": ["OWNER_ADMIN"],
  // Giriş penceresini uzatmak kapıda alınan bir karardır; denetim kaydı tutulur.
  "entry.extend": ["OWNER_ADMIN", "DOOR"],
  "perks.manage": ["OWNER_ADMIN", "CRM_MANAGER"],
  // QR Menü oluşturucu (menü tasarımı, kategori ve ürün yönetimi)
  "menu.manage": ["OWNER_ADMIN", "CRM_MANAGER"],
  "perks.issue": ["OWNER_ADMIN", "CRM_MANAGER"],
  "perks.redeem": ["OWNER_ADMIN", "WAITER"],
  // PR ve misafir listesi: PR yalnızca kendi getirdiği guest'leri görür ve ekler; yönetim herkesi görür.
  "promoter.guests": ["OWNER_ADMIN", "CRM_MANAGER", "PR"],
  // PR yönetimi: ekip performansı ve PR'lara talimat verme
  "pr.manage": ["OWNER_ADMIN", "CRM_MANAGER"],
  "pr.portal": ["PR"],
  // Kampanyalar: şablon, kitle seçimi, test ve kampanya gönderimi
  "campaigns.manage": ["OWNER_ADMIN", "CRM_MANAGER"],
  // İşletmenin WhatsApp numarasını bağlamak/ayırmak hesap düzeyinde bir karardır
  "whatsapp.connect": ["OWNER_ADMIN"],
  // SMS, e-posta ve Instagram kanal kurulumu (hesap bağlama, gönderici ve yasal bilgiler)
  "channels.connect": ["OWNER_ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/**
 * Servis katmanına geçirilen bağlam. Oturumdan (cookie) bağımsızdır;
 * bu sayede servisler test edilebilir ve her çağrı tenant'ı açıkça taşır.
 */
export type ServiceContext = {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: Role;
  /** Erişilebilir mekanlar. null = tenant'ın tüm mekanları. */
  venueIds: string[] | null;
};

export function assertCan(ctx: ServiceContext, permission: Permission) {
  if (!can(ctx.role, permission)) throw new ForbiddenError();
}

export function canAccessVenue(ctx: ServiceContext, venueId: string) {
  return ctx.venueIds === null || ctx.venueIds.includes(venueId);
}

/** Prisma where parçası: kullanıcının erişebildiği mekanlar. */
export function venueScope(ctx: ServiceContext) {
  return ctx.venueIds === null ? {} : { venueId: { in: ctx.venueIds } };
}
