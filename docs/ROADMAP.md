# Circular — Yol haritası

Faz 1 işletme panelinin çekirdeğini kurdu. Aşağıdakiler bilinçli olarak sonraki fazlara bırakıldı.
Her maddede Faz 1'de hazırlanan veri ilişkisi ve açık kararlar belirtilmiştir.

## ✔ Güvenli QR, check-in ve personel ekranları — tamamlandı

Kişiye özel giriş ve avantaj QR'ları, kapı/garson doğrulama ekranları, gerçek check-in ve avantaj kullanımı
çalışır durumda (bkz. README › Güvenli QR). `features.checkIn` ve `features.perks` açık; no-show artık yalnızca
giriş kapanışından sonra ve giriş kaydı yoksa gösteriliyor.

Sonradan eklenenler: yanlış kaydedilen girişi geri alma (işletme sahibi; QR yeniden geçerli olur, denetim kaydı kalır),
kapıda giriş penceresini uzatma (kapı görevlisi; etkinlik bitişinden en fazla 12 saat sonrasına kadar) ve kapı
listesinin sınırına ulaşıldığında bunun ekranda bildirilmesi.

Bu modülde açık kalanlar:

- **QR'ı yenilemeden iptal etme**: şu an yalnızca "kodu yenile" var (eskisini iptal edip yenisini üretir); salt iptal yok.
- **Hız sınırı**: `/q` ve `/pass` için istek sınırı yok. Token 192 bit olduğundan deneme yanılma pratikte imkansız,
  ancak her hatalı istek veritabanına gidiyor (girişteki sınırlayıcının benzeri eklenebilir).
- **Toplu QR**: guest listesinin tamamı için tek seferde kod üretme ve dışa aktarma (PDF/CSV).
- **Dağıtım**: QR bağlantısının WhatsApp/SMS ile otomatik iletilmesi — kampanya modülüne bağlı.
- **Panel içi tarayıcı**: kamera ile tarama (BarcodeDetector) yalnızca bazı tarayıcılarda destekleniyor; telefon kamerası
  akışı tüm cihazlarda çalıştığı için önce o uygulandı.
- **Çevrimdışı kapı**: internet kesintisinde kuyruğa alıp sonra eşitleme.
- **Giriş açılışı**: başlangıçtan 6 saat önce açılması hâlâ sabit; kapanış artık etkinlik başına ayarlanabiliyor.

## Faz 2 — PR portalı

**Tamamlanan bölüm — PR misafir listesi ve performans:** `/events/[id]/guests` (yönetim + PR) ve PR portalı
(`/workspace`). PR yalnızca kendi getirdiği kayıtları görür ve ekler (`prMembershipId = ctx.membershipId`, composite FK);
ad/telefon maskeli, CRM'de kayıtlı kişinin adı gösterilmez. Durum ve kaynak kayıtlardan türetilir; "içeride" sayısı
kapıdaki gerçek girişlerden gelir, giriş penceresi kapanınca bekleyenler "gelmedi" sayılır. Aynı telefonla aynı etkinliğe
ikinci kayıt engellenir. PR kendi misafiri için mevcut güvenli giriş QR'ını alabilir.

**Tamamlanan bölüm — PR Yönetimi ve talimatlar:** `/pr` ekranı (ekip performansı + talimatlar), `PrTask` ve
`PrTaskRecipient` modelleri (composite FK). Duyuru, görev ve misafir hedefi talimatları; okundu/tamamlandı takibi;
hedef ilerlemesi gerçek kayıtlardan. PR talimatları portalında görür ve işaretler.

**Tamamlanan bölüm — PR kişisel davet linki:** `PrInviteLink { code, eventId, membershipId, revokedAt }` (composite FK).
PR etkinliğe özel link + QR oluşturur/yeniler; misafir `/davet/<kod>` üzerinden kendi kaydını yapar, kayıt
`channel = PR_REFERRAL` ve `prMembershipId` ile PR'a atfedilir, yeni kişiye giriş QR'ı açılır. Mevcut kaydın atfı
değişmez (ikinci kayıt engellenir); linkten kayıt iletişim izni oluşturmaz.

Bu bölümde açık kalanlar:

- Talimat bildirimi (SMS/WhatsApp/e-posta) — mesaj sağlayıcı entegrasyonuna bağlı; şu an yalnızca panel içi.
- PR hesabı daveti ve oluşturma (Ayarlar › ekip yönetimi), talimat düzenleme, PR yanıtı/notu, zamanlanmış talimat.
- PR davet/atama (`EventPrAssignment`) — şu an PR mekan kapsamındaki tüm yayındaki etkinlikleri görür.
- PR yalnızca atandığı etkinlikleri ve **kendi** guest kayıtlarını görür (servis katmanında `prMembershipId = ctx.membershipId` filtresi).
- Davet linki tıklama ölçümü (`ReferralClick` olay tablosu); tıklama, kayıt ve check-in ayrı olaylar, dönüşüm hunisi
  bu üçünden hesaplanır. Şu an yalnızca kayıt ve gerçek giriş sayılır.
- Davet linkinde telefon doğrulaması (SMS/OTP), paylaşılan (ör. Redis) hız sınırı, yönetimin PR linkini kapatması.
- **Açık karar — atama kuralı:** önerilen "ilk geçerli referral kaydı atfeder, sonradan değişmez; personel eklemesi atfı ezmez". Ürün sahibi onayı gerekir. Davet linki şimdilik bu kurala uyar (mevcut kaydın atfı değişmez).
- PR'ın eklediği guest `channel = PR`, müşteri kaynağı `PR_GUEST`; iletişim izni oluşturmaz (Faz 1'de test edildi).

## Faz 2 — Public üyelik ve etkinlik sayfaları

- `/v/[venueSlug]` markalı alan: başlık `"[Mekan] — Circular"` (`venueExperienceTitle`).
- Kayıt formu: CRM kaydı (varsa eşleştirme) + `VenueMembership` + kanal bazında **ayrı** onay kutuları (`ContactConsent.source = PUBLIC_SIGNUP`, `consentTextVersion`).
- Eşleştirme yalnızca aynı tenant içinde normalize telefon/e-posta ile; tenant'lar arası birleştirme yok.
- Etkinlik sayfasında kayıt penceresi (`registrationOpensAt/ClosesAt`) ve kapasite uygulanır.
- Kişinin kendi QR'larını ve tercihlerini gördüğü "üyelik alanım" (e-posta/SMS tek kullanımlık kod ile giriş — şifresiz).
- Bot koruması ve form hız sınırı gerekli.

## Faz 3 — QR Menü

**Tamamlanan bölüm — menü oluşturucu (panel içi):** `MenuConfig`, `MenuCategory`, `MenuItem`, `MenuAsset` modelleri,
tenant izolasyonlu Server Action'lar ve QR Menü ekranı (`/menu`): 6 şablonlu galeri (canlı küçük önizleme + geri al),
renk/tipografi/biçim/bölüm kişiselleştirmesi, logo–kapak–ürün fotoğrafı yükleme ve tarayıcıda kırpma, rozetler ve öne
çıkan ürünler. Şablon düzenleri yeni nesil dijital menülerde yaygın desenlerden türetildi (metin öncelikli liste,
fotoğraflı kart, fotoğraf ızgarası, büyük görselli editoryal, klasik bistro, gece/bar; sabit kategori sekmeleri,
öne çıkanlar bölümü, diyet rozetleri). Fiyat, ürün sahibinin talebiyle `Float` olarak saklanıyor — aşağıdaki
"kuruş cinsinden tam sayı" planından bilinçli sapma.

**Tamamlanan bölüm — müşteriye açık menü, kampanya popup'ı ve menüden kayıt:** `/m/[slug]` menüsü (yalnızca
kaydedilmiş ve görünür içerik), gecikmeli ve 24 saat hatırlanan kampanya popup'ı, `/m/[slug]/katil` kayıt sayfası.
Kayıt CRM'e `QR_MENU` kaynağıyla düşer; kanal kanal işaretsiz izinler `PUBLIC_SIGNUP` + `consentTextVersion` ile,
mekan üyeliği `QR_MENU` ile açılır; bağlı avantaj varsa yeni üyeye kişiye özel QR verilir. İletişim bilgisi zaten
kayıtlıysa hiçbir şey değişmez. Bal küpü alanı ve IP başına hız sınırı uygulanır.

Bu bölümde açık kalanlar:

- **Telefon doğrulaması (SMS/OTP):** yeni kayıtlarda izinlerin ve ikramın gerçekten numara sahibine ait olduğunu
  kanıtlamak için gerekli; kampanya gönderimi başlamadan önce şart.
- **Tercih merkezi:** kişinin izinden kendisinin vazgeçebileceği sayfa.
- **Ölçüm:** popup gösterim ve tıklama olayları (şu an yalnızca gerçekleşen kayıtlar sayılabilir).
- Taslak/yayın sürümü, panelden menü QR'ı üretimi, mekan bazlı menü, birden fazla kampanya.
- Sürükle-bırak sıralama, alerjen filtresi, çoklu dil, görsellerin nesne depolamaya taşınması, paylaşımlı hız sınırı.

- ~~`Menu`, `MenuCategory`, `MenuItem`~~, şablon (tamam) · taslak/yayın sürümü (açık).
- Menü görüntüleme ayrı olay (`MenuView`), ziyaret sayılmaz.
- `Perk` (avantaj): koşul, geçerlilik, kişi başı limit → `Pass(purpose = PERK_REDEMPTION)`.
- Özel alan adı: `VenueDomain { hostname, verifiedAt }` + DNS TXT doğrulaması. Alan adı altyapısının hazır olduğu varsayılmamalı.

## Faz 3 — Kampanya merkezi

**Tamamlanan bölüm — WhatsApp kampanya çekirdeği (Adım 1):** `WhatsAppAccount` (işletme başına tek numara, şifreli token),
`MessageTemplate` (Meta onaylı pazarlama şablonu, ret bilgisi + "Abonelikten çık" zorunlu), `Campaign`, `CampaignMessage`
(mesaj başına durum ve Meta ücret bilgisi), `MessagingTestRecipient`. Kitle: önerilen (gerçek girişlerden), toplu (izinli
herkes, etiket, etkinliğe gelenler), tek tek. Gönderim anında izin/arşiv/İYS yeniden kontrolü, imzalı webhook, ret yanıtıyla
izin kaldırma. Kararlar: her işletme kendi numarasını bağlar; mesaj ücretini Circular öder (kota yok, kullanım sayılır);
İYS'yi Circular yönetir; İYS entegratörü bağlanana kadar yalnızca test numaralarına gönderim; gönderim yetkisi işletme sahibi +
CRM yöneticisi, numara bağlama yalnızca işletme sahibi.

Adım 1'de açık kalanlar:

- **Meta (dış süreç):** Circular için Meta işletme doğrulaması, uygulama incelemesi (`whatsapp_business_management`,
  `whatsapp_business_messaging`), Tech Provider erişim doğrulaması. Circular'ın ödeyebilmesi için ya Solution Partner statüsü
  ya da bir Solution Partner ile Multi-Partner Solution (partnerin kredi hattı mekan hesaplarına paylaşılır). Kod iki yolda aynı.
- **İYS (Adım 2):** yetkili entegratör seçimi ve API bağlantısı (`src/modules/campaigns/iys.ts`): gönderim öncesi MESAJ onayı
  sorgusu, izin yükleme, ret bildirimlerinin 3 iş günü içinde İYS'ye iletilmesi.
- Kalıcı arka plan işçisi (şu an `after()` + "Gönderime devam et"), zamanlanmış kampanya, işletme başına birden çok numara.

**Tamamlanan bölüm — SMS, e-posta ve Instagram (Adım 3):** Kampanya tabloları çok kanallı (`Campaign.channel`,
SMS/e-posta içeriği, `CampaignMessage.toEmail/providerMessageId/openedAt/clickedAt`). `SmsAccount` (Netgsm, şifreli), İYS
kontrolü Netgsm'in `iysfilter=11` filtresiyle; `EmailSettings` + `EmailTestRecipient` (Brevo, Circular alan adı, imzalı
abonelikten çıkma + tek tıkla çıkış); `InstagramAccount`, `InstagramAutoReply`, `InstagramReplyLog` (DM anahtar kelime yanıtı).
Kararlar: SMS = Netgsm, e-posta = Brevo (Circular'ın alan adından, işletme adıyla), Instagram = yalnızca DM anahtar kelime yanıtı.

Açık kalanlar: gerçek sağlayıcı hesaplarıyla deneme; Netgsm teslim raporunun otomatik sorgulanması ve 0800 retlerinin
Circular iznine yansıması (Netgsm İYS API'si); Circular izinlerinin İYS'ye Netgsm İYS API'siyle yüklenmesi (WhatsApp'ın İYS
ihtiyacı için de aday); Instagram'da yorumdan DM'e, hikâye yanıtı ve karşılama otomasyonları; e-posta görsel yükleme.

Kalan adımlar: yapay zekâ kitle önerileri ve tetikleyicili otomatik kampanyalar (doğum günü, uzun süredir gelmeyen).

- Akış: hedef (etiket/kaynak/katılım segmenti) → içerik → önizleme → **onay** → gönder/planla → rapor.
- `Campaign`, `CampaignRecipient` (gönderim anındaki izin durumunun anlık görüntüsü), `MessageEvent`.
- Gönderim işçisi, her alıcı için izni ve opt-out'u **gönderim anında** yeniden kontrol eder.
- Sağlayıcı adapter arayüzü: `send()`, `capabilities()` → rapor ekranı yalnızca `capabilities` içindeki metrikleri gösterir (SMS için açılma oranı yok).
- Entegrasyon yoksa `DemoAdapter` — arayüzde "Demo gönderim, mesaj iletilmedi" etiketi zorunlu.
- İş kuyruğu gerekir (ör. Postgres tabanlı kuyruk); tek süreçte `setTimeout` kullanılmamalı.

## ✔ Raporlar — tamamlandı

`/reports`: 7/30/90 günlük dönem ve mekan kapsamıyla, yalnızca ölçülen veriler. Kapı girişleri (kişi), yeni müşteri, etkinlik
kaydı ve avantaj kullanımı önceki dönemle karşılaştırılır; günlük seri, saat/gün yoğunluğu (Istanbul), etkinlik bazında
davetli → gerçek giriş, PR katkısı, kazanım kaynağı, guest kanalı, izin durumu ve kanal bazında kampanya sonuçları.
Grafikler bağımlılıksız SVG.

Açık kalanlar: dışa aktarma (CSV/PDF), kampanya dönüşümü (kampanya sonrası ziyaret ilişkisi), menü görüntüleme ölçümü,
özel tarih aralığı ve rapor e-postası.

## Faz 3 — WhatsApp Club

- Topluluk/grup yönetimi ile birebir kampanya gönderimi **ayrı** yetenekler.
- Başlamadan önce resmi WhatsApp Business Platform imkanları doğrulanmalı; otomatik topluluk oluşturma veya üye ekleme desteği varsayılmamalı.

## ✔ AI Asistan (Circular Copilot) — ilk sürüm tamamlandı

`/assistant` ve her panel ekranının sağ altındaki yardımcı. Soru, tanımlı konularla eşleştirilir; cevap servis katmanı
**kullanıcının `ServiceContext`'i ile** çağrılarak üretilir, bu yüzden yetkisiz veriye erişilemez. Konular: dönem özeti,
giriş, yoğunluk, yeni müşteri ve kaynak, etkinlik ve PR performansı, kitle önerisi, izinler, kampanya sonuçları,
avantajlar, kanal durumu ve 12 başlıkta panel rehberi. Taslak mesaj üretir; gönderme aracı yoktur, onay insandadır.
Veri yoksa açıkça söyler, sayı uydurmaz.

Dil modeli bağlı (Groq, `GROQ_API_KEY`): serbest cümle anlama, konuşma bağlamı (son 6 tur) ve gündelik sohbet.
Modele giden veri sınırlıdır: soru metni ve cevabın toplu sayıları. Kişi adı/telefon/e-posta gönderilmez; kişi ve PR
konularında model hiç çağrılmaz ve bu cevaplar konuşma geçmişinden de ayıklanır. Modelin cümlesindeki her sayı panelin
hesapladığı değerlerle karşılaştırılır, uyuşmazsa cümle atılır. Anahtar yoksa asistan anahtar kelime moduyla çalışır.
Ölçülmeyen veriler (ciro, menü görüntüleme, kampanya dönüşümü) için ayrı bir cevap verilir; rakam üretilmez.

**İşlem yapabilir (agentic):** model, tanımlı araçları çağırır; araçlar mevcut servis fonksiyonlarını kullanıcının
`ServiceContext`'i ile çalıştırır, böylece yetki, doğrulama, işletme/mekan kapsamı ve aktivite kaydı değişmeden işler.
Araçlar: müşteri ekleme, etiket ekleme, iletişim izni kaydetme, etkinlik oluşturma, misafir ekleme ve (onay kutusuyla)
SMS/e-posta kampanyası gönderme. Silme ve arşivleme aracı bilerek yoktur. Eksik bilgide araç çağrılmaz, kullanıcıya sorulur.
Rol yetkisi olmayan araç modele hiç tanıtılmaz.

Açık kalanlar:
- Aktivite kaydında işlemin asistan üzerinden yapıldığının işaretlenmesi (şu an kullanıcı adına normal kayıt düşer).
- WhatsApp kampanyası gönderimi (Meta onaylı şablon seçimi gerekir; şimdilik kampanya ekranına yönlendirilir).
- Araç sonrası "geri al" kısayolu (şu an ilgili ekrandan yapılır).
- KVKK aydınlatma metni: işletmeye, sorularının dil modeli sağlayıcısına gittiğinin açıkça bildirilmesi.
- Konuşma geçmişinin kaydı (şimdilik yalnızca sekmede tutulur) ve asistan kullanımının denetim kaydı.
- Özel tarih aralığı ("15 Eylül – 30 Eylül") ve mekan adı geçen sorular ("Orbita Kulüp'te kaç kişi geldi?").

## Platform ve operasyon

- **Platform yöneticisi konsolu:** tenant listesi, askıya alma; müşteri verisine destek erişimi yalnızca süreli ve denetim kaydıyla.
- **Ekip yönetimi:** davet, rol değiştirme, üyelik devre dışı bırakma (Ayarlar şu an salt okunur).
- **Mekan yönetimi:** mekan ekleme/düzenleme, logo ve görseller (dosya depolama gerekir).
- **KVKK:** müşteri silme/anonimleştirme talebi (arşivden farklı), aktivite metadata'sındaki adların temizlenmesi, veri dışa aktarma.
- **Hız sınırı:** giriş sınırlayıcısı bellek içi; çok instance'lı dağıtımda Redis/DB tabanlı olmalı.
- **Postgres'e geçiş:** `provider = "postgresql"`, migration'ları yeniden üret; `@@index` ve composite FK'ler aynen çalışır. Etkinlik kapasite kontrolü için `SELECT ... FOR UPDATE` veya Serializable izolasyon korunmalı.
- **Oturum:** kayan süre uzatma, "tüm oturumlardan çık", 2FA (işletme sahibi için).
- İçe aktarma (CSV) ve mükerrer birleştirme ekranı (aynı tenant içinde, manuel onaylı).
