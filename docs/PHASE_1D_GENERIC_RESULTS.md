# Phase 1D-G — Genel Amaçlı Gerçek-Web Input Uyumluluğu

## Sonuç özeti

**Karar: C — karma input mimarisi seçildi.**

```text
OFFSCREEN_DOCUMENT scheduler
            |
            +-- pointer / mouse / canvas click-drag --> DOM_SYNTHETIC
            |
            +-- keyboard / text / select / wheel ----> CDP_INPUT
```

Normal günlük Chrome profili ve manuel yüklenmiş extension ile üç farklı gerçek-web sınıfı test edildi. Başarı, listener'ın event görmesine göre değil hedef UI state'inin gözlenebilir biçimde değişmesine göre değerlendirildi.

`DOM_SYNTHETIC`, standard checkbox, gerçek canvas çizimi ve React accordion davranışında `isTrusted=false` olmasına rağmen başarılı oldu. Aynı backend native text insertion, select keyboard navigation ve native wheel scroll üretmedi. Bu somut sınır üzerine `chrome.debugger` + CDP fallback PoC çalıştırıldı; text, select ve wheel senaryolarının her biri 3/3 geçti.

Huuge erişim blokajı [PHASE_1D_RESULTS.md](PHASE_1D_RESULTS.md) içinde tarihsel/site-specific kanıt olarak korunur. Genel ürün Phase 1 kapısı Huuge erişimine bağlı değildir.

## Ortam ve güvenlik sınırı

| Alan | Değer |
|---|---|
| Tarih | 2026-09-24 |
| Chrome | 153.0.8010.53 / UA 153.0.0.0 |
| Profil | Kullanıcının normal günlük profili; headless veya geçici profil değil |
| Extension | Manuel unpacked `ZUI Macro Recorder PoC 0.1.0` |
| Scheduler | `OFFSCREEN_DOCUMENT`; değiştirilmedi |
| DOM backend | `DOM_SYNTHETIC` |
| Güçlü fallback | `CDP_INPUT`, görünür `debugger` izniyle |

Hiçbir form submit edilmedi; mesaj, hesap değişikliği, satın alma, bahis, spin, claim veya geri döndürülemez işlem yapılmadı. Windows mouse/keyboard inputu kullanılmadı. Bütün davranışlar yalnız seçilmiş Chrome test sekmelerinde çalıştı.

## Test edilen gerçek-web hedefleri

| Sınıf | Hedef | Seçim nedeni |
|---|---|---|
| Standard DOM form/UI | `selenium.dev/selenium/web/dynamic.html` ve `web-form.html` | Resmi Selenium test sayfaları; button, checkbox, text input ve native select davranışı |
| Canvas / graphical surface | `szimek.github.io/signature_pad/` | Gerçek Canvas 2D çizim kütüphanesi; pointer stroke ve normalize koordinat testi |
| Modern framework | `mui.com/material-ui/react-accordion/` | React/MUI kontrollü accordion state'i ve uzun scroll yüzeyi |

## Standard DOM sonuçları

| Davranış | Backend | Tekrar | Gözlenebilir sonuç |
|---|---|---:|---|
| Reveal button | DOM synthetic | 1 | Gecikme sonrası gizli input görünür oldu |
| Checkbox toggle | DOM synthetic | 3 | `false → true → false → true`; 3/3 geçti |
| Input focus | DOM helper | 1 | `document.activeElement` hedef input oldu |
| `keydown` / `keyup` | DOM synthetic | 1 çift | Listener gördü; ikisi de `isTrusted=false` |
| Native text insertion | DOM synthetic | 1 | Kaldı: değer `"" → ""`; `beforeinput` ve `input` oluşmadı |
| Select ArrowDown | DOM synthetic | 1 | Kaldı: selected index `0 → 0` |
| Native scroll | DOM synthetic wheel | 1 | Kaldı: scroll state değişmedi |

Checkbox'ın sentetik `click` event'i `isTrusted=false` idi; tarayıcının checkbox default action'ı state'i değiştirdi ve bunun ürettiği `change` event'i Chrome tarafından `isTrusted=true` raporlandı. Kabul kararı bu listener ayrıntısına değil `checked` state değişimine dayanır.

## Canvas sonuçları

Başlangıç surface:

- CSS rect: `left=260.333`, `top=148.333`, `width=665.333`, `height=291.604`.
- Backing store: `997 × 438`.
- Viewport: `1186 × 722`.
- `devicePixelRatio=1.5`, CSS transform `none`, zoom `1`.
- Başlangıç snapshot hash'i: `39d33078`.

Üç normalize stroke:

| Tekrar | Normalize x aralığı | Normalize y merkezi | Snapshot hash |
|---:|---:|---:|---|
| 1 | `0.25 → 0.75` | `0.35` | `39d33078 → 1c5e3093` |
| 2 | `0.25 → 0.75` | `0.47` | `1c5e3093 → 14012062` |
| 3 | `0.25 → 0.75` | `0.59` | `14012062 → c26a0997` |

Bütün pointer/mouse eventleri `isTrusted=false` idi; üç stroke da gerçek canvas bitmap snapshot'ını değiştirdi.

Pencere `1200×850` seviyesinden `900×720` seviyesine küçültüldüğünde viewport `1186×722 → 886×592`, canvas offset'i `left/top 260.333/148.333 → 110.333/83.333` oldu. Surface boyutu aynı kaldı. Güncel rect üzerinden `x=0.25 → 0.75`, `y≈0.8` yeniden eşlendi ve hash `c26a0997 → 7ed01350` değişti. Böylece viewport değişiminden sonra normalize koordinatın güncel CSS-pixel rect'e yeniden map edilmesi gerçek canvas davranışıyla doğrulandı.

Canvas fingerprint ilk koşuda tekrarlı `getImageData()` nedeniyle Chrome performans uyarısı üretti. Ölçüm `toDataURL()` snapshot + deterministik hash'e çevrildi; regresyon testi kaynakta `getImageData`/`willReadFrequently` bulunmadığını doğrular.

## Modern framework sonuçları

MUI React controlled accordion `#panel1d-header` üzerinde:

| Tekrar | Önce | Sonra | Sonuç |
|---:|---|---|---|
| 1 | expanded | collapsed | Geçti |
| 2 | collapsed | expanded | Geçti |
| 3 | expanded | collapsed | Geçti |

Bütün pointer eventleri `isTrusted=false` idi. React/MUI state'i üç tekrarda da gerçekten değişti.

## Hidden-tab entegrasyon smoke

MUI hedef sekmesi inactive yapıldı ve her satırda `document.visibilityState === "hidden"`, `document.hidden === true` doğrulandı. `OFFSCREEN_DOCUMENT + DOM_SYNTHETIC` ile 100 ms cadence'te üç accordion click çalıştırıldı:

| Event | UI state | Arrived at | Önceki aralık |
|---:|---|---:|---:|
| 0 | collapsed → expanded | 1320.5 ms | — |
| 1 | expanded → collapsed | 1432.1 ms | 111.6 ms |
| 2 | collapsed → expanded | 1520.7 ms | 88.6 ms |

3/3 davranış geçti. Bu kısa entegrasyon smoke'udur; Phase 1C'nin 31-event 100/200/500 ms ağır timing matrisi yerine geçmez ve o kanonik sonucu değiştirmez.

## Keyboard ve text sınırı

DOM synthetic keyboard:

- Focus helper başarılıdır.
- `keydown` ve `keyup` dispatch edilir ve `isTrusted=false` olarak görülür.
- Native default action oluşmaz: text value değişmez, `beforeinput/input` oluşmaz, caret ilerlemez.
- Native select ArrowDown navigation oluşmaz.
- Sentetik wheel native scroll üretmez.

Bu nedenle DOM keyboard listener kabulü, typing veya navigation desteği sayılmamıştır.

## CDP fallback sonuçları

### Text insertion — 3/3

`Input.dispatchKeyEvent` ile aynı Selenium text input'unda:

| Tekrar | Gönderilen | Gözlenen value |
|---:|---|---|
| 1 | `a` | `a` |
| 2 | `b` | `ab` |
| 3 | `c` | `abc` |

Input üç adım boyunca focused kaldı. Başarı listener log'una değil gerçek `value` ve caret ilerlemesine dayanır.

### Select navigation — 3/3

ArrowDown ile selected index/value sırası `0 → 1/"1" → 2/"2" → 3/"3"` oldu.

### Wheel scroll — 3/3

`Input.dispatchMouseEvent(type="mouseWheel")`, allowlisted MUI sekmesinde güncel element CSS rect'inden türetilen `x=97.016`, `y=28.167` noktasına gönderildi. `scrollTop` sırası `0 → 300 → 600 → 900` oldu.

### Attach/detach ve fail-closed

- Her CDP komutu `withDebugger(... finally detach)` sınırındadır.
- DOM backend silinmedi; ortak adapter tablosunda `DOM_SYNTHETIC` ve `CDP_INPUT` ayrı tutulur.
- Normalize pozisyon güncel target rect üzerinden CSS pixel'e çevrilir; viewport dışı nokta `CDP_POINT_OUTSIDE_VIEWPORT` ile reddedilir.
- Gerçek target-close testinde `reason="target_closed"` gözlendi.
- Kapanış sonrası `sessions=[]` ve pinned target `null` doğrulandı.

## Final mimari karar

**Karma mimari seçildi:**

- Scheduler: `OFFSCREEN_DOCUMENT`.
- Pointer/mouse/click/drag/canvas: `DOM_SYNTHETIC` ana yol.
- Keyboard, native text insertion, native select navigation ve wheel scroll: `CDP_INPUT` ana yol.
- Backend event türüne göre önceden ve görünür biçimde seçilir; runtime hatasında sessiz fallback yapılmaz.
- CDP attach yalnız açıkça sabitlenmiş, allowlisted hedef sekmeye yapılır ve her işlem sonunda detach edilir.

Bu seçim DOM'un daha dar izinli ve gerçek web pointer davranışında başarılı olmasını korurken, native default action gerektiren sınıfları CDP'ye verir.

## İzin ve güvenlik UX'i

`debugger` güçlü ve kullanıcıya görünür bir izindir. Chrome debugging bildirimi gösterebilir; DevTools veya başka debugger bağlantılarıyla çakışabilir. Ürün UI'ı playback öncesinde hedef sekmeyi ve CDP kullanılacak event sınıflarını göstermeli, attach başarısızsa fail closed durmalı ve stop/error/tab-close sonrası detach doğrulamalıdır.

## Bilinen sınırlamalar

- CDP text PoC yalnız basit Latin `a/b/c`; Unicode, dead key, IME/composition ve clipboard paste ölçülmedi.
- Password alanları content katmanında fail closed engellenir.
- CDP keyboard/text hidden-tab davranışı bu turda ölçülmedi.
- Cross-origin iframe, shadow DOM, fullscreen, CSS transform ve farklı zoom/DPR matrisi site sınıfı bazında Phase 5'te genişletilmelidir.
- DOM synthetic wheel listener'a ulaşır fakat native scroll üretmez; wheel CDP'ye route edilmelidir.
- Site-specific anti-automation veya `isTrusted` politikaları genel geçer garanti değildir. Huuge ayrı compatibility hedefi olarak açık kalır.

## Regresyon doğrulamaları

| Kontrol | Sonuç |
|---|---|
| Unit: koordinat, şema, canvas hash, sonuç dayanıklılığı ve CDP adapter sözleşmesi | 10/10 geçti |
| Phase 1 yerel uçtan uca PoC | Geçti; resize, DOM mouse/keyboard, `isTrusted=false`, target-close fail-safe |
| Phase 1B regression | Geçti; foreground ve unfocused-visible 100/200/500 ms matrisi |
| Phase 1C fixture smoke | HTTP 200 ve target surface bulundu |
| Phase 1C hidden scheduler entegrasyonu | Generic gerçek-web hidden smoke 3/3; 111.6/88.6 ms aralıklar |
| Generic gerçek-web DOM matrix | Standard DOM, canvas ve React sonuçları kaydedildi |
| CDP fallback matrix | Text, select ve wheel 3/3; target-close fail-safe geçti |
| JavaScript syntax | Tüm `extension`, `tests` ve `demo` `.js`/`.mjs` dosyaları geçti |
| `git diff --check` | Geçti |

Phase 1C'nin günlük profil 31-event 100/200/500 ms ağır matrisi bu turda tekrar edilmedi; kanonik sonuç [PHASE_1C_RESULTS.md](PHASE_1C_RESULTS.md) içinde korunur. Bu turdaki gerçek-web hidden smoke, scheduler ile seçilen pointer backend'in entegrasyon regresyonudur.

## Gate sonucu

Genel amaçlı gerçek-web Phase 1 input kapısı kapandı. **Phase 2 Recorder'a başlanabilir**, ancak event capture/playback sözleşmesi karma backend routing'i baştan taşımalıdır. Phase 2 bu turda başlatılmadı.
