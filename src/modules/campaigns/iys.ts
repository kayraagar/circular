import "server-only";

/**
 * İYS (İleti Yönetim Sistemi) bağlantı noktası.
 * 250.000 adresin altındaki işletmeler İYS'ye yalnızca Ticaret Bakanlığı yetkili entegratör üzerinden erişebilir;
 * entegratörün API'si bağlanınca bu arayüz onun istemcisiyle gerçekleştirilir.
 * Bağlantı yokken müşterilere pazarlama mesajı gönderilmez; yalnızca ekibin test numaralarına gönderim yapılır.
 */

/** İYS'de alıcının MESAJ (SMS + anlık mesaj) izni. */
export type IysMessageConsent = "ONAY" | "RET" | "YOK";

export type IysGateway = {
  configured: boolean;
  /** Arayüzde gösterilecek sağlayıcı adı */
  name: string | null;
  /** İşletme (marka) adına telefonların güncel MESAJ izin durumu. */
  checkMessageConsents(tenantId: string, phones: string[]): Promise<Map<string, IysMessageConsent>>;
};

const NOT_CONFIGURED: IysGateway = {
  configured: false,
  name: null,
  async checkMessageConsents() {
    throw new Error("İYS entegrasyonu bağlı değil.");
  },
};

let override: IysGateway | null = null;

export function getIysGateway(): IysGateway {
  return override ?? NOT_CONFIGURED;
}

/** Yalnızca testler: sahte entegratör bağlar (null → varsayılana döner). */
export function setIysGatewayForTesting(gateway: IysGateway | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("Yalnızca test ortamında kullanılabilir.");
  override = gateway;
}
