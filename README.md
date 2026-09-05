# Dot Claim

Renkli noktaları bağlayarak üçgen bölgeleri sahiplenmeye dayalı, iOS ve Android için Expo/React Native strateji oyunu. Video kaynağındaki fiziksel oyun akışına göre tasarlandı: oyuncular sırayla iki noktayı bağlar; üç kenarı tamamlanan üçgeni o hamleyi yapan oyuncu kazanır.

## Başlatma

```bash
npm install
npx expo start
```

Expo açıldıktan sonra iOS Simulator, Android emulator veya Expo Go ile açabilirsiniz.

## AdMob ödüllü reklamlar

Ödüllü reklamlar kullanıcının açık onayıyla gösterilir; reklam otomatik açılmaz. Uygulama aşağıdaki noktalarda teklif ekranını gösterir:

- Yeni tamamlanan her iki tek oyunculu bölümden sonra.
- Günlük meydan okuma sonucu ilk kez tamamlandığında, günde bir kez.
- Her tamamlanan çevrimiçi maçın sonunda.

Bu sürüm varsayılan olarak Google'ın test reklam birimini kullanır. Ayarlar ekranındaki **Ödüllü test reklamı** düğmesiyle akışı oyunu bitirmeden kontrol edebilirsiniz. Google Mobile Ads yerel bir SDK olduğu için Expo Go'da gerçek reklam açılmaz; iOS testinde özel geliştirme uygulaması gerekir:

```bash
npx eas build --platform ios --profile development
npx expo start --dev-client
```

`eas.json` geliştirme profili canlı maç sunucusunu ve test reklamlarını otomatik kullanır. Yayına geçmeden önce EAS ortam değişkenlerinde aşağıdakileri ayarlayın:

```text
EXPO_PUBLIC_ADMOB_USE_TEST_ADS=false
EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID=ca-app-pub-6927228148817615/6183846492
```

Gerçek altın, XP veya başka hesap değerleri reklam istemcisinden doğrudan eklenmemelidir. Önce AdMob'da Server Side Verification (SSV) çağrı adresini tanımlayıp sunucunun imzalı ödül isteğini doğrulamasını ekleyin. Ayrıca reklamlara geçmeden önce App Store Connect'teki gizlilik beyanı ve mağaza açıklamasındaki “reklamsız” ifadeleri güncelleyin. Android yayını yapmadan önce `app.json` içindeki test `androidAppId` değerini kendi Android AdMob uygulama kimliğinizle değiştirmelisiniz.

## Çevrimiçi iki kişilik oyun

Oyuncular `Çevrimiçi rakip ara` düğmesinden aynı zorlukta eşleşir. Sunucu, her hamleyi doğrular; bu nedenle istemciler skor, sıra veya tahta durumunu değiştiremez. Eşleşme kartında iki oyuncunun avatarı ve kullanıcı adı görünür.

Yerel iOS Simulator denemesi için iki terminal kullanın:

```bash
npm run server
npx expo start --ios
```

Gerçek cihazlar ve App Store/Google Play sürümleri için önce `server/index.mjs` dosyasını TLS destekli bir Node.js sunucusuna dağıtın. Sonra uygulama derlemesinden önce HTTPS adresini ortam değişkeni olarak tanımlayın:

```bash
EXPO_PUBLIC_MATCH_SERVER_URL=https://match.sizin-alanadiniz.com npx expo start
```

EAS üretim derlemesinde aynı değişkeni EAS Environment Variables üzerinden tanımlayın. `PORT` sunucu portunu, `ALLOWED_ORIGINS` ise virgülle ayrılmış izinli web istemci adreslerini ayarlar. Mobil uygulamalar için üretimde HTTPS/WSS kullanın; örnek `http://127.0.0.1:3001` yalnızca Simulator geliştirme ortamı içindir.

## Kalıcı profil, avatar ve ödüller

Evet, bu verileri kalıcı bir veritabanında tutmak gerekir. Sunucu, ek servis kurdurmadan kendi dizininde SQLite kullanır:

- `server/data/dot-claim.sqlite`: kullanıcı adı, kupa, altın, XP, lig, galibiyet/mağlubiyet ve maç geçmişi.
- `server/uploads/avatars/`: kullanıcıların yüklediği avatar görselleri.
- Uygulama ilk açılışta güvenli cihaz anahtarlığında saklanan anonim bir hesap oluşturur. Kullanıcı adı ve avatar daha sonra değiştirilebilir.
- Avatarlar telefon üzerinde 512×512 JPEG'e küçültülür; sunucu JPG/PNG/WebP doğrulaması yapar, 900 KB sınırı uygular ve yalnızca kendi avatar klasörüne yazar.
- Profil ekranındaki **Hesabımı sil** seçeneği kullanıcı adı, avatar, erişim anahtarları ve ilgili çevrimiçi maç kayıtlarını kalıcı olarak kaldırır.
- Maç bittiğinde sonuç sunucuda bir kez kayda alınır. Galibiyet: **+25 kupa, +50 altın, +100 XP**; beraberlik: **+8 kupa, +20 altın, +50 XP**; mağlubiyet: **-12 kupa, +20 XP**. Her üçüncü ardışık galibiyet ek **+30 altın** verir.
- Ligler kupa puanından hesaplanır: Bronz, Gümüş (300), Altın (650), Elmas (1000).

Bu anonim hesap tek cihaz içindir. Oyuncunun hesabını başka bir cihaza taşımasını istiyorsanız sonraki aşamada Sign in with Apple eklenmelidir.

### CloudPanel sunucusuna güncelleme

Mevcut `match.barkodgenerator.com` sunucusunda, proje dizininde sırayla çalıştırın:

```bash
cd ~/apps/dot-claim
git pull
npm ci
cp server/.env.example server/.env
nano server/.env
```

`server/.env` içindeki `PUBLIC_BASE_URL` değerini tam olarak aşağıdaki gibi bırakın:

```text
PUBLIC_BASE_URL=https://match.barkodgenerator.com
```

Sonra çalışan servisi yeniden başlatın:

```bash
pm2 restart dot-claim-match --update-env
pm2 save
curl -i https://match.barkodgenerator.com/health
```

Son komutun `200` ve `database: ready` dönmesi gerekir. CloudPanel tarafında mevcut ters vekil kuralı `127.0.0.1:3001` adresine yönlendirmeye devam etmelidir. `server/data/` ve `server/uploads/` klasörlerini Git'e eklemeyin; bunlar canlı oyuncu verileridir. Düzenli yedeklemede ikisini birlikte saklayın.

Gizlilik politikası ve destek sayfaları sunucu ile birlikte gelir:

- `https://match.barkodgenerator.com/privacy`
- `https://match.barkodgenerator.com/support`

## Yayına hazırlık

Bu kaynak kod üretime hazır bir Expo uygulamasıdır; mağazaya gönderim, uygulama sahibinin Apple/Google geliştirici hesapları ve imzalama yetkileriyle yapılır.

1. `app.json` içindeki `ios.bundleIdentifier` ve `android.package` değerlerini size ait, benzersiz kimliklerle değiştirin. Örn. `com.studyo.dotclaim`.
2. App Store için 1024×1024 mağaza görseli, ekran görüntüleri, gizlilik politikası URL'si ve App Store Connect kaydı oluşturun.
3. Google Play için mağaza kaydı, içerik derecelendirmesi ve gizlilik formunu tamamlayın. Gizlilik politikanızda kullanıcı adı, seçilen avatar, maç sonuçları ve oyun içi ilerlemenin eşleşme sunucusunda saklandığını belirtin.
4. Expo hesabınızla giriş yapıp üretim derlemelerini alın:

```bash
npx eas login
npx eas build --platform all --profile production
```

5. Üretilen derlemeleri TestFlight ve Google Play Internal Testing üzerinden gerçek cihazlarda test edin. Onaydan sonra EAS Submit veya mağaza panelleri aracılığıyla gönderin.

`eas.json` üretim derlemesinde sürüm numarasını otomatik artıracak şekilde yapılandırılmıştır.

## İçerik ve özellikler

- Tek oyunculu yerel yapay zekâ: rahat, dengeli ve usta zorluklar.
- 12+ açılabilir seviye, yıldız ve galibiyet ilerlemesi.
- Günlük, tarih tabanlı değişen tahta ve seri sayacı.
- Çevrimdışı tek oyunculu oynanış ve cihazdaki ilerleme kaydı.
- AsyncStorage ile cihaz üzerinde ilerleme kaydı.
- Dokunsal geri bildirim seçeneği, erişilebilir dokunma etiketleri ve hata sınırı.
- Yerleşik, telifsiz nokta seçme, bağlama, üçgen kapatma, rakip, hata, zafer ve yenilgi ses efektleri.
- Gerçek zamanlı iki oyunculu eşleştirme, sunucu tarafında hamle doğrulama, rakip ayrılma/bağlantı durumları, kullanıcı adı ve avatarlar.
- Kalıcı profil, kupa/altın/XP ödülleri, Bronz–Elmas ligleri, liderlik tablosu ve maç geçmişi.
- iOS ve Android için uygulama kimliği, simge, açılış ekranı ve EAS üretim profilleri.

## Proje yapısı

```text
App.tsx                  Uygulama ekranları ve oyun deneyimi
src/game/engine.ts       Kurallar, hamle geçerliliği, puan ve yapay zekâ
src/game/levels.ts       Tahta düzenleri ve zorluk ölçeklemesi
src/game/types.ts        Veri modelleri
src/components/GameBoard.tsx  Dokunulabilir oyun tahtası
src/storage.ts           Yerel ilerleme kaydı
src/components/OnlineMatchScreen.tsx  Çevrimiçi eşleştirme ve oyun ekranı
src/components/ProfileScreen.tsx  Avatar, profil, liderlik tablosu ve maç geçmişi
src/profile/              Kimlik, profil API'si ve veri modelleri
server/index.mjs         Socket.IO, profil/ödül API'si, SQLite ve avatar sunucusu
server/.env.example      Canlı sunucu ortam ayarları örneği
assets/icon.png          Uygulama simgesi ve açılış görseli
app.json                 Expo / iOS / Android yapılandırması
eas.json                 EAS derleme profilleri
```

## Simge notu

`assets/icon.png`, proje için yerleşik görsel üretimle oluşturulan özgün simgedir. Üretim istemi: “Noktaları ve üçgensel alanları ince çizgilerle birleştiren, koyu lacivert zeminde modern strateji bulmacası uygulama simgesi; yazı, logo ve filigran yok.” Mağazaya çıkmadan önce marka ve ekran görüntüsü çalışmalarınızla birlikte son hukuki/marka kontrolünü yapın.
