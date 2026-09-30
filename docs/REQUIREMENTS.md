# Gereksinimler

## Phase 5 hardening acceptance

Runtime fault'ları stable diagnostic code ve deterministik cleanup ile fail-closed olur. Local macro storage UI kapanması, extension reload ve Phase 4→5 in-place upgrade boyunca korunur. Bozuk satırlar valid satırları gizlemeden quarantine edilir. Import yalnız credential-free HTTP(S) origin kabul eder ve runtime/profile/account/session alanlarını reddeder. Same-origin iframe ve open Shadow DOM locator'ları portable'dır; cross-origin iframe traversal açıkça unsupported'dır. İzinler ve ölçülen kanıt [DIAGNOSTICS.md](DIAGNOSTICS.md) ile [PHASE_5_RESULTS.md](PHASE_5_RESULTS.md) içindedir.

## 1. Amaç ve başarı ölçütü

Eklenti, seçilmiş bir Chrome sekmesinde girişleri kaydedebilmeli, makroyu yerel JSON olarak düzenleyebilmeli ve Windows'un gerçek giriş aygıtlarını kontrol etmeden aynı hedefte oynatabilmelidir. Başarı, yalnızca event gönderilmiş olmasıyla değil, hedef uygulamanın beklenen ve gözlenebilir tepkisini vermesiyle değerlendirilir.

## 2. Fonksiyonel gereksinimler

### FR-01 — Hedef sekme

- Kullanıcı aktif sekmeyi açıkça hedef olarak seçer ve sabitler.
- Normal HTTP/HTTPS hedeflerde site erişimi yalnız `Select current tab` kullanıcı eylemi sırasında exact site için istenir; ret halinde target pinlenmez.
- Browser/extension/devtools/data/javascript/view-source/about ve açıkça tasarlanmamış `file:` URL'leri `UNSUPPORTED_TARGET_SCHEME` ile reddedilir.
- UI; hedef sekmenin başlığını, origin'ini ve `tabId` bilgisini anlaşılır şekilde gösterir.
- Kayıt ve playback yalnızca sabit hedefe yönelir.
- Hedef sekme kapanırsa, değişirse veya erişilemez hale gelirse aktif işlem güvenli biçimde `STOPPED` durumuna geçer.
- Aynı origin'de başka sekmeye sessizce geçiş yapılmaz.

### FR-02 — Kayıt ayarları

- Keyboard recording: açık/kapalı.
- Mouse recording: açık/kapalı.
- Varsayılan mouse modu: `clicks-only`.
- Opsiyonel mouse modu: `clicks-and-movement`.
- `MOUSE_MOVE` için örnekleme/sadeleştirme politikası bulunur; ham her hareketi sınırsız kaydetmek hedef değildir.
- Başlat, pause/resume ve stop kontrolleri sağlanır.

### FR-03 — Kaydedilen eventler

- `delay`
- `mouseDown`, `mouseUp`, `mouseWheel`
- Opsiyonel `mouseMove`
- `keyDown`, `keyUp`, gerektiğinde `text` / `ime`
- Event sırası deterministik olarak korunur.
- Zaman aralıkları açık `DELAY` eventlerine dönüştürülür; playback motoru duvar saati timestamp'lerine bağımlı olmaz.

### FR-04 — Makro editörü

- Event ekleme, düzenleme, silme ve yeniden sıralama.
- Alan bazlı doğrulama ve anlaşılır hata mesajları.
- JSON içe/dışa aktarma.
- Desteklenmeyen şema sürümünü sessizce değiştirmeme.
- Düzenleme sonrası makronun şema ve mantık doğrulamasından geçmesi.
- Delay, mouse, wheel ve keyboard eventleri türüne uygun detail formunda düzenlenir; canonical array sırası UI numaralandırmasının otoritesidir.
- Add, delete, duplicate ve move up/down işlemleri en az 50 adımlık undo/redo history'sine girer.
- Geçersiz satır Save, Export ve Replay'i fail-closed engeller; hata path/code/message ile satıra bağlanır.
- Aynı isimli import sessiz overwrite edilmez; görünür `(2)`, `(3)` adlandırmasıyla yeni ID oluşturulur.

### FR-05 — Playback

- Hız çarpanı (`speedMultiplier`).
- Tekrar sayısı; `0` değeri sonsuz döngü anlamına gelir.
- Döngüler arasında yapılandırılabilir delay.
- Play, pause/resume ve stop.
- Step-by-step: kullanıcı onayı başına tek event; `DELAY` davranışı UI'da açıkça gösterilir.
- Yapılandırılabilir `stopOnError`; ilk sürüm varsayılanı `true`.
- Hedef sekmenin kapanması, navigasyonla yetki dışına çıkması veya hedef alanın bulunamaması durumunda stop.
- Playback sırasında kayıt başlatılamaz; durum çakışmaları engellenir.

### FR-06 — Koordinatlar

- Mouse eventleri masaüstü veya Chrome pencere koordinatıyla değil hedef alan içindeki normalize oranla saklanır.
- Hedef alanın kimliği (`target locator`) ve kayıt anındaki geometri tanısal bilgi olarak saklanır.
- Playback'te hedef alan yeniden bulunur ve güncel `getBoundingClientRect()` değerinden koordinat hesaplanır.
- Varsayılan geçerli aralık `[0, 1]` olur; aralık dışı event doğrulama hatasıdır.
- Re-layout veya beklenmeyen aspect-ratio değişiminde sessizce tıklamak yerine politika uyarı ya da stop üretir.

### FR-07 — Hotkey'ler

- Kullanıcı play/pause/resume, stop, record/pause/resume, recording stop ve step komutlarının uygun kombinasyonlarını değiştirebilir.
- Çakışan, tarayıcı/işletim sistemi tarafından rezerve edilen veya uygulanamayan kombinasyonlar açıkça bildirilir.
- MV3 `commands` kısıtları ile sayfa-içi hotkey'lerin odak bağımlılığı ayrı gösterilir; uygulanamayan “global hotkey” garantisi verilmez.
- Acil stop her zaman UI üzerinden erişilebilir kalır.

### FR-08 — Yerel saklama

- Makrolar sürümlü JSON biçiminde yerel tutulur.
- Gizli bilgi, cookie, Authorization header veya sayfa içeriği makroya kaydedilmez.
- Saklama kotası aşımı kullanıcıya bildirilir; veri kaybı sessiz olmaz.
- İçe aktarılan JSON güvenilmeyen veri kabul edilir ve kullanılmadan önce doğrulanır.

### FR-09 — Profil bağımsız taşınabilirlik

- Bir Chrome profilinde export edilen makro, başka bir Chrome profilinde import edilebilir ve kullanıcı yeni hedefi sabitledikten sonra aynı kanonik modelle oynatılabilir.
- Makro dosyası profile ID, Gmail/account verisi, `tabId`, `windowId`, cookie, session token, Authorization değeri veya debugger session bilgisi içermez.
- Playback tek session olarak offscreen scheduler'da çalışır; pause/stop/error matching release cleanup yapar, unsafe step/from başlangıcını reddeder ve runtime progress/held state'i export etmez.
- Recorder, UI editor, importer/exporter ve playback aynı veri modelini kullanır; kayıpsız JSON round-trip zorunludur.
- Kullanıcı `delay`, event, koordinat, button ve key değerlerini standart bir metin editöründe elle değiştirebilir.
- Import, JSON Schema ve semantik kurallarla doğrulanır; desteklenmeyen major sürüm veya event sessizce atlanmaz.

## 3. Fonksiyonel olmayan gereksinimler

### NFR-01 — İzolasyon

Playback gerçek Windows mouse konumunu değiştirmez ve işletim sistemi seviyesinde keyboard girişi üretmez. Kullanıcı diğer uygulamalarla çalışabilmelidir; yine de Chrome/debugger ve background-tab davranışlarının sınırları PoC ile doğrulanır.

### NFR-02 — Güvenlik ve en az yetki

- Required broad host izni yasaktır. Geniş HTTP/HTTPS match pattern'leri yalnız optional capability olarak tanımlanır; grant kullanıcı seçimiyle site bazında alınır ve Settings üzerinden kaldırılabilir.
- `scripting` yalnız izin verilmiş ve açıkça seçilmiş target tab'da recorder runtime'ını kurmak için kullanılır; otomatik site taraması veya global injection yapılmaz.
- `debugger` izni Phase 1D-G'de native keyboard/text/select/wheel davranışı için gerekli olduğu kanıtlandığından istenir; playback öncesinde kullanıcıya event sınıfı, hedef sekme ve Chrome debugging uyarısı açıkça gösterilir.
- Hedef sabitleme, kayıt durumu ve playback durumu görünür olur.
- Eklenti `password`, password autocomplete, OTP ve token/secret adlandırmalı alanlarda pointer ve keyboard kaydını fail-closed atlar; popup'ta `SENSITIVE_INPUT_BLOCKED` uyarısı gösterir. Alan değeri, clipboard içeriği veya tuş içeriği loglanmaz.
- Makro, JavaScript kodu veya keyfi selector scripti çalıştıran bir format değildir.

### NFR-03 — Güvenilirlik

- Durum geçişleri deterministik olmalıdır.
- MV3 service worker'ın askıya alınması aktif playback zamanlamasını bozmamalıdır; zamanlama sahibinin hangi context olacağı Faz 1/4 tasarımında kanıtlanır.
- Background tab throttling, navigasyon, iframe değişimi ve hedef geometry sapması algılanabilir hata üretmelidir.
- Stop komutu planlanmış sonraki eventleri iptal eder.

### NFR-04 — Gözlemlenebilirlik

- Her çalıştırma için event index'i, durum geçişi ve güvenli hata kodu görülebilir olmalıdır.
- Loglar tuş içeriği veya hassas sayfa verisi sızdırmamalıdır.
- PoC sonuçları “gönderildi” ile “uygulama kabul etti” ayrımını korumalıdır.

### NFR-05 — Performans

- `MOUSE_MOVE` kayıtları sınırlanmalı ve UI'ı kilitlememelidir.
- Uzun makrolar için editör ve playback bellek sınırları test edilmelidir.
- Timing sapması ölçülür; özellikle background sekmede nominal delay ile fiili dispatch zamanı karşılaştırılır.

## 4. Kullanıcıya gösterilecek uyarılar

- “Playback yalnız seçili sekmeye gönderilir; hedef sekme ve oyun durumu doğru değilse istenmeyen işlem oluşabilir.”
- “Sonsuz döngü stop edilene kadar devam eder.”
- “Chrome debugger modu kullanılırsa Chrome görünür bir debugging uyarısı gösterebilir ve DevTools/başka debugger bağlantılarıyla çakışabilir.”
- “Arka plan sekmelerinde tarayıcı zamanlayıcıları yavaşlatabilir; doğruluk garanti edilmez.”
- “Canvas/WebGL oyunları sentetik DOM eventlerini reddedebilir; uyumluluk siteye göre değişir.”
- “Makroları yalnız güvendiğiniz kaynaklardan içe aktarın.”

## 5. Bilinen teknik riskler

- CSS transforms hedef kutu ile gerçek hit surface arasında fark yaratabilir.
- Letterboxing normalize noktayı oynanabilir içerik yerine dış kutuya bağlayabilir.
- Responsive re-layout aynı oransal noktayı farklı bir kontrole taşıyabilir.
- `devicePixelRatio`, browser zoom ve canvas backing-store/CSS boyutu karıştırılmamalıdır.
- Same-origin ve cross-origin iframe koordinat/izin modelleri farklıdır.
- Canvas/WebGL uygulaması sentetik DOM inputunu kabul etmeyebilir.
- Background/unfocused tab timer ve input davranışı throttle edilebilir.

## 6. Kapsam dışı

- İşletim sistemi genelinde makro kaydı/playback.
- Tarayıcı dışı uygulamalar.
- Güvenlik mekanizmalarını, CAPTCHA'yı veya erişim kontrollerini aşma.
- Sayfa içeriğini scraping ile toplama.
- Bulut senkronizasyonu ve çok kullanıcılı paylaşım (ilk yol haritasında yoktur).
- Huuge uyumluluğunu PoC öncesinde garanti etme.
