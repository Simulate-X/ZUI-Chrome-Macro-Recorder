# Faz 1 — Teknik Fizibilite ve PoC

## 1. Amaç

Bu fazın amacı ürün geliştirmek değil, kritik belirsizlikleri küçük ve ölçülebilir deneylerle kapatmaktır. Ana soru şudur:

> Genel amaçlı Chrome macro recorder, seçili sekmede Windows giriş aygıtlarını kontrol etmeden farklı gerçek-web etkileşim sınıflarını hangi backend ile güvenilir biçimde oynatabiliyor?

Hiçbir site veya event sınıfı PoC kanıtı olmadan “çalışır” kabul edilmez. Huuge site-specific compatibility hedefidir; genel ürün kapısının tek belirleyicisi değildir.

## 2. Güvenlik ve test sınırı

- PoC yalnız kullanıcının açıkça seçtiği hedef sekmede çalışır.
- Gerçek para, satın alma, claim, spin/bet veya geri döndürülemez eylem tetiklenmez.
- İlk deneyler mümkünse oyunun zararsız menü/ayar kontrollerinde veya ayrı bir yerel test fixture'ında yapılır.
- Kullanıcı hedefi ve backend'i çalıştırmadan önce görür.
- Debugger deneyi ayrı, açık izinle yapılır ve sonunda detach doğrulanır.
- Hassas keyboard verisi kaydedilmez; loglara ham tuş içeriği yazılmaz.

## 3. Araştırma soruları

### Hedef topolojisi

- Oyun top document'ta mı, iframe içinde mi?
- iframe aynı-origin mi, cross-origin mi?
- Etkileşim yüzeyi `canvas`, WebGL canvas, wrapper veya overlay mi?
- Canvas dinamik olarak yeniden yaratılıyor mu?
- Birden çok canvas/overlay var mı?

### Event kabulü

- Sentetik `MouseEvent`/`PointerEvent` hedef uygulamada gözlenebilir tepki üretiyor mu?
- `isTrusted === false` engel oluyor mu?
- Gerekli sıra `pointerdown -> mousedown -> pointerup -> mouseup -> click` benzeri bir zincir mi?
- Focus, pointer capture, `button/buttons`, modifiers veya hover önkoşulu var mı?
- Keyboard eventleri hangi element/focus durumunda kabul ediliyor?
- CDP Input aynı senaryolarda farklı sonuç veriyor mu?

### Koordinatlar

- `getBoundingClientRect()` gerçek oynanabilir alanı mı, letterbox dahil dış alanı mı gösteriyor?
- CSS size ile backing store size ilişkisi nedir?
- Resize/tam ekran/zoom/DPR değişiminde aynı normalized nokta aynı mantıksal kontrolü vuruyor mu?
- CDP mouse koordinatları top viewport mu, frame viewport mu bekliyor?

### Yaşam döngüsü ve timing

- Hedef sekme background olduğunda dispatch kabul ediliyor mu?
- Timer sapması ne kadar; Chrome throttling devreye giriyor mu?
- MV3 service worker suspend olduğunda oturum ve stop kontrolü nasıl korunuyor?
- Navigasyon, reload, tab close ve debugger detach nasıl algılanıyor?

## 4. PoC parçaları

### PoC-A — Yerel kontrollü fixture

Amaç: Browser event alanlarını ve coordinate dönüşümünü oyundan bağımsız doğrulamak.

Fixture şu gözlemleri sunar:

- Gelen event türü/sırası.
- `clientX/clientY`, button/buttons, modifiers, key/code.
- `isTrusted`.
- Canvas içindeki hesaplanan normalized nokta.
- Resize sonrası beklenen nokta.

Bu fixture Huuge uyumluluğunu kanıtlamaz; yalnız PoC aracının kendi doğruluğunu kanıtlar.

### PoC-B — Huuge salt gözlem/topoloji

Amaç: DOM/frame/canvas yapısını ve geometriyi herhangi bir otomasyon eylemi göndermeden belgelemek.

Çıktı:

- Origin ve frame ağacı (hassas veri olmadan).
- Aday surface locator'ları.
- Bounding rect, CSS size, backing store size, DPR.
- Overlay/letterbox/re-layout gözlemleri.
- Gerekli host permission listesi.

### PoC-C — DOM synthetic dispatch

Amaç: Content script yönteminin zararsız bir kontrol üzerinde kabul edilip edilmediğini test etmek.

Her testte kaydedilir:

- Test edilen event dizisi ve alanlar.
- Hesaplanan koordinat.
- Dispatch API'sinin başarı dönmesi.
- Uygulamanın gözlenebilir tepkisi.
- Sonuç: `ACCEPTED`, `DISPATCHED_BUT_NOT_ACCEPTED`, `BLOCKED`, `INCONCLUSIVE`.

`dispatchEvent()` dönüşü tek başına `ACCEPTED` değildir.

### PoC-D — CDP Input dispatch

Yalnız PoC-C yetersizse veya karşılaştırma gerekiyorsa çalıştırılır.

Amaç:

- `chrome.debugger` attach/detach akışını doğrulamak.
- `Input.dispatchMouseEvent` ve gerekli keyboard komutlarını aynı zararsız senaryoda denemek.
- Koordinat uzayını ve frame davranışını ölçmek.
- Chrome uyarısı, DevTools çakışması, background/focus etkisini kaydetmek.

Başarıdan sonra bile güçlü iznin ürün maliyeti ayrıca değerlendirilir.

### PoC-E — Resize ve timing matrisi

Seçilebilir backend(ler) şu koşullarda test edilir:

| Boyut | Zoom/DPR | Tab durumu | Beklenen |
|---|---|---|---|
| Kayıt boyutu | Varsayılan | Foreground | Baz çizgi |
| Daha küçük | Varsayılan | Foreground | Aynı normalized hedef |
| Daha büyük/tam ekran | Varsayılan | Foreground | Aynı normalized hedef veya belgeli re-layout |
| Baz boyut | Farklı zoom/DPR | Foreground | CSS koordinat dönüşümü doğrulanır |
| Baz boyut | Varsayılan | Background | Kabul ve timing drift ölçülür; garanti varsayılmaz |

## 5. Ölçüm ve kanıt standardı

Her deney kaydı şunları içerir:

- Chrome sürümü, işletim sistemi ve test tarihi.
- Hedef origin/frame/surface özeti.
- Backend ve izinler.
- Başlangıç geometri değerleri.
- Gönderilen eventin güvenli, redakte edilmiş özeti.
- Beklenen tepki ve gözlenen tepki.
- Timing: planlanan ve fiili dispatch zamanı.
- Sonuç etiketi ve varsa hata kodu.

Ekran görüntüsü/video yardımcı kanıttır; mümkünse uygulama state değişimi gibi ikinci sinyal kullanılır. Ağ trafiği, özel kullanıcı verisi veya secret loglanmaz.

## 6. Kabul kriterleri

Faz 1 “başarılı” sayılmak için:

1. Hedef surface ve frame modeli tekrar bulunabilir biçimde tanımlanmalı.
2. Standard DOM, canvas ve modern framework sınıflarında en az bir backend zararsız hedefte gözlenebilir doğru tepki üretmeli; site-specific açıklar ayrı sınıflandırılmalı.
3. Aynı normalized nokta en az iki farklı hedef boyutunda aynı mantıksal bölgeyi vurmalı veya re-layout sınırı açıkça tespit edilmeli.
4. Mouse event sırası, button state ve focus gereksinimi belirlenmeli.
5. Tab close/reload/navigation güvenli stop üretmeli.
6. Gerekli izinler ve kullanıcı uyarıları yazılı olmalı.
7. Background tab sonucu ve timing sapması ölçülmeli; ölçülmeyen durum destekleniyor sayılmamalı.

## 7. Backend karar matrisi

| Ölçüt | DOM synthetic | CDP Input |
|---|---:|---:|
| Generic gerçek-web gözlenebilir kabul | Pointer/mouse/canvas geçti | Native keyboard/text/select/wheel geçti |
| Mouse/canvas doğruluğu | Seçildi | Fallback adayı, bu turda gerekli değil |
| Keyboard/focus doğruluğu | Key listener geçti; native default action kaldı | Seçildi |
| Cross-origin frame uygunluğu | Ölçülecek | Ölçülecek |
| Background tab davranışı | Ölçülecek | Ölçülecek |
| İzin/güven maliyeti | Daha düşük hipotezi | Daha yüksek, `debugger` |
| Operasyonel karmaşıklık | Daha düşük hipotezi | Attach/detach ve çakışma |

Karar sırası:

1. Çalışmayan backend elenir.
2. İkisi de çalışırsa en az yetkili ve en öngörülebilir olan seçilir.
3. Biri yalnız bazı eventlerde çalışırsa hibrit yaklaşımın karmaşıklığı açıkça değerlendirilir; kendiliğinden kabul edilmez.
4. Hiçbiri güvenilir değilse proje bu hedef için `NOT_FEASIBLE` veya yeni araştırma gerektiriyor olarak işaretlenir.

## 8. Faz 1 teslimatları

- Minimal, atılabilir PoC kodu (ürün mimarisi sayılmaz).
- Test fixture ve tekrarlanabilir senaryolar.
- Huuge topoloji/geometri raporu.
- DOM ve CDP sonuç matrisi.
- Playback backend karar kaydı veya açık bloke sonucu.
- Güncellenmiş izin/güvenlik listesi.
- Faz 2'ye aktarılacak kesin event ve locator sözleşmeleri.

Phase 1B foreground/unfocused-visible sonuçları için [PHASE_1B_RESULTS.md](PHASE_1B_RESULTS.md), günlük profil gerçek inactive/hidden-tab matrisi ve `OFFSCREEN_DOCUMENT` scheduler kararı için [PHASE_1C_RESULTS.md](PHASE_1C_RESULTS.md) belgesine bakın. İlk Huuge koşusunun çevre blokajı [PHASE_1D_RESULTS.md](PHASE_1D_RESULTS.md) içinde tarihsel kanıt olarak korunur. Genel amaçlı backend kapısını kapatan standard DOM, canvas, React, hidden-tab ve CDP sonuçları [PHASE_1D_GENERIC_RESULTS.md](PHASE_1D_GENERIC_RESULTS.md) içindedir.

## 9. Faz 1 kapsam dışı

- Tam recorder UI.
- Makro editörü.
- Sonsuz loop veya üretim hotkey sistemi.
- Geniş browser/site desteği.
- Gerçek para veya geri döndürülemez oyun eylemleriyle doğrulama.
