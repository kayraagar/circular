# Circular — İşletme paneli (Faz 1)

Restoran, kafe, pub, gece kulübü ve etkinlik mekanlarının müşterilerini tanıması, guest listelerini yönetmesi ve
tekrar ziyareti artırması için B2B platform. Bu depo **Faz 1 + Güvenli QR** modülünü içerir: giriş, çok kiracılı
(multi-tenant) yetki altyapısı, CRM, etkinlik ve guest yönetimi, gerçek verilerle dashboard, aktivite geçmişi ve
kişiye özel QR ile kapıda giriş / masada avantaj doğrulama.

> Tüm demo işletme, mekan ve kişi adları kurgusaldır. Hiçbir mesaj gönderilmez.

---

## Hızlı başlangıç

Gereksinim: Node.js 20.19+ (22 önerilir) ve Postgres 15+.

```bash
brew install postgresql@17 && brew services start postgresql@17   # macOS
createdb circular_dev && createdb circular_test

npm install
cp .env.example .env        # DATABASE_URL ve SEED_DEMO_PASSWORD değerlerini düzenleyin
npm run setup               # migration uygula + demo verisi yükle
npm run dev                 # http://localhost:3000
```

| Komut | Açıklama |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm start` | Production build / çalıştırma |
| `npm test` | Servis katmanı testleri (ayrı `circular_test` veritabanında; `TEST_DATABASE_URL` ile değiştirilebilir) |
| `npm run typecheck` | TypeScript kontrolü |
| `npm run db:migrate` | Şema değişikliğinden yeni migration üret |
| `npm run db:seed` | Demo verisini **sıfırdan** yükle (mevcut veriyi siler) |
| `npm run db:reset` | Veritabanını sıfırla + migration + seed |
| `npm run create:owner` | Üretimde ilk işletmeyi ve işletme sahibini oluştur (demo verisi yüklemeden) |

## Yayına alma (Vercel + Neon)

1. **Veritabanı:** Vercel panelinde proje → Storage → Neon (Postgres) eklenir; bağlantı adresi `DATABASE_URL`
   olarak otomatik tanımlanır. Sunucusuz ortamda bağlantı havuzlu ("pooled") adres kullanılmalıdır.
2. **Ortam değişkenleri** (Vercel → Settings → Environment Variables):
   - `DATABASE_URL`, `APP_BASE_URL` (üretim adresi, ör. `https://circular.example`)
   - `PASS_TOKEN_SECRET`, `CHANNEL_TOKEN_SECRET` (en az 32 karakter; `openssl rand -base64 48`)
   - `SHOW_DEMO_ACCOUNTS="false"`, `WHATSAPP_MANUAL_CONNECT="false"`, `INSTAGRAM_MANUAL_CONNECT="false"`
   - Kanal anahtarları hazır oldukça: Meta, Brevo, Instagram (bkz. `.env.example`)
3. **Dağıtım:** Depo Vercel'e bağlanır. `npm run build` önce `prisma migrate deploy` çalıştırır, yani şema her
   dağıtımda güncellenir. `postinstall` Prisma istemcisini üretir.
4. **İlk hesap:** Üretim veritabanı boş başlar; demo verisi yüklenmez. Yerel makineden üretim `DATABASE_URL` ile:
   `npm run create:owner -- --isletme "..." --mekan "..." --ad "..." --eposta "..." --sifre "..."`
5. **Webhook adresleri** (kanal kurulduğunda sağlayıcıya girilir): `/api/webhooks/whatsapp`,
   `/api/webhooks/instagram`, `/api/webhooks/brevo`. Adresler ilgili kanal ekranlarında hazır gösterilir.

Sınırlar: Vercel'in ücretsiz planı yalnızca ticari olmayan kullanım içindir ve zamanlanmış görevleri günde bir kez
çalıştırır; kampanya kuyruğu isteğin ardından (`after()`) işlenir, yarım kalırsa kampanya sayfasındaki "Gönderime
devam et" ile sürdürülür. Bellek içi hız sınırları her sunucu kopyası için ayrı çalışır.

## Demo hesapları

Şifre, `.env` içindeki `SEED_DEMO_PASSWORD` değeridir. `SHOW_DEMO_ACCOUNTS="true"` iken giriş ekranında e-postalar listelenir.

| E-posta | İşletme | Rol | Ne gösterir |
| --- | --- | --- | --- |
| `sahip@orbita.example` | Orbita Hospitality (2 mekan) | İşletme sahibi | Tüm Faz 1 özellikleri, arşivleme, ayarlar |
| `crm@orbita.example` | Orbita Hospitality | CRM yöneticisi | CRM ve etkinlikler; arşivleme ve ayarlar yok |
| `sahip@lumen.example` | Lumen Kafe (1 mekan) | İşletme sahibi | Tamamen ayrı veri — izolasyon kontrolü |
| `danisman@circular.example` | Orbita + Lumen | CRM (Orbita) / Sahip (Lumen) | İşletme değiştirme, role göre farklı menü |
| `kapi@orbita.example` | Orbita (yalnızca Kulüp) | Kapı görevlisi | Kapı ekranı: QR ile giriş doğrulama; CRM'e sunucu tarafında erişemez |
| `garson@orbita.example` | Orbita (yalnızca Bahçe) | Garson | Avantaj doğrulama ekranı; müşteri verisine erişemez |
| `pr@orbita.example` | Orbita | PR | PR portalı: talimatlar, kendi misafirleri, kişisel davet linki ve QR |
| `platform@circular.example` | — | Platform yöneticisi | Tenant verisine otomatik erişim yok |

## Demo senaryosu (~7 dk)

1. **Giriş** — `sahip@orbita.example`. Genel Bakış: toplam/yeni müşteri, yaklaşan etkinlik, dönem kayıtları.
   7/30/90 gün değiştirin. Alttaki "Henüz ölçülmeyenler" kartı: check-in, gelir, kampanya dönüşümü **uydurulmuyor**.
2. **Mekan filtresi** — üst bardan "Orbita Kulüp" seçin; etkinlik metrikleri daralır, müşteri sayısı işletme geneli kalır.
3. **Müşteriler** — "sule" yazın (Türkçe karakter duyarsız arama), "0555 000 00" ile telefon araması, etiket/kaynak/izin filtreleri.
   Anlamsız bir arama yapın → boş sonuç durumu.
4. **Müşteri ekle** — mevcut bir müşterinin telefonunu farklı biçimde (`+90 555 000 00 01`) girin → mükerrer engellenir,
   mevcut kayda link verilir. Aynı ad-soyadla farklı e-posta girin → "olası mükerrer" uyarısı ve bilinçli onay.
5. **Profil** — etkinlik kayıtları, iletişim tercihleri (izin kaydet/kaldır, gerekçe zorunlu), üyelik ≠ CRM kaydı, aktivite geçmişi.
6. **Etkinlikler** — "Sezon Açılış Partisi"ni açın. *Kayıtlı müşteri* sekmesinden bir müşteri ekleyin; aynı kişiyi tekrar arayın →
   "Listede" olarak kilitli. *Yeni kişi* sekmesinde mevcut bir telefon girin → yeni müşteri **oluşturulmaz**, mevcut kaydı ekleme önerilir.
   Kişi sayısı 3 girin → kapasite halkası ve Genel Bakış güncellenir.
7. **Etkinlik oluştur** — taslak olarak kaydedin, yayına alın; aktivite geçmişinde görün.
8. **Giriş QR'ı** — "Sezon Açılış Partisi" guest listesinde bir satırdaki **QR** düğmesine basın. QR ve müşteriye
   gönderilecek bağlantı açılır; bağlantıyı kopyalayıp yeni sekmede açın (müşterinin gördüğü pass sayfası).
9. **Kapıda doğrulama** — aynı QR'ı telefon kamerasıyla okutun ya da pass sayfasındaki QR'ın içerdiği `/q/<token>`
   adresini panelde açın. Kişi sayısını seçip **Girişi onayla** deyin. Aynı QR'ı ikinci kez açın → "Bu QR kullanıldı".
   Etkinlik detayında "Gerçek giriş" sayısı ve guest satırında "Giriş yaptı" rozeti güncellenir.
10. **Kapı ekranı** — etkinlik detayında **Kapı ekranı**: giriş yapan kayıt/kişi sayısı, isimle arama, QR'sız guest için
    manuel giriş. `kapi@orbita.example` ile girince aynı ekran onun açılış sayfasıdır.
11. **Avantaj** — QR Menü › Avantajlar'da avantajları görün; bir müşteri profilinde **Avantajlar** bölümünden QR oluşturun.
    `garson@orbita.example` ile `/q/<token>` adresini açıp kullanımı onaylayın; kalan hak düşer.
12. **İzolasyon** — bir Orbita müşteri profilinin URL'sini kopyalayın, çıkış yapıp `sahip@lumen.example` ile girin ve URL'yi açın → 404.
    `kapi@orbita.example` ile `/customers` açın → 403. Lumen kullanıcısıyla bir Orbita QR'ını açın → müşteri pass sayfası görünür,
    işletme içi hiçbir bilgi gösterilmez.
13. **Sayfa yenileme** — tüm kayıtlar veritabanında kalıcıdır.

---

## Teknoloji seçimleri

| Katman | Seçim | Gerekçe |
| --- | --- | --- |
| Uygulama | Next.js 16 (App Router), React 19, TypeScript | Panel ve sonraki fazdaki public menü/üyelik sayfaları tek kod tabanında; Server Components + Server Actions ile yetki kontrolü doğal olarak sunucuda. Microservice yok. |
| Veri | Prisma 6 + Postgres | Migration altyapısı ve tip güvenliği; sunucusuz dağıtımda (Vercel) dosya tabanlı veritabanı çalışmadığı için Postgres. Şemada native enum yok, composite FK'ler standart SQL. |
| Stil | Tailwind CSS 4 | Tasarım token'ları `globals.css` içinde `@theme` ile. |
| Doğrulama | zod 4 | Tüm girdiler servis katmanında doğrulanır. |
| Telefon | libphonenumber-js | TR varsayılanlı E.164 normalizasyonu. |
| Parola | Node `crypto.scrypt` | Harici kripto bağımlılığı yok. |
| Test | `node:test` + tsx | Ek test çatısı gerekmez. |

## Mimari

```
src/
  config/        brand.ts (marka adı tek yerden), features.ts (faz bayrakları)
  lib/           db, auth (oturum, parola, hız sınırı), authz (rol→izin), context (oturum→tenant→rol→mekan),
                 datetime (Europe/Istanbul), normalize (telefon/e-posta/Türkçe arama), domain (durum sözlüğü)
  lib/qr/        bağımlısız QR kodlayıcı (bayt modu, seviye M, sürüm 1–10)
  modules/       customers | events | passes | perks | dashboard | activity | settings | auth
                 ├─ service.ts   iş kuralları + tenant/rol kontrolü (test edilebilir, cookie'den bağımsız)
                 ├─ rules.ts     (passes) saf geçerlilik kuralları
                 └─ actions.ts   Server Action'lar: formu okur → servisi çağırır → hata/başarı durumu döner
  app/
    login, no-access, forbidden, not-found
    pass/[token] müşterinin kişisel QR sayfası · q/[token] QR okutulunca açılan doğrulama
    (panel)/     dashboard, customers, events, door (kapı), redeem (garson), menu/perks, activity, settings,
                 workspace + hazırlanıyor modülleri
  components/    ui (tasarım sistemi), shell (sidebar, üst bar, mobil menü), paylaşılan bileşenler
prisma/          schema.prisma, migrations/, seed.ts
tests/           tenant izolasyonu, rol, mükerrer kayıt, guest kuralları, dashboard tutarlılığı, yardımcılar
docs/ROADMAP.md  sonraki fazlar ve açık kararlar
```

### Yetki katmanları (derinlemesine savunma)

1. **Proxy** (`src/proxy.ts`) — cookie yoksa girişe yönlendirir. *Güvenlik sınırı değildir.*
2. **Panel layout / sayfa** — `requireAppContext()` oturumu ve aktif üyeliği her istekte DB'den doğrular;
   `requirePermission()` rol yetkisi yoksa 403 döner.
3. **Servis katmanı** — her fonksiyon `ServiceContext` alır, `assertCan()` ile rolü kontrol eder ve **her sorguya
   `tenantId`** ekler. Başka tenant'ın kaydı "bulunamadı" (404) döner; varlığı sızdırılmaz. Server Action'lar da bu
   katmandan geçer, yani arayüzü atlayan istekler de engellenir.
4. **Veritabanı** — tenant'a bağlı alt kayıtlar `[id, tenantId]` composite foreign key ile bağlanır. Uygulama kodunda
   hata olsa bile bir guest kaydı başka tenant'ın müşterisine veya etkinliğine bağlanamaz (testte doğrulanır).

Tenant (işletme) ile Venue (mekan/şube) ayrı modellenir. Müşteri **işletme düzeyinde** tektir; etkinlikler mekana bağlıdır.
`MembershipVenue` ile personel belirli mekanlarla sınırlanabilir (demo: kapı görevlisi yalnızca Kulüp).

### Ayrı tutulan kavramlar

| Kavram | Model | Not |
| --- | --- | --- |
| Müşteri profili | `Customer` | Tenant içinde telefon ve e-posta benzersiz (normalize). Tenant'lar arası birleştirme yok. |
| Mekan üyeliği | `VenueMembership` | Müşterinin kendisinin katılmasıyla oluşur (Faz 2 public kayıt). CRM kaydı üyelik değildir. |
| İletişim izni | `ContactConsent` | Kanal bazında (WhatsApp/SMS/E-posta), kim/ne zaman/nasıl. Satır yoksa izin yok. Guest eklemek izin oluşturmaz. |
| Etkinlik kaydı | `EventRegistration` | `(eventId, customerId)` benzersiz. `partySize` isimsiz ek kişileri CRM'e eklemeden sayar. |
| Kayıt tamamlanma | `completionStatus` | Personel girdi / kişi tamamladı. |
| Giriş hakkı | `accessStatus` | Aktif / iptal. Etkinlik iptal edilince tüm giriş hakları düşer. |
| Gerçek giriş | `CheckIn` | Kayıt olmak veya QR açmak giriş değildir. `registrationId` benzersiz: bir kayıt için tek giriş. |
| Kişiye özel QR | `Pass` | Amaç: `EVENT_ENTRY` veya `PERK_REDEMPTION`. DB'de yalnızca token'ın SHA-256 özeti. |
| Avantaj tanımı | `Perk` | Mekan, koşullar, süre, kişi başı limit. |
| Avantaj kullanımı | `PerkRedemption` | Personel doğrulamasıyla oluşur; müşteri profiline işlenir. |

### Diğer kararlar

- **Tarihler** UTC saklanır, her yerde `Europe/Istanbul` gösterilir; form girdileri İstanbul saati olarak yorumlanır
  (sunucu saat diliminden bağımsız). Doğum tarihi saat dilimi kaymasın diye `YYYY-MM-DD` metin olarak saklanır.
- **Arama** Türkçe katlanmış `searchName` sütunu ile yapılır ("ŞULE" = "sule"), telefon rakamlarla eşleşir.
- **Mükerrer kontrolü**: aynı telefon/e-posta → engel + mevcut kayda link; aynı ad-soyad → uyarı + bilinçli onay.
- **Silme yerine arşiv**: müşteri arşivlenir (geri alınabilir, yalnızca işletme sahibi). KVKK silme/anonimleştirme Faz 2+.
- **Oturum**: 32 bayt rastgele token, httpOnly + SameSite=Lax (+ production'da Secure) cookie; DB'de yalnızca SHA-256 özeti.
  14 gün sabit süre. Giriş denemeleri IP+e-posta bazında sınırlanır; bilinmeyen e-postada sabit süreli yanıt.
- **CSRF**: Server Action'lar Next.js tarafından Origin kontrolünden geçer; cookie SameSite=Lax.
- **Marka**: ad yalnızca `src/config/brand.ts`'te. Logo sağlanınca `logoSrc` ayarlanır; o zamana kadar geçici çember sembolü.
- **Postgres'e geçiş**: `schema.prisma` → `provider = "postgresql"`, `.env` → Postgres URL, `prisma migrate dev` ile migration'ları yeniden üretin.

### Güvenli QR

- **QR içeriği** yalnızca `APP_BASE_URL/q/<token>` bağlantısıdır; ad, telefon, etkinlik gibi hiçbir kişisel veri taşımaz.
- **Token** `HMAC-SHA256(PASS_TOKEN_SECRET, pass.id)` ile türetilir (192 bit). Veritabanında yalnızca SHA-256 özeti durur;
  DB tek başına sızsa geçerli QR üretilemez. Aynı QR tekrar gösterilebilir, "kodu yenile" ile eskisi iptal edilir.
- **Tarama** için ek kütüphane yok: personel telefonunun kamera uygulaması bağlantıyı açar. Yetkili personel doğrulama
  ekranını görür; yetkisi olmayan veya oturumsuz herkes müşterinin pass sayfasına yönlenir. Sayfayı açmak (GET) hiçbir
  şey kaydetmez; giriş/kullanım yalnızca onay düğmesiyle oluşur.
- **Çift kullanım**: `useCount` üzerinde compare-and-set (`UPDATE ... WHERE useCount = okunan`) + `CheckIn.registrationId`
  benzersizliği. İki personel aynı anda okutsa bile tek kayıt oluşur (testte doğrulanır).
- **Her doğrulamada** sunucuda yeniden kontrol edilir: iptal, kullanım hakkı, guest/etkinlik iptali, giriş penceresi
  (başlangıçtan 6 saat önce → giriş kapanışı), avantaj süresi ve kişi başı limiti, personelin mekan yetkisi.
- **Rol sınırları**: kapı görevlisi yalnızca ad ve kişi sayısını, garson maskeli adı ("Ayşe Y.") ve avantaj bilgisini görür;
  telefon/e-posta hiçbir doğrulama ekranında yer almaz.
- **Girişi geri alma**: yanlış onaylanan giriş kapı ekranından silinebilir (yalnızca işletme sahibi). QR ile giriş
  yapıldıysa kod yeniden geçerli olur; kayıt silinse de işlem aktivite geçmişinde kalır (denetim izi).
- **Geç giriş**: gece uzarsa kapı görevlisi giriş penceresini 1 saat uzatabilir — en fazla etkinlik bitişinden 12 saat
  sonrasına kadar. Girişi yeni kapanan etkinlikler kapı listesinde 6 saat daha görünür; uzatma aktivite geçmişine yazılır.
- **Arşiv**: müşteri arşivi yalnızca listeleme/arama kuralıdır. Arşivdeki müşteriye de QR verilebilir ve daha önce
  verilmiş QR'lar geçerliliğini korur.
- **Kapı listesi**: tek seferde en fazla 300 guest gösterilir; sınıra ulaşıldığında ekran bunu söyler, kalanı isimle
  arayarak bulunur.
- **QR üretimi** `src/lib/qr/encoder.ts` içinde bağımlısız yazıldı (bayt modu, seviye M, sürüm 1–10). Çıktı, macOS
  CoreImage QR okuyucusuyla sürüm 1–10 ve Türkçe karakterler için birebir doğrulandı.
- **Telefonla test**: QR'daki adres `APP_BASE_URL` ile üretilir. Telefondan okutacaksanız bu değeri bilgisayarınızın
  ağdaki adresi yapın (ör. `http://192.168.1.20:3000`); `localhost` telefonda açılmaz.

---

## Faz 1 durumu

### Çalışanlar
- E-posta/şifre ile giriş, çıkış, güvenli oturum; rol bazlı açılış sayfası
- İşletme değiştirme (çok üyelikli kullanıcı), mekan filtresi
- Sol menü, üst bar, mobil çekmece menü; "Yakında" modüller için dürüst bilgi sayfaları
- Genel Bakış: toplam/yeni müşteri (önceki dönem karşılaştırmalı), yaklaşan etkinlikler + kapasite, dönem kayıtları, kayıt kaynakları, kanal bazlı izinler, son aktiviteler
- CRM: liste (masaüstü tablo / mobil kart), isim/telefon/e-posta araması, etiket/kaynak/izin/arşiv filtresi, sıralama, sayfalama, boş durumlar
- Müşteri ekleme/düzenleme (etiketler, notlar, doğum tarihi, kaynak, kanal bazlı izin), mükerrer kontrolü, arşivleme
- Müşteri profili: bilgiler, etkinlik kayıtları, iletişim tercihleri, üyelik, aktivite geçmişi
- Etkinlik oluşturma/düzenleme/yayın/taslak/iptal, yaklaşan/geçmiş listesi
- Guest ekleme: kayıtlı müşteri araması veya yeni kişi (CRM kaydı ile), grup kişi sayısı, kapasite kontrolü, tekrar ekleme engeli, iptal ve yeniden etkinleştirme, liste içinde arama
- Aktivite geçmişi (işlemle aynı transaction'da yazılır)
- **Güvenli QR**: guest listesinden kişiye özel giriş QR'ı, müşterinin pass sayfası, kapıda doğrulama ve check-in,
  kapı ekranı (arama + manuel giriş + girişi geri alma + giriş penceresini uzatma), avantaj tanımlama,
  müşteriye avantaj QR'ı verme ve garson doğrulaması
- Gerçek giriş verisi: etkinlik detayında check-in sayıları, guest satırında "Giriş yaptı / Gelmedi",
  müşteri profilinde doğrulanmış giriş ve avantaj kullanımı, Genel Bakış'ta dönemsel doğrulanmış kullanım
- **Menü oluşturucu** (soldaki **QR Menü** → `/menu`; eski `/menu/builder` adresi buraya yönlendirir):
  - 6 şablon (Minimal Liste, Fotoğraflı Kartlar, Galeri, Editoryal, Bistro, Gece) — her kartta canlı küçük önizleme;
    seçim önizlemeyi anında değiştirir, "Geri al" ile önceki taslağa dönülür.
  - Kişiselleştirme: arka plan / vurgu / yazı rengi (WCAG kontrast uyarısı), yazı tipi (Grotesk, Serif, Kondanse, Mono),
    köşeler, kart stili, yoğunluk, başlık hizası, fiyat gösterimi, slogan; öne çıkanlar, kategori sekmeleri, fotoğraf ve
    açıklama görünürlüğü.
  - Logo, kapak ve ürün fotoğrafı **dosya olarak yüklenir ve tarayıcıda kırpılır** (sürükle, yakınlaştır; ürünlerde
    1:1 / 4:3 / 16:9). Kütüphane kullanılmaz: canvas ile kırpılıp 850 KB altına sıkıştırılır.
  - Ürün rozetleri (Yeni, Şefin önerisi, Vegan, Vejetaryen, Glutensiz, Acı, Alkolsüz; en fazla 3), öne çıkan ürün,
    kategori açıklaması. Menü boşken önizleme "Örnek içerik" etiketiyle gösterilir, kaydedilmez.
- **Müşteriye açık menü** (`/m/[işletme-slug]`, oturum gerektirmez): yalnızca kaydedilmiş ve menüde görünen içerik;
  örnek içerik hiçbir zaman gösterilmez. Görseller `/m/[slug]/media/[id]` üzerinden yalnızca menüde kullanılıyorsa açılır.
- **Kampanya popup'ı ve menüden kayıt** (Menü oluşturucu › Kampanya):
  - Popup menü açıldıktan belirlenen saniye sonra görünür; kapatan kişiye 24 saat tekrar gösterilmez. Başlık, açıklama,
    düğme metni, kırpılmış görsel ve isteğe bağlı "yeni üyeye ikram" (mevcut avantajlardan) seçilir.
  - Düğme `/m/[slug]/katil` kayıt sayfasını açar: ad, soyad, telefon, isteğe bağlı e-posta; WhatsApp/SMS/e-posta izinleri
    kanal kanal ve **işaretsiz** sorulur.
  - Kayıt CRM'e `QR_MENU` kaynağıyla düşer; işaretlenen izinler `PUBLIC_SIGNUP` ve form metni sürümüyle kaydedilir,
    mekan üyeliği açılır, ikram seçildiyse kişiye özel avantaj QR sayfası açılır. Aktivite akışında "Sistem" olarak görünür.
  - Aynı telefon veya e-posta zaten kayıtlıysa **hiçbir bilgi değiştirilmez ve ikram verilmez** (telefon doğrulaması
    olmadığından başkası adına izin eklenmesini ve ikramın alınmasını önler). Bal küpü alanı ve IP başına hız sınırı vardır.
- **PR ve misafir listesi** (`/events/[id]/guests`; PR için soldaki **PR portalı** → `/workspace`):
  - Metrik kartları (davetli, içeride, bekleyen/gelmeyen) ve giriş yapan kişi oranına göre dolan dairesel halka;
    yönetim için PR bazında performans tablosu. Aranabilir misafir tablosu (mobilde liste).
  - `addGuestToEvent`: telefon `libphonenumber-js` ile doğrulanır; aynı telefonla aynı etkinliğe ikinci kayıt engellenir
    (servis kontrolü + tenant içinde tekil telefon + etkinlik başına tekil müşteri). Misafir eklemek izin/üyelik oluşturmaz.
  - `getPromoterStats`, `getEventGuestList`: PR yalnızca kendi getirdiği misafirleri ve sayılarını görür; ad ve telefon
    maskelidir, numara CRM'de zaten kayıtlıysa kişinin adı PR'a gösterilmez. Yönetim herkesi ve PR kırılımını görür.
  - PR ataması `EventRegistration.prMembershipId` → `Membership` composite FK'si. Durum (PENDING/CHECKED_IN/CANCELLED)
    ve kaynak (ORGANIC/PROMOTER/WALK_IN) saklanmaz; giriş hakkı, kapıdaki gerçek girişler ve kayıt kanalından türetilir.
    Giriş QR'ı mevcut güvenli pass sistemidir; PR yalnızca kendi misafiri için QR alabilir.
  - **Kişisel davet linki** (PR, misafir listesi sayfasındaki *Davet linkim* kartı): PR etkinliğe özel link ve QR oluşturur,
    kopyalar veya kendi cihazında WhatsApp ile paylaşır. Misafir `/davet/<kod>` sayfasında adını, telefonunu ve kişi
    sayısını (en çok 10) girer; kayıt otomatik olarak o PR'a yazılır (`channel = PR_REFERRAL`) ve yeni kişiye kendi giriş
    QR'ı açılır. Numara CRM'de zaten kayıtlıysa kayıt alınır ama QR ve kişi bilgisi gösterilmez, müşteri bilgisi
    değişmez; aynı numarayla ikinci kayıt ve iptal edilmiş kaydın yeniden açılması engellenir. Kod 128 bit rastgeledir
    (`PrInviteLink`); *Linki yenile* eski linki hemen geçersiz kılar, mevcut kayıtlar korunur. Kayıt penceresi,
    kapasite, bal küpü alanı ve bellek içi hız sınırı uygulanır; pasif PR'ın veya askıdaki işletmenin linki çalışmaz.
    Linkten kayıt iletişim izni oluşturmaz. Kartta linkten gelen kayıt, kişi ve içerideki kişi sayısı görünür.
- **PR Yönetimi** (soldaki **PR Yönetimi** → `/pr`; işletme sahibi ve CRM yöneticisi):
  - PR ekibinin son 30 gün ve yaklaşan etkinliklerdeki gerçek performansı (kayıt, kişi, içeride, giriş oranı).
  - PR'lara **talimat**: *Duyuru* (PR "Okudum" ile onaylar), *Görev* (PR "Tamamladım" ile işaretler), *Misafir hedefi*
    (etkinlik için PR başına kişi hedefi; ilerleme PR'ın beyanından değil gerçek misafir kayıtlarından hesaplanır).
    Alıcılar tüm aktif PR'lar veya seçilenler; etkinliğin mekanına erişemeyen PR alıcı olamaz. Talimat başına
    okundu/tamamlandı durumu ve PR bazında hedef ilerlemesi izlenir; kapatılan talimat PR portalından kalkar, geçmişi korunur.
  - PR talimatları **PR portalında** görür (`/workspace`). Talimatlar yalnızca panel içinde görünür, dışarıya bildirim gitmez.
- **Kampanyalar · WhatsApp** (soldaki **Kampanyalar** → `/campaigns`; işletme sahibi ve CRM yöneticisi):
  - **WhatsApp** sekmesi: işletme kendi numarasını Meta'nın bağlantı akışıyla (Embedded Signup) bağlar — yalnızca işletme
    sahibi. Erişim token'ı AES-256-GCM ile şifreli saklanır (`CHANNEL_TOKEN_SECRET`). Geliştirmede Meta'nın test numarası
    kimlik + geçici token ile elle bağlanabilir (`WHATSAPP_MANUAL_CONNECT="true"`). Ekibin kendi test numaraları (en fazla 5),
    İYS durumu, bu ayki kullanım (Meta'ya iletilen, teslim edilen, Meta'nın ücretli bildirdiği) ve webhook adresi.
  - **Şablonlar**: pazarlama şablonu panelde yazılır ve canlı önizlemeyle Meta onayına gönderilir. Tek değişken `{{ad}}`;
    ret bilgisi (alt metin) ve "Abonelikten çık" düğmesi zorunlu. Onay durumu Meta bildirimiyle veya "Durumu yenile" ile gelir.
  - **Yeni kampanya**: kitle üç yoldan seçilir — *Önerilen* (30/60/90 gündür gelmeyen, kaydolup gelmeyen, yeni ve henüz
    gelmemiş, bu ay doğum günü olan, 60 gündür mesaj gönderilmeyen), *Toplu* (WhatsApp izni olan herkes, etiket, bir
    etkinliğe gelenler), *Tek tek* (arama ile seçim). "Gelmek" kapıdaki gerçek giriş veya avantaj kullanımıdır. Öneriler
    kurallarla hesaplanır (yapay zekâ değil). Gönderimden önce kitle, gönderilecek kişi, elenme nedenleri ve tahmini
    Meta ücreti (Türkiye pazarlama ücreti, `MARKETING_RATE_TR_USD`) görünür; onayla tek tuşta gönderilir.
  - **Gönderim**: mesajlar veritabanı kuyruğuna yazılır ve istek bittikten sonra (`after()`) gönderilir. Her mesaj yalnızca
    bir kez alınır; gönderim anında arşiv, telefon değişimi, WhatsApp izni ve İYS onayı yeniden kontrol edilir.
    Kampanya sayfasında iletildi / teslim edildi / okundu / başarısız / gönderilmedi sayıları Meta bildirimlerinden gelir.
  - **İYS kuralı**: İYS entegratörü bağlı değilken müşterilere canlı gönderim kapalıdır; onaylı şablon yalnızca test
    numaralarına gönderilebilir. Entegratör bağlantı noktası `src/modules/campaigns/iys.ts`.
  - **Webhook** (`/api/webhooks/whatsapp`, `X-Hub-Signature-256` imzası `META_APP_SECRET` ile doğrulanır): sırasız gelen
    durumlar geri almaz; "Abonelikten çık" düğmesi veya yalnızca DUR/STOP/İPTAL gibi bir yanıt müşterinin WhatsApp iznini
    kaldırır (aktivite akışında "Sistem"). Bildirim yalnızca numaranın bağlı olduğu işletmenin kayıtlarını değiştirebilir.
- **Kampanyalar · SMS** (Netgsm, **SMS** sekmesi): işletme sahibi kendi Netgsm (alt) hesabını bağlar — kullanıcı adı, API
  şifresi (şifreli saklanır) ve Netgsm'den doğrulanan onaylı başlık — ve her ticari SMS'in sonuna eklenecek yasal bilgiyi
  (unvan/MERSIS, 0800 ret bilgisi) girer. Yeni kampanyada kanal olarak SMS seçilir; metin `{{ad}}` ile kişiselleşir, yaklaşık
  SMS adedi gösterilir. Yalnızca SMS izni olan Türkiye numaralarına gider. Canlı gönderim Netgsm'in İYS filtresiyle
  (`iysfilter=11`) yapılır: Netgsm İYS'de onayı olmayan numaraya iletmez, bu kişiler "Gönderilmedi · İYS'de onayı yok"
  olur. Teslim durumları "Teslim durumlarını güncelle" ile Netgsm raporundan okunur. Test gönderimi ekibin test
  numaralarına "TEST:" önekiyle gider.
- **Kampanyalar · E-posta** (Brevo, **E-posta** sekmesi): gönderim Circular'ın doğrulanmış adresinden (`BREVO_SENDER_EMAIL`),
  işletmenin görünen adıyla yapılır; işletme yanıt adresini ve yasal bilgiyi (unvan, adres, MERSIS) girer. Kampanyada konu,
  metin (`{{ad}}`, paragraflar) ve isteğe bağlı düğme; gönderilecek HTML'in birebir önizlemesi. Her e-postada imzalı
  "Abonelikten çık" bağlantısı (`/abonelik/<kod>`) ve tek tıkla çıkış başlığı (`List-Unsubscribe-Post`) bulunur; çıkış,
  spam şikâyeti ve sağlayıcının abonelik bildirimi e-posta iznini kaldırır. Brevo bildirimleri (`/api/webhooks/brevo`,
  `BREVO_WEBHOOK_TOKEN` ile) teslim, geri dönme, açılma (yaklaşık) ve tıklamayı işler. Test e-postası "[TEST]" önekiyle gider.
- **Instagram · DM otomasyonu** (**Instagram** sekmesi): Instagram'da toplu gönderim olmadığı için kampanya yerine otomatik
  yanıt. İşletme sahibi hesabı Instagram girişiyle bağlar (60 günlük erişim, süresi yaklaşınca kullanımda yenilenir;
  geliştirmede token ile elle bağlama). Kurallar: anahtar kelimeler (Türkçe karakter/büyük-küçük harf duyarsız), "mesaj
  yalnızca bu kelimeyse" veya "mesajda bu kelime geçerse", yanıt metni `{menu}` / `{kayit}` bağlantılarıyla. Aynı mesaja bir
  kez, aynı kişiye aynı kural 10 dakikada bir yanıt verilir; kişinin Instagram kimliği düz saklanmaz. Bildirimler
  `/api/webhooks/instagram` (imzalı).
- **AI Asistan** (soldaki **AI Asistan** → `/assistant`, ayrıca her panel ekranının sağ altındaki **Asistan** düğmesi;
  işletme sahibi ve CRM yöneticisi): yazılan soruyu tanımlı konularla eşleştirir ve cevabı **kullanıcının yetkili olduğu
  kayıtlardan** hesaplar — dönem özeti, kapıdan giriş, yoğun saat/gün, yeni müşteri ve kaynakları, biten etkinlikler, PR
  katkısı, kitle önerisi, iletişim izinleri, kampanya sonuçları, avantajlar ve kanal kurulum durumu. Ayrıca panel rehberi:
  guest ekleme, kampanya gönderme, QR menü, kapıda giriş, avantaj, PR daveti gibi işleri adım adım anlatıp ilgili ekrana
  bağlar. Kitleye uygun **taslak mesaj** üretir (şablon metin; işletme adı ve `{{ad}}` yerleştirilir).
  **İşlem de yapar:** "Ayşe Yılmaz'ı 0532 111 22 33 ile müşteri olarak ekle", "Ada'ya vip etiketi ekle", "Ada'nın SMS iznini
  kaydet (kayıt formunda onayladı)", "cumartesi 23:00 için Neon Gecesi oluştur", "Cuma Gecesi'ne Mert'i 2 kişi ekle" gibi
  istekleri mevcut servis fonksiyonlarını **kullanıcının kendi yetkisiyle** çağırarak gerçekleştirir; doğrulama, işletme
  kapsamı ve aktivite kaydı olduğu gibi işler. Eksik bilgi varsa değer uydurmaz, sorar. Silme ve arşivleme aracı yoktur.
  Gerçek kişilere mesaj gönderimi (SMS / e-posta kampanyası) önce özet ve kaç kişiye gideceğiyle onay kutusu açar.
  Gündelik sohbet de eder; sohbet cevapları "panel verisi kullanılmadı" etiketiyle gösterilir. Ciro, menü görüntüleme ve
  kampanya dönüşümü sorulursa bunların ölçülmediğini söyler, rakam vermez.
  Konuşma geçmişi sunucuya kaydedilmez.
  **Dil modeli (Groq, `GROQ_API_KEY`):** anahtar kelime eşleşmesi güçlüyse model çağrılmaz; zayıfsa soru modele
  sınıflandırtılır ve cevap cümlesini model yazar. Modele yalnızca yazdığınız soru ve cevabın toplu sayıları gider —
  müşteri adı, telefonu, e-postası gönderilmez; kişi ve PR cevaplarında model hiç devreye girmez. Modelin cümlesinde
  panelin hesaplamadığı bir sayı varsa cümle atılır ve hazır metin kullanılır. Anahtar yoksa veya modele ulaşılamazsa
  asistan anahtar kelime moduna düşer (Türkçe ek ve ünsüz yumuşaması toleranslı).
- **Yasal metinler** (`/yasal`; herkese açık, oturum gerektirmez): Aydınlatma Metni (panel kullanıcıları · KVKK m.10),
  Gizlilik Politikası, Kullanım Koşulları, Çerez Politikası ve Veri İşleme Sözleşmesi özeti. Metinler şablon değil:
  uygulamanın gerçekten işlediği veriler, kullandığı iki çerez ve veri aktardığı tedarikçiler koddan çıkarılarak yazıldı;
  sürüm ve güncelleme tarihi taşır. Veri sorumlusunun kimliği ortam değişkenlerinden okunur (`LEGAL_*`); eksikse sayfa
  "yayına hazır değil" uyarısı gösterir ve metne yer tutucu koyar — uydurulmaz.
- **Veri sorumlusu bilgileri** (**Ayarlar** → Yasal bilgiler; yalnızca işletme sahibi): ticaret unvanı, adres, MERSİS,
  VERBİS, başvuru e-postası ve işletmenin kendi aydınlatma metni adresi. Bu bilgiler müşteriye açık kayıt formunda
  gösterilir: veri toplanmadan önce veri sorumlusunun kimliği, işleme amacı ve başvuru adresi görünür. Eksikse formda
  "bu işletme aydınlatma bilgilerini henüz tamamlamadı" uyarısı çıkar.
  **Rol dağılımı:** panele giren kişilerin verisi için veri sorumlusu Circular, mekanın müşterileri için ilgili işletmedir;
  Circular bu veriler bakımından veri işleyendir.
- **Ekip yönetimi** (soldaki **Ayarlar**; yalnızca işletme sahibi): ekip üyelerini davet eder, rollerini ve mekan
  erişimlerini değiştirir, erişimlerini kapatıp açarsınız. **Davet e-posta göndermez:** tek kullanımlık bir bağlantı
  üretilir, siz iletirsiniz. Kişi bağlantıyı açıp kendi şifresini belirler (en az 10 karakter); o e-postayla zaten hesabı
  varsa mevcut şifresiyle katılır, yani bağlantı tek başına erişim vermez. Bağlantının ham kodu veritabanında saklanmaz
  (yalnızca SHA-256 özeti), 7 gün geçerlidir, bir kez kullanılır ve yalnızca üretildiği anda gösterilir; aynı kişiye yeni
  davet üretilince eskisi geçersiz olur. Kilitlenme koruması: işletmede her zaman en az bir aktif sahip kalır, kimse kendi
  rolünü değiştiremez veya kendi erişimini kapatamaz. Erişim kapatılınca kişinin açık oturumları da düşer. Her işlem
  aktivite geçmişine yazılır.
- **Raporlar** (soldaki **Raporlar** → `/reports`; işletme sahibi ve CRM yöneticisi): 7/30/90 günlük hazır dönem veya
  **özel tarih aralığı** (en fazla bir yıl; bitiş bugünden ileri olamaz), seçili mekana göre. Karşılaştırma her zaman
  hemen öncesindeki aynı uzunluktaki dönemle yapılır. **CSV indirme**: özet, günlük seriler, etkinlikler, PR katkısı,
  saat/gün dağılımı, kaynaklar, avantajlar ve kampanya sonuçları ayrı ayrı indirilir (noktalı virgül ayraç ve UTF-8 BOM ile
  Türkçe Excel'de doğru açılır; oranlar tam sayı yüzde). İndirme ekrandaki dönemi ve mekan kapsamını aynen taşır, yetki
  yeniden kontrol edilir.
  Kapıdan giren kişi, yeni müşteri, etkinlik kaydı ve avantaj kullanımı için önceki dönemle karşılaştırma; günlük giriş eğrisi,
  saate ve haftanın gününe göre yoğunluk (Istanbul saatiyle), biten etkinliklerde davetli → gerçek giriş oranı, PR katkısı,
  yeni müşteri kaynağı ve guest kanalı dağılımı, iletişim izni ve avantaj kullanımı, kanal bazında kampanya sonuçları.
  Grafikler harici kütüphane olmadan SVG ile çizilir. Ölçülmeyenler (menü görüntüleme, ciro, kampanya dönüşümü) tahmin edilmez.
- İki izole demo işletme, 8 demo kullanıcı, demo check-in ve avantaj kullanımları

### Sonraki fazlara kalanlar
PR davet linki tıklama ölçümü · public üyelik/etkinlik sayfaları · WhatsApp için İYS entegratör bağlantısı ·
zamanlanmış/otomatik kampanyalar · WhatsApp Club · rapor dışa aktarma ·
ekip/mekan yönetimi · platform konsolu.
Ayrıntılar ve açık kararlar: [docs/ROADMAP.md](docs/ROADMAP.md).

### Bilinen eksikler
- Ayarlarda mekan ekleme/düzenleme yok (işletme ve mekan bilgileri salt okunur; ekip yönetimi yapılabilir).
- Şifre sıfırlama ve e-posta doğrulama yok.
- Giriş hız sınırlayıcısı bellek içidir; tek süreçli dağıtım içindir.
- Etkinlik guest listesi sayfalanmıyor (yüzlerce kayıt için uygun, binlerce için sayfalama gerekir).
- QR bağlantısı müşteriye elle iletilir; otomatik WhatsApp/SMS gönderimi kampanya modülüyle gelecek.
- Panel içinde kamera ile tarama yok; telefonun kamera uygulaması kullanılır (iOS'ta tarayıcı içi tarama yaygın desteklenmiyor).
- Toplu QR üretme ve dışa aktarma yok; QR yalnızca "kodu yenile" ile iptal edilebiliyor (salt iptal seçeneği yok).
- `/q` ve `/pass` için istek hız sınırı yok (token 192 bit olduğundan deneme yanılma pratikte imkansız).
- QR kodlayıcı bayt modu / seviye M / sürüm 1–10 ile sınırlı (bağlantılar için fazlasıyla yeterli).
- Menü görselleri (JPEG/PNG, kırpılmış hâli) dosya depolama altyapısı olmadığı için **veritabanında** saklanır ve
  `/media/menu/[id]` üzerinden yalnızca oturumdaki işletmeye servis edilir. Sunucu biçimi ve boyutu dosya başlığından
  doğrular (tam görsel çözümlemesi yapmaz). Çok sayıda/yüksek hacimli görselde nesne depolamaya taşınmalıdır.
  Yüklenip kaydedilmeyen görseller 24 saat sonra bir sonraki yüklemede temizlenir.
- Menüde taslak/yayın ayrımı yok: kaydedilen tasarım ve ürün değişikliği açık menüde hemen görünür. Menü QR'ı panelden
  üretilmiyor (açık menü adresi kopyalanıp kullanılır). Menü işletme düzeyindedir, mekan bazlı ayrı menü yok.
  Ürünler sayısal "sıra" alanıyla sıralanır (sürükle-bırak yok). Ürün fiyatı `Float` olarak saklanır.
- Menüden kayıtta **telefon doğrulaması (SMS/OTP) yok**: yeni bir kişi başkasının numarasıyla kayıt olabilir. Mevcut
  kayıtlara dokunulmaz, ama doğrulanmamış yeni kayıtlardaki izinler kampanya gönderimi başlamadan önce doğrulanmalıdır.
  Hız sınırı bellek içidir. Aydınlatma metninin içeriği işletmenin sorumluluğundadır (panelde yalnızca adresi girilir).
  Popup gösterim/tıklama sayısı ölçülmez; yalnızca gerçekleşen kayıtlar CRM'de görünür. İşletme başına tek popup vardır.
- PR tarafında: PR davet etme ve etkinliğe atama arayüzü yok (PR, mekan kapsamındaki tüm yayındaki etkinliklere misafir
  ekleyebilir; `EventPrAssignment` henüz kullanılmıyor). Davet linkinin açılma/tıklama sayısı ölçülmez; yalnızca
  gerçekleşen kayıtlar sayılır. Davet linkinde telefon doğrulaması (SMS/OTP) yok ve hız sınırı bellek içidir. Yönetim
  bir PR'ın linkini ayrıca kapatamaz (PR'ın üyeliği pasifleşince link çalışmaz). PR kendi eklediği misafiri
  iptal edemez (yönetim etkinlik sayfasından iptal eder). PR adına eklenen misafirin atıfı ilk eklemede sabitlenir;
  yalnızca yönetim iptal edilmiş kaydı yeniden eklerken kaynağı/PR'ı yeniden seçebilir.
- WhatsApp kampanyaları: Circular'ın Meta uygulaması (işletme doğrulaması, uygulama incelemesi, Tech Provider) ve mesaj
  ücretini Circular'ın ödeyebilmesi için bir Meta Solution Partner kredi hattı henüz kurulmadı; bu yüzden gerçek
  numara bağlama ve gönderim canlı Meta hesabıyla denenmedi (Meta API'si testlerde taklit edildi). İYS entegratörü
  bağlı değil: müşterilere gönderim kapalı, İYS'ye ret (RET) bildirimi de henüz gönderilmiyor. Webhook için internetten
  erişilebilir adres gerekir (localhost'a Meta ulaşamaz). Gönderim kuyruğu aynı sunucu sürecinde çalışır; sunucu yeniden
  başlarsa kampanya sayfasındaki "Gönderime devam et" ile sürdürülür, kalıcı arka plan işçisi yok. İşletme başına tek
  numara; zamanlanmış kampanya, görsel/düğmeli zengin şablon, gelen mesaj kutusu ve tıklama ölçümü yok. Ücret tahmini
  sabit bir Türkiye ücretine dayanır; gerçek tutar Meta/çözüm ortağı faturasındadır.
- SMS: gerçek Netgsm hesabıyla denenmedi (Netgsm API'si testlerde taklit edildi). İşletme başına tek Netgsm hesabı/başlık;
  bayi alt hesap açılışı ve kredi yükleme Netgsm panelinden yapılır. Teslim raporu elle güncellenir (otomatik sorgu yok).
  0800 ret hattına gelen retler İYS'ye Netgsm tarafından işlenir ama Circular'daki SMS izni otomatik güncellenmez. Yurt dışı
  numaralara SMS gönderilmez.
- E-posta: gerçek Brevo hesabıyla denenmedi (API testlerde taklit edildi); Circular'ın alan adında SPF/DKIM/DMARC kurulumu
  ve Brevo gönderici doğrulaması gerekir. Açılma sayısı yaklaşıktır. Görsel yükleme ve şablon kütüphanesi yok.
- Instagram: gerçek hesapla denenmedi; Meta uygulama incelemesi (`instagram_business_manage_messages`) gerekir. Yalnızca
  DM metin yanıtı var: yorumdan DM'e, hikâye yanıtı ve karşılama mesajı otomasyonları yok; gelen mesaj kutusu tutulmaz.
- PR talimatları yalnızca panel içinde görünür: SMS/WhatsApp/e-posta bildirimi yok, PR portalı açılınca görülür.
  Talimat düzenleme, PR'ın yanıt/not yazması ve zamanlanmış talimat yok. PR hesabı panelden oluşturulamaz
  (ekip yönetimi hazırlanıyor).
- Müşteri kalıcı silme/anonimleştirme (KVKK talebi) ve CSV içe/dışa aktarma yok.
- Otomatik uçtan uca (tarayıcı) testleri yok; servis katmanı testleri ve elle tarayıcı doğrulaması yapıldı.
- E-posta: kalıcı teslim hatasında (hard bounce, geçersiz adres, engellenmiş) adresin e-posta izni otomatik kaldırılır;
  geçici hatalarda (`error`) kaldırılmaz.
