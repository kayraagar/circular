/**
 * Circular'ı işleten şirketin yasal kimliği.
 *
 * Yasal metinlerde veri sorumlusunun kimliği zorunludur (6698 sayılı KVKK m.10).
 * Bu bilgiler uydurulamaz; ortam değişkenlerinden okunur. Eksikse yasal sayfalar
 * metni "taslak" olarak işaretler ve yayına hazır olmadığını açıkça yazar.
 */

export type LegalIdentity = {
  /** Ticaret unvanı, ör. "Örnek Teknoloji A.Ş." */
  companyName: string | null;
  address: string | null;
  mersis: string | null;
  /** Veri sorumlusuna başvuru için e-posta */
  email: string | null;
  /** Kayıtlı elektronik posta (KEP) — yazılı başvuru için */
  kep: string | null;
  phone: string | null;
  /** VERBİS kayıt numarası (kayıt yükümlülüğü varsa) */
  verbis: string | null;
  /** Uyuşmazlıkta yetkili yer, ör. "İstanbul" */
  jurisdiction: string;
};

const value = (raw: string | undefined) => raw?.trim() || null;

export function legalIdentity(): LegalIdentity {
  const env = process.env;
  return {
    companyName: value(env.LEGAL_COMPANY_NAME),
    address: value(env.LEGAL_ADDRESS),
    mersis: value(env.LEGAL_MERSIS),
    email: value(env.LEGAL_CONTACT_EMAIL),
    kep: value(env.LEGAL_KEP),
    phone: value(env.LEGAL_PHONE),
    verbis: value(env.LEGAL_VERBIS),
    jurisdiction: value(env.LEGAL_JURISDICTION) ?? "İstanbul",
  };
}

/** Yayına alınabilmesi için en azından unvan, adres ve başvuru adresi gerekir. */
export function legalIdentityReady(identity: LegalIdentity = legalIdentity()): boolean {
  return Boolean(identity.companyName && identity.address && (identity.email || identity.kep));
}

/** Metinde boş bırakılamayacak alanlar için görünür yer tutucu. */
export function orPlaceholder(value: string | null, label: string): string {
  return value ?? `[${label} girilmedi]`;
}
