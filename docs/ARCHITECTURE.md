# Mimari

## Phase 5 lifecycle addendum

Service worker artık bounded/redacted diagnostics, bozuk library partition ve startup recovery sahibidir. Worker başında bulunan aktif playback mevcut offscreen owner üzerinden durdurulur; owner yoksa `OFFSCREEN_LOST` olur. Terminal offscreen close callback'i `sessionId` ile bağlıdır; eski koşunun gecikmiş cleanup'ı yeni scheduler'ı kapatamaz.

Playback target mesajları deterministik olarak frame 0'a gider. Top-frame content script portable same-origin `::frame::` yolunu çözer; recorder enable/disable `webNavigation` ile frame'leri enumerate eder. Open Shadow DOM `>>>` kullanır. Numeric frame/tab/window kimlikleri session-only kalır.

Release akışı production extension dosyalarını `dist/extension` altına kopyalar, `dist/package-audit.json` üretir ve opsiyonel olarak `release/` ZIP'i oluşturur. Test runner ve development-only Phase 1 scriptleri pakete girmez.

## 1. Tasarım ilkeleri

1. **Sekme izolasyonu:** Bütün işlemler kullanıcının açıkça sabitlediği `tabId` ve izin verilen origin ile bağlıdır.
2. **Gerçek giriş aygıtlarına dokunmama:** Windows mouse/keyboard otomasyonu kullanılmaz.
3. **Kanıta dayalı backend seçimi:** Generic gerçek-web Phase 1D-G sonucuna göre pointer/mouse için DOM, native keyboard/text/navigation/wheel için CDP kullanılır; site-specific uyumluluk ayrıca ölçülür.
4. **Sürümlemeli veri:** Makro formatı JSON ve `schemaVersion` ile taşınabilir olur.
5. **Fail closed:** Hedef, frame veya geometri belirsizse event başka yere gönderilmez.
6. **En az yetki ve görünür durum:** Güçlü izinler yalnız gerekirse kullanılır; hedef ve çalışma durumu kullanıcıya gösterilir.

## 2. Mantıksal bileşenler

| Bileşen | Sorumluluk | Not |
|---|---|---|
| Extension UI | Hedef seçimi, kayıt/playback kontrolleri, ayarlar, editör | Popup tek başına uzun işlem sahibi olmamalı; kapanabilir. Kalıcı panel/extension page seçimi sonraki tasarım kararıdır. |
| MV3 service worker | Sekme yaşam döngüsü, izinler, mesaj yönlendirme, komutlar | Askıya alınabilir; hassas playback zamanlamasının tek sahibi olduğu varsayılmaz. |
| Content script / frame agent | DOM kaydı, hedef bulma, geometry ölçümü, aday DOM dispatch | Frame erişimi ve origin izinlerine tabidir. |
| Recorder engine | Ham browser eventlerini filtreler ve `DELAY + event` akışına çevirir | Clicks-only ve movement sampling uygular. |
| Macro validator/editor | Şema doğrulama ve güvenli manuel düzenleme | İçe aktarılan veri güvenilmeyen girdidir. |
| Playback coordinator | Durum makinesi, loop, hız, pause/stop/step ve hata politikası | Seçilen dispatch backend'inden bağımsız arayüz kullanır. |
| Dispatch backend | Event sınıfına göre `DOM_SYNTHETIC` veya `CDP_INPUT` ile input gönderir | Pointer/mouse DOM; native keyboard/text/select/wheel CDP. Otomatik/sessiz fallback yapılmaz. |
| Local repository | Makro ve kullanıcı ayarlarını yerel saklar | Kota, şema migrasyonu ve export ele alınır. |
| Diagnostics | Güvenli log, event index'i, timing ve hata kodları | Hassas key değerlerini loglamaz. |

Faz 2'de service worker recorder state machine'inin sahibidir ve seri hale getirilebilir oturumu `chrome.storage.session` içinde tutar. Content script yalnız seçilmiş hedefte güvenilir kullanıcı eventlerini, target-relative normalize pozisyonu ve aynı document clock'undan `performance.now()` değerini üretir. Popup yalnız komut/status görünümüdür; kapanması oturumu etkilemez. Tam lifecycle ve timing sözleşmesi [RECORDER.md](RECORDER.md) içindedir.

Faz 3 editor ayrı, kalıcı bir extension sayfasıdır. `state.macro` kanonik macro nesnesidir; Visual liste/detail, Raw JSON, import/export ve Preview Replay bu nesneyi okur veya atomik olarak değiştirir. Undo/redo en fazla 50 kanonik snapshot tutar; bunlar source-of-truth değil, geri alma geçmişidir. Save ve delete işlemleri service worker üzerinden tekrar validation ve aktif recorder/playback kapılarından geçer.

Faz 4'te `playback-core.js` input-state/safe-boundary sözleşmesinin saf çekirdeğidir. Offscreen document tek scheduler ve aktif engine sahibidir; service worker target/backend router ile `chrome.storage.session` public durumunu yönetir. Popup ve editor aynı session'a bağlanır. Başlangıçta immutable macro snapshot alınır; runtime index, held-state ve sonuçlar export'a girmez. Ayrıntılar [PLAYBACK.md](PLAYBACK.md) içindedir.

## 3. Hedef bağlama ve yaşam döngüsü

Hedef oturumu en az şu kimlikleri taşır:

```text
tabId + document/navigation identity + origin + frame path + target locator
```

`tabId` tek başına yeterli değildir; aynı sekme başka sayfaya navigate edebilir. Navigasyon sonrası content script yeniden bağlanmadan event gönderilmez. Origin izin dışına çıkarsa işlem durur. Hedef sekme kapanırsa service worker veya bağlantı kaybı sinyali playback'i `STOPPED` yapar ve bekleyen işler iptal edilir.

Frame path, aynı-origin frame zincirinde yeniden çözülebilir bir locator olabilir. Cross-origin iframe için üst document content script'inin iç DOM'a erişebileceği varsayılmaz; ilgili frame origin'i için ayrıca izin/content script veya CDP yaklaşımı gerekebilir. Faz 1 frame topolojisini ölçer.

## 4. Playback backend karşılaştırması

### A. Content script + sentetik DOM/Pointer eventleri

Örnek mekanizma: hedef noktadaki elementin bulunması ve `PointerEvent`, `MouseEvent`, `KeyboardEvent` dispatch edilmesi.

**Avantajlar**

- Daha dar izinlerle çalışabilir.
- Uygulaması ve tanılanması görece basittir.
- Windows giriş aygıtlarına dokunmaz.
- DOM hedefi ve normalize koordinat aynı context içinde hesaplanabilir.

**Riskler / sınırlar**

- Eventlerin `isTrusted` değeri `false` olur ve değiştirilemez.
- Oyun veya framework sentetik eventleri yok sayabilir.
- Browser'ın native focus, default action veya gerçek input pipeline davranışı tam taklit edilemeyebilir.
- Canvas/WebGL uygulaması doğru event sırası, pointer capture, button/buttons, modifiers veya focus bekleyebilir.
- Cross-origin iframe içine doğrudan erişim yoktur.

### B. `chrome.debugger` + Chrome DevTools Protocol Input

Örnek mekanizma: hedef tab'a debugger ile attach olup `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent` benzeri komutları göndermek.

**Avantajlar**

- Browser input pipeline'ına DOM `dispatchEvent` yönteminden daha yakın olabilir.
- Canvas/WebGL ve framework tabanlı uygulamalarda kabul edilme olasılığı daha yüksek olabilir; bu yalnız hipotezdir.
- Cross-origin frame senaryolarında koordinat bazlı dispatch bazı DOM erişim kısıtlarını aşmadan hedefe ulaşabilir.

**Riskler / maliyetler**

- Güçlü ve kullanıcıya açık `debugger` izni gerekir.
- Chrome debugging bildirimi gösterebilir.
- DevTools veya başka debugger bağlantılarıyla çakışma/detach yaşanabilir.
- Protokol sürümü, attach/detach ve sekme navigasyonu dikkatle yönetilmelidir.
- Background sekme, focus ve keyboard davranışı ayrıca test edilmelidir.
- Koordinat uzayı ve iframe offsetleri ölçülmeden doğru kabul edilemez.

### Phase 1D-G seçim kararı

Gerçek-web matrisi pointer/mouse/click/drag davranışında `DOM_SYNTHETIC` yöntemini; native text insertion, select keyboard navigation ve wheel scroll için `CDP_INPUT` yöntemini seçti. Backend event sınıfına göre deterministik route edilir. CDP izin/attach başarısızlığında olay DOM'a sessizce düşürülmez; playback fail closed durur. Ayrıntılı kanıt [PHASE_1D_GENERIC_RESULTS.md](PHASE_1D_GENERIC_RESULTS.md) içindedir.

## 5. Kayıt akışı

1. Kullanıcı hedef tab'ı ve oyun/canvas alanını seçer.
2. Frame agent hedef locator'ı ve geometriyi doğrular.
3. Recorder, etkin ayarlara göre browser eventlerini dinler.
4. Ardışık girişler arasındaki süre `DELAY` olarak eklenir.
5. Mouse koordinatı hedef alan içinde normalize edilir.
6. Eventler doğrulanır ve taslak makroya eklenir.
7. Stop sonrasında özet gösterilir; kayıt otomatik oynatılmaz.

Bir fiziksel click, kanonik olarak `mouseDown + delay + mouseUp` dizisine dönüştürülür. Ayrı bir `click` event'i üretilmez; böylece basılı tutma süresi düzenlenebilir ve aynı kullanıcı hareketi iki kez oynatılmaz. Faz 2 testleri bu dönüşümün deterministik olduğunu doğrular.

Recorder backend seçmez. Playback router `mouseDown/mouseUp/mouseMove` eventlerini `DOM_SYNTHETIC`, `keyDown/keyUp/mouseWheel` eventlerini `CDP_INPUT` adapter'ına yollar. Macro JSON içinde backend alanı structural ve semantic validation tarafından reddedilir.

## 6. Playback durum makinesi

```text
IDLE -> PREPARING -> PLAYING <-> PAUSED
                         |          |
                         +-> STOPPING -> STOPPED
                         +-> FAILED
PAUSED -> STEPPING -> PAUSED
```

- `PREPARING`: tab, document, frame, target, izin ve makro şeması doğrulanır.
- `PLAYING`: eventler sıra ile yürütülür.
- `PAUSED`: yeni event dispatch edilmez; kalan delay politikası korunur.
- `STEPPING`: tam bir event işlenir ve tekrar `PAUSED` olur.
- `STOPPING`: timer/queue iptal edilir, backend gerekiyorsa detach edilir.
- `FAILED`: hata kodu ve event index'i tutulur; `stopOnError` varsayılanı nedeniyle çalışma sonlanır.

Pause sırasında kısmen tüketilmiş `DELAY` için kalan sürenin korunması önerilir. Hız çarpanı delay'e `effectiveDelay = delayMs / speedMultiplier` olarak uygulanır; input event içeriğini değiştirmez.

## 7. Hotkey mimarisi

İki katman olabilir:

- MV3 `commands`: Chrome tarafından desteklenen sınırlı sayıda extension komutu; kullanıcı Chrome'un extension shortcuts sayfasından değiştirebilir.
- Sayfa-içi kısayollar: hedef content script dinler; yalnız hedef sayfa odaklıyken güvenilirdir ve kayıt edilen tuşlarla çakışabilir.

UI, her kısayolun kapsamını “Chrome komutu” veya “yalnız hedef sekme odaklı” şeklinde göstermelidir. Browser/OS tarafından rezerve edilen kombinasyonlar garanti edilmez. Stop için görünür UI kontrolü zorunludur.

## 8. Saklama ve sürümleme

- Küçük/orta makrolar için `chrome.storage.local` adaydır; gerçek kota ve performans uygulama aşamasında ölçülür.
- JSON export/import taşınabilirlik sağlar.
- `schemaVersion` major uyumsuzluğunda import reddedilir veya açık migrasyon istenir.
- Runtime'a özgü `tabId` kalıcı makro kimliği değildir; makro hedef origin/locator ipucu taşıyabilir fakat playback öncesi kullanıcı tekrar hedef sabitler.
- Chrome profile ID, Gmail/account verisi, `windowId`, cookie, session token ve debugger session bilgisi hiçbir export'a yazılmaz. Profil değişiminde yalnız JSON taşınır; hedef runtime binding yeni profilde yeniden kurulur.
- Recorder, editor, importer/exporter ve scheduler [MACRO_FORMAT.md](MACRO_FORMAT.md) içindeki aynı kanonik modeli kullanır.

## 9. Güvenlik modeli

- Üretim manifest'i geniş required host izni taşımaz. `http://*/*` ve `https://*/*` yalnız `optional_host_permissions` capability'sidir.
- Popup'taki açık kullanıcı eylemi URL'yi doğrular, exact site pattern'i için `permissions.contains/request` çalıştırır ve yalnız grant sonrasında hedef runtime'ını `chrome.scripting.executeScript` ile seçili tab/same-origin frame'lere idempotent olarak kurar.
- İzin Chrome profiline aittir; target pin session state'tir. Macro/export/backup izin veya runtime kimliği taşımaz.
- Same-origin reload/path navigation pin'i korur ve runtime'ı yeniden kurar. Cross-origin navigation işlemi durdurur, pin'i kaldırır ve yeni site için yeni seçim/izin gerektirir.
- `debugger` yalnız PoC gerekliliği doğrularsa ürün mimarisine alınır.
- Key eventleri hassas veri riski taşır; parola alanlarında kayıt engeli/uyarısı gerekir.
- Macro JSON'u komut verisidir; HTML'e güvenli metin olarak basılır, `eval` veya dinamik kod yürütme yapılmaz.
- Kullanıcı playback öncesi hedef tab, macro adı, repeat ve sonsuz döngü durumunu görür.
- Sekme/target uyuşmazlığında fail closed uygulanır.

## 10. Açık mimari karar kayıtları

| Karar | Durum | Kapanış kanıtı |
|---|---|---|
| Generic playback backend'i | Karar verildi: karma | Phase 1D-G gerçek-web DOM + canvas + React + CDP matrisi |
| Huuge/site-specific compatibility | Açık, genel ürünü bloke etmez | Site erişimi ve güvenli hedefle ayrı compatibility matrisi |
| Hedef alan locator stratejisi | Generic CSS selector + güncel rect kanıtlandı; site-specific açık | Phase 1D-G ve sonraki site matrisleri |
| Playback timer context'i | Karar verildi: `OFFSCREEN_DOCUMENT` | Phase 1C günlük profil gerçek hidden-tab 100/200/500 ms matrisi |
| Mouse click kanonik temsili | Karar verildi: down/delay/up | Faz 2 kayıt/playback regresyon testi |
| Keyboard focus modeli | Karar verildi: focus preflight + CDP input | Phase 1D-G Selenium text/select matrisi |
| Cross-origin iframe desteği | Unsupported/fail-closed | `CROSS_ORIGIN_FRAME_UNSUPPORTED`; top-level izin iframe origin'ine taşınmaz |

Phase 1D'nin 2026-09-23 tarihli ilk gerçek-target koşusu `BLOCKED_BY_ENV` ile sonuçlandı: iki Huuge Web Edition host'u da DNS ve TCP/443 aşamasını geçti, ancak TLS handshake sırasında bağlantıyı sıfırladı. Hedef uygulama yüklenmediği için bu sonuç DOM veya CDP backend'i hakkında negatif kanıt değildir. `debugger`/host izinleri genişletilmedi, scheduler kararı değişmedi ve input backend kararı açık kaldı. Ayrıntılar için [PHASE_1D_RESULTS.md](PHASE_1D_RESULTS.md) belgesine bakın.

Phase 1D-G daha sonra genel amaçlı ürün kapısını erişilebilir gerçek-web hedeflerinde kapattı ve `debugger` izninin native keyboard/text/select/wheel sınıfları için gerekli olduğunu pozitif davranışla kanıtladı. Huuge raporu tarihsel/site-specific kanıt olarak korunur; generic Phase 2 girişini bloke etmez.

## 11. Plan B — Chrome Extension + Local Native Helper

Phase 1C, normal günlük Chrome profilinde `OFFSCREEN_DOCUMENT` scheduler'ın gerçek inactive/hidden hedefte 100/200/500 ms timing matrisini geçtiğini doğruladı. Bu nedenle native helper timing için şu anda gerekli değildir. Aşağıdaki Plan B, gerçek target input kabulü veya ilerideki dayanıklılık testleri extension-only yaklaşımı yetersiz gösterirse kullanılacak koşullu alternatiftir:

- Extension hedef tab seçimi, izin UI'ı, macro yönetimi ve görünür stop/fail-closed kontrollerini taşır.
- Local native helper hassas scheduler sahibi olabilir.
- Helper Chrome/CDP transport'unu kontrollü ve yalnız seçilmiş target tab için yönetebilir.
- Extension-helper IPC açık oturum kimliği, allowlist origin ve iptal/timeout sözleşmesiyle sınırlandırılır.
- Helper Windows mouse imlecini hareket ettirmez ve Windows klavyesine input göndermez.
- Native messaging/CDP izinleri, paketleme, güncelleme ve kullanıcıya gösterilecek debugging uyarısı ayrı güvenlik incelemesi gerektirir.

Bu bölüm bir implementasyon kararı değildir. Native helper bu fazda yazılmadı; kullanıcıyla ayrıca karar verilmeden geliştirilmez.
