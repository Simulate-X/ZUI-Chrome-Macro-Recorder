# Koordinat Sistemi

## 1. Problem

Masaüstü mutlak koordinatı, Chrome penceresinin konumu veya boyutu değiştiğinde bozulur. Yalnız sekme içi sabit piksel de oyun alanı ölçeklendiğinde aynı mantıksal noktayı korumaz. Bu nedenle mouse eventleri hedef oyun/canvas yüzeyine göre normalize edilir.

Bu yöntem **aynı görsel düzenin ölçeklenmesine** dayanıklıdır; arayüzün yeniden yerleşmesine otomatik çözüm değildir.

## 2. Kanonik koordinat uzayı

İlk tasarımda kanonik uzay:

```text
target element content/view rectangle içindeki normalize CSS viewport koordinatı
```

Kayıt:

```text
rect = target.getBoundingClientRect()
localX = event.clientX - rect.left
localY = event.clientY - rect.top
xNorm = localX / rect.width
yNorm = localY / rect.height
```

Playback:

```text
rect = target.getBoundingClientRect()
clientX = rect.left + xNorm * rect.width
clientY = rect.top  + yNorm * rect.height
```

`clientX/clientY` ile `getBoundingClientRect()` aynı CSS viewport koordinat uzayındadır; sayfa scroll offset'i ayrıca eklenmez. Kalıcı formatta birincil değer `xNorm/yNorm` olur. Kayıt geometrisi yalnız teşhis ve sapma kontrolü içindir.

## 3. Hedef yüzeyin seçimi

Öncelik gerçek etkileşim yüzeyidir:

1. Oyun canvas'ı.
2. Canvas'ı saran ve eventleri alan kesin container.
3. Açıkça tanımlı oyun viewport'u.

“İlk bulunan canvas” güvenilir locator değildir. Sayfada birden fazla canvas, overlay, reklam veya dinamik yeniden yaratılan node olabilir. Locator stratejisi; stabil attribute, DOM yolu, boyut/aspect ipucu ve frame kimliğini birlikte değerlendirebilir. Playback öncesi locator tek ve görünür bir hedef çözmelidir; belirsizlik stop sebebidir.

## 4. CSS pikseli, backing store ve `devicePixelRatio`

Bir canvas için üç ölçü farklı olabilir:

- CSS görünür boyutu: `getBoundingClientRect().width/height`.
- Canvas backing store: `canvas.width/canvas.height`.
- Ekran yoğunluğu: `window.devicePixelRatio`.

Browser mouse/pointer eventlerinin `clientX/clientY` değerleri CSS pikselindedir. Bu yüzden normalize değer playback için doğrudan güncel bounding rect ile CSS pikseline çevrilir; `devicePixelRatio` ile körlemesine çarpılmaz.

Oyun kendi hit-test'inde backing store koordinatı kullanıyorsa genellikle browser eventini kendi ölçekler; bunun Huuge'da böyle olduğu varsayılmaz. Faz 1 hem DOM event alanlarını hem de uygulama tepkisini ölçer. `devicePixelRatio` tanısal metadata olarak kaydedilebilir.

## 5. CSS transform ve ölçekleme

`getBoundingClientRect()` transform sonrası eksen hizalı görünür kutuyu verir. Basit uniform `scale()` için normalize yaklaşım çoğu durumda yeterli olabilir. Ancak:

- rotation/skew,
- nested transforms,
- transform-origin,
- element ile gerçek hit surface arasındaki fark,
- border/padding,
- overlay katmanları

koordinatı bozabilir. Gerekirse `DOMMatrix` ile ters transform veya element-specific content-box düzeltmesi tasarlanır; bu, PoC kanıtı olmadan ilk sürüm varsayımı değildir.

## 6. Aspect ratio, letterbox ve re-layout

### Aynı layout'un ölçeklenmesi

Oyun alanı 660×350'den 1320×700'e aynı oranla büyürse `(xNorm, yNorm)` aynı mantıksal noktaya karşılık gelir.

### Letterboxing

Canvas/container siyah şeritleri de kapsıyorsa normalize koordinat “oynanabilir içerik” yerine dış kutuya göre hesaplanabilir. İç viewport ölçülebiliyorsa ayrı `active content rect` gerekir. Bunun varlığı Faz 1 ekran/geometri testiyle belirlenir.

### Re-layout

Butonların konumu breakpoint ile değişirse aynı oran farklı kontrolü vurabilir. Koruma seçenekleri:

- aspect-ratio ve boyut sapma eşiği,
- beklenen target geometry profili,
- event öncesi kullanıcı onayı/step mode,
- ileride görsel veya semantik anchor (ilk kapsam dışında).

İlk güvenli politika: eşik aşılırsa uyar/stop; sessiz devam etme.

## 7. iframe koordinatları

`clientX/clientY` her frame'in kendi viewport'una göredir.

- Kayıt ve DOM playback aynı frame agent içinde yapılırsa frame-local bounding rect kullanılabilir.
- Üst frame ile alt frame arasında koordinat taşınacaksa her iframe'in bounding rect offset'i zincir boyunca eklenmelidir.
- Cross-origin frame DOM'una üst frame'den erişilemez. İlgili origin izniyle o frame'e content script enjeksiyonu mümkün olabilir; değilse DOM yöntemi çalışmaz.
- CDP koordinatının hangi viewport/root frame uzayını beklediği gerçek tab üzerinde ölçülmelidir; varsayım yapılmaz.

Frame navigasyonu veya yeniden yaratılması locator'ı geçersiz kılabilir. Böyle durumda playback durmalı ve yeniden hazırlık istemelidir.

## 8. Hit testing ve dispatch

Hesaplanan nokta için şu kontroller önerilir:

- Değerler sonlu ve `[0,1]` içinde mi?
- Rect genişliği/yüksekliği pozitif mi?
- Hedef görünür ve viewport içinde mi?
- Noktada `elementFromPoint` sonucu hedef/izinli overlay zinciriyle uyumlu mu?
- Element başka bir katman tarafından engelleniyor mu?

Canvas/WebGL uygulamalarında DOM elementinin doğru olması uygulamanın eventi kabul edeceğini kanıtlamaz. `isTrusted`, pointer sequence, focus, button state ve oyun içi hit-test ayrıca doğrulanır.

## 9. Scroll ve zoom

- Sayfa scroll'u `client` koordinatları ve bounding rect içinde doğal olarak yansır; yine de hedef görünür değilse otomatik scroll varsayılmaz.
- Browser zoom CSS pixel/bounding rect ilişkisini değiştirebilir. Normalize model bunu kısmen absorbe edebilir, fakat DPR/zoom kombinasyonları test matrisine girer.
- Playback sırasında zoom veya resize değişirse event başına güncel rect okunmalıdır; tek seferlik cache güvenli değildir.

## 10. Geometri güvenlik kapıları

Event gönderilmeden önce:

1. Doğru tab/document/frame doğrulanır.
2. Locator tam bir hedef bulur.
3. Rect pozitif ve görünürdür.
4. Aspect ratio/boyut sapması politika sınırındadır.
5. Normalize değer geçerlidir.
6. Hesaplanan nokta viewport ve hedef yüzey içindedir.
7. Backend hazırdır.

Her kapı ayrı, kullanıcıya anlaşılır hata kodu üretmelidir.

## 11. Faz 1'de doğrulanacaklar

- Huuge etkileşim yüzeyi canvas mı, container mı, iframe içinde mi?
- Tek/çok canvas ve overlay yapısı.
- Resize, tam ekran, browser zoom ve farklı DPR altında eşleme.
- Letterbox veya re-layout davranışı.
- DOM sentetik event kabulü ve gerekli event sırası.
- CDP'nin koordinat uzayı ve input kabulü.
- Background tab'de input ve timer davranışı.

## 12. Endüstri referansı

Kullanıcı tarafından sağlanan gerçek BlueStacks export'unda mouse X/Y değerleri 0–100 normalize yüzde uzayı gibi davranmaktadır. Bu, çözünürlükten bağımsız koordinat kararımızı destekleyen pratik bir örnektir; dosya BlueStacks'in kesin referans yüzeyini açıklamadığı için canvas-relative olduğunu iddia etmiyoruz ve format uyumluluğu hedeflemiyoruz. ZUI'nin kanonik uzayı 0–1 aralığında, mümkünse gerçek canvas/game surface bounding rect'ine göredir.
