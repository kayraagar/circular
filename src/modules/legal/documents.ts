import { brand } from "@/config/brand";
import { legalIdentity, orPlaceholder, type LegalIdentity } from "@/config/legal";

/**
 * Yasal metinler.
 *
 * İçerik uydurulmuş bir şablon değildir: uygulamanın gerçekten işlediği veriler, kullandığı
 * çerezler ve veri aktardığı üçüncü taraflar koddan çıkarılarak yazılmıştır. Metinler
 * 6698 sayılı KVKK'nın aradığı unsurları (m.10) karşılamayı hedefler; yayına almadan önce
 * bir avukatın gözden geçirmesi gerekir. Sürüm bilgisi, onay kayıtlarıyla eşleşsin diye tutulur.
 */

export const LEGAL_SLUGS = ["aydinlatma", "gizlilik", "kosullar", "cerez", "veri-isleme"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export function parseLegalSlug(value: unknown): LegalSlug | null {
  return typeof value === "string" && (LEGAL_SLUGS as readonly string[]).includes(value) ? (value as LegalSlug) : null;
}

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  list?: string[];
  table?: { headers: string[]; rows: string[][] };
};

export type LegalDocument = {
  slug: LegalSlug;
  title: string;
  summary: string;
  version: string;
  updatedAt: string;
  sections: LegalSection[];
};

/** Metinler değiştikçe artar; onay kayıtlarında bu sürüm saklanır. */
export const LEGAL_VERSION = "1.0";
export const LEGAL_UPDATED_AT = "2026-09-26";

const KVKK_RIGHTS = [
  "Kişisel verinizin işlenip işlenmediğini öğrenme",
  "İşlenmişse buna ilişkin bilgi talep etme",
  "İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme",
  "Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme",
  "Eksik veya yanlış işlenmişse düzeltilmesini isteme",
  "Kanunun 7. maddesindeki şartlar çerçevesinde silinmesini veya yok edilmesini isteme",
  "Düzeltme, silme ve yok etme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme",
  "Münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonuç doğmasına itiraz etme",
  "Kanuna aykırı işlenmesi sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme",
];

/** Kodun gerçekten kullandığı üçüncü taraflar. Bağlı değilse o hizmete veri gitmez. */
const SUBPROCESSORS: { name: string; purpose: string; country: string; data: string; state: string }[] = [
  {
    name: "Vercel Inc.",
    purpose: "Uygulamanın çalıştığı sunucu altyapısı",
    country: "ABD (bölge yapılandırmaya bağlı)",
    data: "Uygulamaya gelen tüm istekler ve bunlarda yer alan veriler",
    state: "Kullanımda",
  },
  {
    name: "Neon Inc.",
    purpose: "PostgreSQL veritabanı barındırma",
    country: "Yapılandırılan bölge (ABD veya AB)",
    data: "Panelde tutulan tüm kayıtlar",
    state: "Kullanımda",
  },
  {
    name: "Groq Inc.",
    purpose: "AI Asistan'ın dil modeli",
    country: "ABD",
    data: "Yalnızca kullanıcının yazdığı soru metni ve cevabın toplu sayıları; müşteri adı, telefonu ve e-postası gönderilmez",
    state: "Anahtar tanımlıysa kullanımda",
  },
  {
    name: "Netgsm İletişim Hizmetleri A.Ş.",
    purpose: "SMS gönderimi",
    country: "Türkiye",
    data: "Alıcı telefon numarası ve mesaj metni",
    state: "İşletme kendi hesabını bağlarsa",
  },
  {
    name: "Sendinblue SAS (Brevo)",
    purpose: "E-posta gönderimi ve teslim bildirimleri",
    country: "Fransa (AB)",
    data: "Alıcı e-posta adresi, mesaj içeriği, teslim/açılma bildirimleri",
    state: "Yapılandırılırsa",
  },
  {
    name: "Meta Platforms Ireland Ltd.",
    purpose: "WhatsApp Business Platform ve Instagram mesajlaşma",
    country: "İrlanda / ABD",
    data: "Alıcı telefon numarası veya Instagram kullanıcı kimliği, mesaj içeriği, teslim durumları",
    state: "İşletme hesabını bağlarsa",
  },
];

const SECURITY_MEASURES = [
  "Şifreler geri döndürülemez biçimde saklanır (scrypt); düz metin şifre tutulmaz.",
  "Oturum ve QR kodlarının ham değerleri saklanmaz, yalnızca kriptografik özetleri tutulur.",
  "Kanal erişim anahtarları (WhatsApp, SMS, e-posta, Instagram) şifrelenmiş olarak saklanır (AES-256-GCM).",
  "Her sorgu işletme kimliğiyle sınırlanır; veritabanı düzeyinde bileşik anahtarlarla işletmeler arası erişim engellenir.",
  "Rol bazlı yetkilendirme sunucu tarafında uygulanır; arayüzdeki gizleme tek başına yetki kontrolü sayılmaz.",
  "Panelde yapılan işlemler kim, ne zaman, neyi biçiminde denetim kaydına yazılır.",
  "Girişte hız sınırı uygulanır; sağlayıcı bildirimleri imza veya anahtar ile doğrulanır.",
  "Veri aktarımı TLS ile şifrelenir.",
];

function contactBlock(id: LegalIdentity): string[] {
  return [
    `Unvan: ${orPlaceholder(id.companyName, "Ticaret unvanı")}`,
    `Adres: ${orPlaceholder(id.address, "Adres")}`,
    ...(id.mersis ? [`MERSİS: ${id.mersis}`] : []),
    ...(id.verbis ? [`VERBİS kayıt no: ${id.verbis}`] : []),
    `E-posta: ${orPlaceholder(id.email, "E-posta")}`,
    ...(id.kep ? [`KEP: ${id.kep}`] : []),
    ...(id.phone ? [`Telefon: ${id.phone}`] : []),
  ];
}

function aydinlatma(id: LegalIdentity): LegalDocument {
  return {
    slug: "aydinlatma",
    title: "Aydınlatma Metni (Panel Kullanıcıları)",
    summary: `${brand.name} panelinde hesabı olan kişilerin verilerinin nasıl işlendiği — 6698 sayılı KVKK m.10 kapsamında.`,
    version: LEGAL_VERSION,
    updatedAt: LEGAL_UPDATED_AT,
    sections: [
      {
        heading: "1. Veri sorumlusu",
        paragraphs: [
          `Bu metin, ${brand.name} panelinde kullanıcı hesabı bulunan kişiler (işletme sahipleri, yöneticiler, PR, kapı ve salon personeli) içindir. Bu veriler bakımından veri sorumlusu aşağıdaki şirkettir.`,
        ],
        list: contactBlock(id),
      },
      {
        heading: "2. İşlenen kişisel veriler",
        list: [
          "Kimlik: ad soyad",
          "İletişim: e-posta adresi",
          "İşlem güvenliği: şifrenizin kriptografik özeti, oturum kayıtları, tarayıcı/cihaz tanıtıcısı (user-agent), son giriş zamanı",
          "İşlem kayıtları: panelde yaptığınız işlemlerin denetim kaydı (kim, ne zaman, hangi kayıt)",
          "Yetki bilgileri: bağlı olduğunuz işletme, rolünüz ve erişebildiğiniz mekanlar",
        ],
        paragraphs: [
          "Panelde ayrıca işletmenin müşterilerine ait veriler bulunur. Bu veriler bakımından veri sorumlusu ilgili işletmedir; ayrıntı için Veri İşleme Sözleşmesi sayfasına bakın.",
        ],
      },
      {
        heading: "3. İşleme amaçları",
        list: [
          "Hesabınızı oluşturmak, kimliğinizi doğrulamak ve oturumunuzu sürdürmek",
          "Rolünüze göre yetkilendirme yapmak ve yetkisiz erişimi engellemek",
          "Hizmetin güvenliğini sağlamak, kötüye kullanımı ve dolandırıcılığı önlemek",
          "Yapılan işlemlerin izlenebilirliğini sağlamak (denetim kaydı)",
          "Destek taleplerini karşılamak ve hizmeti işletmek",
        ],
      },
      {
        heading: "4. Hukuki sebepler",
        paragraphs: ["Verileriniz KVKK m.5/2 kapsamında, açık rızanız aranmaksızın şu sebeplere dayanılarak işlenir:"],
        list: [
          "m.5/2-c: Hizmet sözleşmesinin kurulması veya ifası için gerekli olması",
          "m.5/2-ç: Veri sorumlusunun hukuki yükümlülüğünü yerine getirmesi",
          "m.5/2-f: İlgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla veri sorumlusunun meşru menfaati (güvenlik ve denetim izi)",
        ],
      },
      {
        heading: "5. Toplama yöntemi",
        paragraphs: [
          "Veriler elektronik ortamda, panel arayüzü ve davet bağlantısı üzerinden, sizin girdiğiniz bilgiler ve sistemin otomatik olarak ürettiği kayıtlar yoluyla toplanır.",
        ],
      },
      {
        heading: "6. Aktarım",
        paragraphs: [
          "Verileriniz, hizmetin sunulabilmesi için aşağıdaki tedarikçilere aktarılır. Aktarım, yalnızca hizmetin gerektirdiği ölçüdedir; pazarlama amacıyla üçüncü taraflara veri satılmaz veya devredilmez.",
        ],
        table: {
          headers: ["Alıcı", "Amaç", "Ülke", "Aktarılan veri", "Durum"],
          rows: SUBPROCESSORS.map((s) => [s.name, s.purpose, s.country, s.data, s.state]),
        },
      },
      {
        heading: "7. Yurt dışına aktarım",
        paragraphs: [
          "Yukarıdaki tedarikçilerin bir kısmı yurt dışında bulunmaktadır. 1 Haziran 2024'te yürürlüğe giren düzenleme uyarınca yurt dışına aktarım; yeterlilik kararı, uygun güvenceler (standart sözleşme, bağlayıcı şirket kuralları, taahhütname) veya Kanun'daki istisnalar çerçevesinde yapılır.",
          "Standart sözleşme kullanılması hâlinde, sözleşme imzalanmasından itibaren beş iş günü içinde Kişisel Verileri Koruma Kurumu'na bildirilir (KVKK m.9/5).",
        ],
      },
      {
        heading: "8. Saklama süresi",
        list: [
          "Hesap ve yetki bilgileri: üyeliğiniz sürdüğü sürece; üyelik sona erdikten sonra zamanaşımı süreleri boyunca",
          "Oturum kayıtları: oturum süresi boyunca; süresi dolan oturumlar silinir",
          "Denetim kayıtları: işlemin izlenebilirliği için saklanır",
          "Davet bağlantıları: yedi gün sonra geçersizleşir; kullanılmış veya iptal edilmiş davetler kayıt amacıyla tutulur",
        ],
        paragraphs: ["Süre sonunda veriler silinir, yok edilir veya anonim hâle getirilir."],
      },
      {
        heading: "9. Haklarınız (KVKK m.11)",
        paragraphs: ["Veri sorumlusuna başvurarak şu haklarınızı kullanabilirsiniz:"],
        list: KVKK_RIGHTS,
      },
      {
        heading: "10. Başvuru yöntemi",
        paragraphs: [
          "Başvurunuzu, Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ uyarınca yazılı olarak, kayıtlı elektronik posta (KEP) adresiyle, güvenli elektronik imza, mobil imza ya da daha önce bildirdiğiniz ve sistemde kayıtlı bulunan e-posta adresiniz üzerinden iletebilirsiniz.",
          "Başvurular en geç otuz gün içinde sonuçlandırılır. Talebin ayrıca bir maliyet gerektirmesi hâlinde Kurul'ca belirlenen tarifedeki ücret alınabilir.",
        ],
        list: contactBlock(id),
      },
      {
        heading: "11. AB'de bulunan kişiler (GDPR)",
        paragraphs: [
          "Avrupa Birliği'nde bulunan kişilerin verilerinin işlenmesi hâlinde 2016/679 sayılı Genel Veri Koruma Tüzüğü de uygulanabilir. Bu durumda erişim, düzeltme, silme, işlemenin kısıtlanması, veri taşınabilirliği ve itiraz haklarınız saklıdır; denetim makamına şikâyet hakkınız vardır.",
        ],
      },
    ],
  };
}

function gizlilik(id: LegalIdentity): LegalDocument {
  return {
    slug: "gizlilik",
    title: "Gizlilik Politikası",
    summary: `${brand.name}'ın hangi verileri neden tuttuğu, nasıl koruduğu ve kiminle paylaştığı.`,
    version: LEGAL_VERSION,
    updatedAt: LEGAL_UPDATED_AT,
    sections: [
      {
        heading: "1. Kapsam ve roller",
        paragraphs: [
          `${brand.name}, restoran, kafe, pub, gece kulübü ve etkinlik mekanlarının müşteri ilişkilerini yönettiği bir yazılım hizmetidir. İki ayrı veri kümesi vardır ve sorumluluk farklıdır.`,
        ],
        list: [
          `Panel kullanıcılarının verileri: veri sorumlusu ${orPlaceholder(id.companyName, "Ticaret unvanı")}'dır.`,
          `Mekanın müşterilerine ait veriler: veri sorumlusu ilgili işletmedir; ${brand.name} bu veriler bakımından veri işleyendir ve yalnızca işletmenin talimatıyla işler.`,
        ],
      },
      {
        heading: "2. Toplanan veriler",
        list: [
          "Panel kullanıcıları: ad soyad, e-posta, şifre özeti, oturum ve işlem kayıtları",
          "Mekan müşterileri (işletme adına): ad soyad, telefon, e-posta, varsa doğum tarihi, etiketler, notlar, kanal bazında iletişim izinleri, etkinlik kayıtları, kapı girişleri ve avantaj kullanımları",
          "Herkese açık sayfalar: yalnızca kişinin formda girdiği bilgiler",
        ],
        paragraphs: [
          "Reklam veya analitik izleyici kullanılmaz. Ziyaretçi davranışını ölçen üçüncü taraf betiği yoktur; sayfa görüntüleme sayısı tutulmaz.",
        ],
      },
      {
        heading: "3. Kullanım amaçları",
        list: [
          "Hizmeti sunmak, hesapları ve yetkileri yönetmek",
          "İşletmenin kendi müşteri kayıtlarını tutması, etkinlik ve giriş süreçlerini yürütmesi",
          "İşletmenin izne dayalı olarak kendi müşterilerine ileti göndermesi",
          "Güvenlik, kötüye kullanımın önlenmesi ve denetim izi",
        ],
        paragraphs: [
          "Veriler, işletmeler arası karşılaştırma, profil satışı veya üçüncü taraflara pazarlama amacıyla kullanılmaz. Bir işletmenin verisi başka bir işletmeye gösterilmez.",
        ],
      },
      {
        heading: "4. Güvenlik önlemleri",
        list: SECURITY_MEASURES,
      },
      {
        heading: "5. Paylaşılan taraflar",
        paragraphs: ["Hizmetin çalışması için kullanılan tedarikçiler ve aktarılan veriler aşağıdadır."],
        table: {
          headers: ["Alıcı", "Amaç", "Ülke", "Aktarılan veri", "Durum"],
          rows: SUBPROCESSORS.map((s) => [s.name, s.purpose, s.country, s.data, s.state]),
        },
      },
      {
        heading: "6. Saklama ve silme",
        paragraphs: [
          "Veriler, işleme amacı ortadan kalktığında veya işletmenin aboneliği sona erdiğinde silinir, yok edilir ya da anonim hâle getirilir. İşletme, kendi müşteri kaydını panelden arşivleyebilir.",
          "Bir kişinin kalıcı olarak silinmesi veya anonimleştirilmesi talebi, verinin sorumlusu olan işletmeye iletilir; talep işletme tarafından değerlendirilir.",
        ],
      },
      {
        heading: "7. Veri ihlali",
        paragraphs: [
          "Kişisel veri ihlali öğrenildiğinde, veri sorumlusu ihlali en geç yetmiş iki saat içinde Kişisel Verileri Koruma Kurulu'na bildirir; ilgili kişilere de makul olan en kısa sürede bilgi verilir (Kurul'un 24.01.2019 tarihli ve 2019/10 sayılı kararı).",
          `${brand.name}, veri işleyen sıfatıyla öğrendiği ihlalleri gecikmeksizin ilgili işletmeye bildirir.`,
        ],
      },
      {
        heading: "8. Haklarınız",
        paragraphs: ["KVKK m.11 kapsamındaki haklarınızı kullanmak için başvuru yollarına Aydınlatma Metni'nden ulaşabilirsiniz."],
        list: KVKK_RIGHTS,
      },
      {
        heading: "9. Değişiklikler",
        paragraphs: [
          `Bu politika güncellendiğinde sürüm numarası ve tarih değişir. Yürürlükteki sürüm: ${LEGAL_VERSION} (${LEGAL_UPDATED_AT}).`,
        ],
      },
    ],
  };
}

function kosullar(id: LegalIdentity): LegalDocument {
  return {
    slug: "kosullar",
    title: "Kullanım Koşulları",
    summary: `${brand.name} hizmetinin kullanımına ilişkin koşullar ve tarafların yükümlülükleri.`,
    version: LEGAL_VERSION,
    updatedAt: LEGAL_UPDATED_AT,
    sections: [
      {
        heading: "1. Taraflar ve konu",
        paragraphs: [
          `Bu koşullar, ${orPlaceholder(id.companyName, "Ticaret unvanı")} ("Hizmet Sağlayıcı") ile ${brand.name} panelini kullanan işletme ("Abone") arasındaki kullanım şartlarını düzenler. Panele bir hesapla giriş yapan her kullanıcı bu koşulları kabul etmiş sayılır.`,
        ],
      },
      {
        heading: "2. Hizmetin tanımı",
        paragraphs: [
          "Hizmet; müşteri kaydı, etkinlik ve misafir listesi yönetimi, güvenli QR ile kapı girişi, avantaj kullandırma, QR menü, izne dayalı kampanya gönderimi, raporlama ve yapay zekâ destekli asistan işlevlerini kapsar.",
          "Hizmet sürekli geliştirilmektedir; işlevler eklenebilir veya değiştirilebilir. Önemli değişiklikler panel üzerinden duyurulur.",
        ],
      },
      {
        heading: "3. Hesap güvenliği",
        list: [
          "Hesap bilgilerinin gizliliğinden Abone sorumludur; şifreler paylaşılmamalıdır.",
          "Her ekip üyesine kendi hesabı açılmalı, ortak hesap kullanılmamalıdır.",
          "İşten ayrılan personelin erişimi Ayarlar ekranından derhâl kapatılmalıdır.",
          "Yetkisiz erişimden şüphelenilmesi hâlinde Hizmet Sağlayıcı'ya gecikmeksizin bildirilmelidir.",
        ],
      },
      {
        heading: "4. Abonenin veri koruma yükümlülükleri",
        paragraphs: [
          "Panelde tutulan müşteri verilerinin veri sorumlusu Abone'dir. Bu sıfatla Abone aşağıdakilerden sorumludur:",
        ],
        list: [
          "Müşterilerini, veri toplanmadan önce KVKK m.10 uyarınca aydınlatmak ve kendi aydınlatma metnini yayımlamak",
          "Gerekli hâllerde açık rıza almak ve rızanın ispatını saklamak",
          "VERBİS kayıt yükümlülüğü kapsamındaysa kaydını yaptırmak",
          "Kişisel verileri yalnızca hukuka uygun amaçlarla ve gerektiği kadar işlemek",
          "İlgili kişilerin başvurularını süresinde yanıtlamak",
        ],
      },
      {
        heading: "5. Ticari elektronik ileti",
        paragraphs: [
          "SMS, e-posta ve WhatsApp üzerinden gönderilen ticari iletiler 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun ile Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik'e tabidir.",
        ],
        list: [
          "Onay alınmadan ticari ileti gönderilemez; onaylar İleti Yönetim Sistemi'ne (İYS) kaydedilmelidir.",
          "Her iletide gönderenin tanıtıcı bilgileri ve kolay bir ret imkânı bulunmalıdır.",
          "Ret talepleri gecikmeksizin işleme alınmalıdır; panel, ret bildirimini aldığında ilgili izni kaldırır.",
          "İçerik ve gönderim kararının hukuka uygunluğundan Abone sorumludur; Hizmet Sağlayıcı iletinin içeriğini denetlemez.",
        ],
      },
      {
        heading: "6. Kabul edilemez kullanım",
        list: [
          "Hukuka aykırı biçimde elde edilmiş veri yüklemek",
          "İzinsiz toplu ileti göndermek",
          "Başka bir aboneye ait veriye erişmeye çalışmak veya güvenlik önlemlerini aşmayı denemek",
          "Hizmeti, üçüncü kişilere kendi adına yeniden satmak (yazılı izin olmadan)",
        ],
      },
      {
        heading: "7. Ücretlendirme",
        paragraphs: [
          "Abonelik ücretleri ve ödeme koşulları ayrı bir teklif veya sözleşmeyle belirlenir. Mesaj gönderim ücretleri (SMS, WhatsApp) ilgili sağlayıcının tarifesine tabidir ve panelde gösterilen tutarlar tahminîdir; esas olan sağlayıcı faturasıdır.",
        ],
      },
      {
        heading: "8. Hizmet seviyesi ve sorumluluk",
        paragraphs: [
          "Hizmet, makul çaba esasıyla sunulur. Kesintisiz veya hatasız çalışacağı taahhüt edilmez. Üçüncü taraf sağlayıcılardan (barındırma, mesajlaşma, dil modeli) kaynaklanan kesintilerden Hizmet Sağlayıcı sorumlu tutulamaz.",
          "Hizmet Sağlayıcı'nın sorumluluğu, her hâlükârda ilgili dönemde ödenen abonelik bedeliyle sınırlıdır. Dolaylı zararlar, kâr kaybı ve veri kaybından doğan talepler kapsam dışındadır. Bu sınırlama, kasıt ve ağır ihmal hâllerinde uygulanmaz.",
        ],
      },
      {
        heading: "9. Yapay zekâ asistanı",
        paragraphs: [
          "Asistan, panelde yetkili olduğunuz veriden hesaplanan sonuçları sunar ve sizin onayınızla işlem yapabilir. Ürettiği metinler taslaktır; gönderilen içeriğin ve yapılan işlemin sorumluluğu kullanıcıya aittir.",
          "Asistan kullanıldığında yazdığınız soru ve cevabın toplu sayıları dil modeli sağlayıcısına iletilir. Müşteri adı, telefonu ve e-postası gönderilmez.",
        ],
      },
      {
        heading: "10. Fesih ve verinin iadesi",
        paragraphs: [
          "Taraflar aboneliği yazılı bildirimle sona erdirebilir. Abonelik sona erdiğinde Abone, makul bir süre içinde verisinin dışa aktarımını talep edebilir; bu süre sonunda veriler silinir veya anonim hâle getirilir.",
        ],
      },
      {
        heading: "11. Uygulanacak hukuk ve yetki",
        paragraphs: [
          `Bu koşullara Türk hukuku uygulanır. Uyuşmazlıklarda ${id.jurisdiction} Mahkemeleri ve İcra Daireleri yetkilidir.`,
        ],
      },
    ],
  };
}

function cerez(): LegalDocument {
  return {
    slug: "cerez",
    title: "Çerez Politikası",
    summary: `${brand.name} yalnızca hizmetin çalışması için zorunlu çerezleri kullanır; reklam veya analitik çerezi yoktur.`,
    version: LEGAL_VERSION,
    updatedAt: LEGAL_UPDATED_AT,
    sections: [
      {
        heading: "1. Kullanılan çerezler",
        paragraphs: ["Uygulamada yalnızca aşağıdaki iki çerez kullanılır."],
        table: {
          headers: ["Çerez", "Amaç", "Tür", "Süre"],
          rows: [
            ["circular_session", "Oturumunuzu sürdürmek ve kimliğinizi doğrulamak", "Zorunlu · yalnızca sunucu okur (HttpOnly)", "Oturum süresi boyunca"],
            ["circular_flash", "İşlem sonrası tek seferlik bildirimi göstermek (ör. “Kaydedildi”)", "Zorunlu · arayüz bildirimi", "20 saniye"],
          ],
        },
      },
      {
        heading: "2. Neden açık rıza istenmiyor?",
        paragraphs: [
          "Kişisel Verileri Koruma Kurumu'nun Çerez Uygulamaları Hakkında Rehberi uyarınca, yalnızca kullanıcının açıkça talep ettiği hizmetin sunulabilmesi için kesinlikle gerekli olan çerezler açık rıza olmaksızın kullanılabilir.",
          "Yukarıdaki iki çerez bu kapsamdadır: oturum çerezi olmadan panele giriş yapılamaz. Reklam, analitik, sosyal medya veya profilleme çerezi kullanılmadığı için onay bandı (banner) gösterilmez.",
        ],
      },
      {
        heading: "3. Üçüncü taraf izleyiciler",
        paragraphs: [
          "Uygulamada Google Analytics, reklam pikseli veya benzeri bir izleme betiği bulunmaz. Müşteriye açık menü ve kayıt sayfalarında da izleyici çalıştırılmaz.",
        ],
      },
      {
        heading: "4. Çerezleri silmek",
        paragraphs: [
          "Tarayıcınızın ayarlarından çerezleri silebilir veya engelleyebilirsiniz. Oturum çerezi engellendiğinde panele giriş yapılamaz.",
        ],
      },
    ],
  };
}

function veriIsleme(id: LegalIdentity): LegalDocument {
  return {
    slug: "veri-isleme",
    title: "Veri İşleme Sözleşmesi (Özet)",
    summary: `İşletmeler veri sorumlusu, ${brand.name} veri işleyendir. Bu sayfa işleyen sıfatıyla verilen taahhütleri ve alt işleyenleri gösterir.`,
    version: LEGAL_VERSION,
    updatedAt: LEGAL_UPDATED_AT,
    sections: [
      {
        heading: "1. Rol dağılımı",
        paragraphs: [
          `Panelde tutulan müşteri verilerinin veri sorumlusu, o veriyi giren işletmedir. ${orPlaceholder(id.companyName, "Ticaret unvanı")} bu veriler bakımından veri işleyendir ve verileri yalnızca işletmenin talimatı doğrultusunda, hizmetin sunulması amacıyla işler.`,
          "Bu sayfa özet niteliğindedir; taraflar arasında ayrıca imzalanan sözleşme hükümleri saklıdır.",
        ],
      },
      {
        heading: "2. İşleyenin taahhütleri",
        list: [
          "Verileri yalnızca işletmenin talimatıyla ve hizmetin gerektirdiği ölçüde işlemek",
          "Verilere erişen personeli gizlilikle yükümlü tutmak ve erişimi görev gereğiyle sınırlamak",
          "KVKK m.12 kapsamında uygun teknik ve idari tedbirleri almak",
          "Öğrenilen veri ihlallerini gecikmeksizin işletmeye bildirmek",
          "İşletmeye ulaşan ilgili kişi başvurularının yanıtlanmasında makul desteği vermek",
          "Alt işleyen listesindeki değişiklikleri önceden duyurmak",
          "Sözleşme sona erdiğinde verileri işletmenin tercihine göre iade etmek veya silmek",
          "İşletmenin makul denetim taleplerine bilgi vererek destek olmak",
        ],
      },
      {
        heading: "3. Alt işleyenler",
        paragraphs: ["Hizmetin sunulabilmesi için aşağıdaki alt işleyenler kullanılır."],
        table: {
          headers: ["Alt işleyen", "Amaç", "Ülke", "Aktarılan veri", "Durum"],
          rows: SUBPROCESSORS.map((s) => [s.name, s.purpose, s.country, s.data, s.state]),
        },
      },
      {
        heading: "4. Yurt dışına aktarım",
        paragraphs: [
          "Alt işleyenlerin bir kısmı yurt dışındadır. Bu aktarımlar için KVKK m.9 uyarınca uygun güvence sağlanması gerekir: yeterlilik kararı, standart sözleşme, bağlayıcı şirket kuralları veya taahhütname.",
          "Standart sözleşme imzalanması hâlinde, imza tarihinden itibaren beş iş günü içinde Kişisel Verileri Koruma Kurumu'na bildirim yapılır.",
          "İşletme, kendi veri envanterinde ve aydınlatma metninde bu aktarımlara yer vermelidir.",
        ],
      },
      {
        heading: "5. İşlenen veri kategorileri ve ilgili kişi grupları",
        table: {
          headers: ["İlgili kişi grubu", "Veri kategorileri"],
          rows: [
            ["Mekan müşterileri", "Kimlik (ad soyad), iletişim (telefon, e-posta), varsa doğum tarihi, etiket ve notlar, iletişim izinleri"],
            ["Etkinlik misafirleri", "Kimlik, iletişim, kayıt ve kapı giriş kayıtları, kişi sayısı"],
            ["Panel kullanıcıları", "Kimlik, iletişim, işlem güvenliği ve denetim kayıtları"],
          ],
        },
      },
      {
        heading: "6. Süre",
        paragraphs: [
          "İşleme, abonelik süresince devam eder. Abonelik sona erdiğinde veriler, işletmenin talebi doğrultusunda iade edilir veya silinir; yasal saklama yükümlülüğü bulunan kayıtlar süresi boyunca saklanır.",
        ],
      },
    ],
  };
}

export function legalDocument(slug: LegalSlug, id: LegalIdentity = legalIdentity()): LegalDocument {
  switch (slug) {
    case "aydinlatma":
      return aydinlatma(id);
    case "gizlilik":
      return gizlilik(id);
    case "kosullar":
      return kosullar(id);
    case "cerez":
      return cerez();
    case "veri-isleme":
      return veriIsleme(id);
  }
}

export function legalDocuments(id: LegalIdentity = legalIdentity()): LegalDocument[] {
  return LEGAL_SLUGS.map((slug) => legalDocument(slug, id));
}
