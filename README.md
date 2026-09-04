# Dot Claim

Renkli noktaları bağlayarak üçgen bölgeleri sahiplenmeye dayalı, iOS ve Android için Expo/React Native strateji oyunu. Video kaynağındaki fiziksel oyun akışına göre tasarlandı: oyuncular sırayla iki noktayı bağlar; üç kenarı tamamlanan üçgeni o hamleyi yapan oyuncu kazanır.

## Başlatma

```bash
npm install
npx expo start
```

Expo açıldıktan sonra iOS Simulator, Android emulator veya Expo Go ile açabilirsiniz.

## Çevrimiçi iki kişilik oyun

Oyuncular `Çevrimiçi rakip ara` düğmesinden aynı zorlukta eşleşir. Sunucu, her hamleyi doğrular; bu nedenle istemciler skor, sıra veya tahta durumunu değiştiremez.

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

## Yayına hazırlık

Bu kaynak kod üretime hazır bir Expo uygulamasıdır; mağazaya gönderim, uygulama sahibinin Apple/Google geliştirici hesapları ve imzalama yetkileriyle yapılır.

1. `app.json` içindeki `ios.bundleIdentifier` ve `android.package` değerlerini size ait, benzersiz kimliklerle değiştirin. Örn. `com.studyo.dotclaim`.
2. App Store için 1024×1024 mağaza görseli, ekran görüntüleri, gizlilik politikası URL'si ve App Store Connect kaydı oluşturun.
3. Google Play için mağaza kaydı, içerik derecelendirmesi ve gizlilik formunu tamamlayın.
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
- Çevrimdışı oynanış; hesap, reklam, analitik ve ağ isteği yoktur.
- AsyncStorage ile cihaz üzerinde ilerleme kaydı.
- Dokunsal geri bildirim seçeneği, erişilebilir dokunma etiketleri ve hata sınırı.
- Yerleşik, telifsiz nokta seçme, bağlama, üçgen kapatma, rakip, hata, zafer ve yenilgi ses efektleri.
- Gerçek zamanlı iki oyunculu eşleştirme, sunucu tarafında hamle doğrulama ve rakip ayrılma/bağlantı durumları.
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
server/index.mjs         Socket.IO eşleştirme ve oyun doğrulama sunucusu
assets/icon.png          Uygulama simgesi ve açılış görseli
app.json                 Expo / iOS / Android yapılandırması
eas.json                 EAS derleme profilleri
```

## Simge notu

`assets/icon.png`, proje için yerleşik görsel üretimle oluşturulan özgün simgedir. Üretim istemi: “Noktaları ve üçgensel alanları ince çizgilerle birleştiren, koyu lacivert zeminde modern strateji bulmacası uygulama simgesi; yazı, logo ve filigran yok.” Mağazaya çıkmadan önce marka ve ekran görüntüsü çalışmalarınızla birlikte son hukuki/marka kontrolünü yapın.
