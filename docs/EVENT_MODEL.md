# Event Modeli

Dosya zarfı, import doğrulaması ve sürüm uyumluluğunun kanonik tanımı [MACRO_FORMAT.md](MACRO_FORMAT.md) belgesindedir. Bu belge event semantiğine odaklanır.

## 1. İlkeler

- Event listesi UI editor ve JSON için tek veri kaynağıdır.
- Yürütme sırası listedeki sıradır; `id` yalnız düzenleme kimliğidir.
- Zamanlama Jitbit benzeri açık `delay` eventleriyle ifade edilir.
- Mouse koordinatları hedef alan içindeki normalize CSS koordinatlarıdır.
- Format sayfa scripti veya keyfi JavaScript içermez.
- Runtime bilgileri (`tabId`, `windowId`, profile/debugger session ID) kalıcı makroya yazılmaz.
- Playback input tracker ve safe-boundary bilgileri runtime'a aittir; active index, held keys/buttons ve cleanup releases event modeline/export'a yazılmaz.
- Bilinmeyen event türü sessizce atlanmaz.

## 2. Ortak event alanları

```json
{
  "id": "event-uuid",
  "type": "delay",
  "enabled": true,
  "label": "Optional user note"
}
```

- `id`: Makro içinde benzersiz string.
- `type`: Desteklenen lower-camel-case event türü.
- `enabled`: `false` ise editörde kalır fakat playback atlar.
- `label`: Opsiyonel düz metin; yürütülmez.

## 3. Delay

```json
{
  "id": "e1",
  "type": "delay",
  "enabled": true,
  "durationMs": 750
}
```

`durationMs` sonlu ve negatif olmayan sayıdır. Playback hızı yalnız etkili süreyi `durationMs / speedMultiplier` olarak değiştirir; kaynak değer değişmez.

## 4. Mouse eventleri

Desteklenen türler:

- `mouseDown`
- `mouseUp`
- `mouseMove` — opsiyonel kayıt; movement modunda örneklenir/coalesce edilir
- `mouseWheel`

```json
{
  "id": "e2",
  "type": "mouseDown",
  "enabled": true,
  "position": {
    "space": "target-normalized",
    "x": 0.909091,
    "y": 0.914286
  },
  "button": "left",
  "buttons": 1,
  "modifiers": []
}
```

- `position.space`: version 1 için `target-normalized`.
- `position.x`, `position.y`: sonlu ve `[0,1]` aralığında.
- `button`: `left`, `middle`, `right`, `back`, `forward` veya move için `none`.
- `buttons`: DOM bitmask semantiği; event türüyle tutarlı olmalıdır.
- `modifiers`: benzersiz `Alt`, `Control`, `Meta`, `Shift` listesi.

`mouseWheel` aynı pozisyon yapısına ek olarak sonlu `deltaX`, `deltaY` ve DOM standardındaki `deltaMode` (`0=pixel`, `1=line`, `2=page`) değerini taşır. Delta birimleri playback adapter'ı tarafından açıkça dönüştürülür.

İlk sürümde bir fiziksel click'in kanonik temsili `mouseDown + delay + mouseUp` dizisidir. Ayrı `click` satırı üretilmez; böylece basılı tutma süresi düzenlenebilir ve aynı hareket iki kez oynatılmaz. Recorder varsayılanı clicks-only'dir; drag veya açıkça etkinleştirilen movement modu dışında `mouseMove` üretmez.

Faz 2 sampling politikası normal movement için en az `24 ms` ve `0.004` normalize mesafe koşullarını birlikte arar. Drag sırasında fidelity için daha sık eşik kullanılır: `12 ms` veya `0.01` normalize mesafe. `mouseDown` ve `mouseUp` hiçbir zaman coalesce edilmez.

## 5. Keyboard ve text/IME eventleri

```json
{
  "id": "e3",
  "type": "keyDown",
  "enabled": true,
  "key": "a",
  "code": "KeyA",
  "location": 0,
  "repeat": false,
  "modifiers": []
}
```

Desteklenen temel türler `keyDown` ve `keyUp` olur. `key`, `code`, `location`, `repeat` ve modifier alanları DOM semantiğini korur. Unicode metin, dead keys ve IME için gerektiğinde ayrı `text`/`ime` eventleri tanımlanabilir; aynı kullanıcı girişinin hem key hem text yolu ile iki kez üretilmesi engellenir.

DOM ve CDP backend'lerinin keyboard/text üretimi aynı değildir. Destek sınırı backend testleriyle ilan edilir. Parola alanı ve hassas input içeriği kaydedilmez.

## 6. Örnek event listesi

```json
[
  { "id": "e1", "type": "delay", "enabled": true, "durationMs": 500 },
  {
    "id": "e2",
    "type": "mouseDown",
    "enabled": true,
    "position": { "space": "target-normalized", "x": 0.5, "y": 0.5 },
    "button": "left",
    "buttons": 1,
    "modifiers": []
  },
  { "id": "e3", "type": "delay", "enabled": true, "durationMs": 120 },
  {
    "id": "e4",
    "type": "mouseUp",
    "enabled": true,
    "position": { "space": "target-normalized", "x": 0.5, "y": 0.5 },
    "button": "left",
    "buttons": 0,
    "modifiers": []
  }
]
```

## 7. Playback semantiği

- Disabled event atlanır ve kendisine ait olmayan komşu delay korunur.
- `repeatCount: 0` açıkça sonsuz döngüdür.
- Her loop tamamlandıktan sonra `loopDelayMs` uygulanır.
- Pause, kısmen tüketilmiş delay'in kalan süresini korur.
- Step mode tek event ilerletir; delay satırı da kullanıcıya görünür bir adımdır.
- `stopOnError: true` varsayılandır.
- Hedef tab kapanır/navigate olur, surface çözülemez veya geometri kapısı başarısız olursa fail-closed stop uygulanır.

## 8. Doğrulama özeti

- Event ID'leri benzersiz ve type'a uygun alanlar eksiksizdir.
- Tüm sayılar sonludur; delay/delta/geometri sınırları doğrulanır.
- Normalize koordinatlar `[0,1]` dışındaysa playback reddedilir.
- Mouse down/up button state tutarlılığı semantik uyarı veya hata üretir.
- Keyboard alanları desteklenen backend sözleşmesine uyar.
- Bilinmeyen event tipi, hatalı schema major veya gizli/runtime alan playback'e ulaşmaz.

Editor UI'daki `001`, `002` gibi sıra numaraları canonical array index'inin 1-based görünümüdür ve JSON'a metadata olarak yazılmaz. Duplicate deep clone üretir ve yeni benzersiz event ID atar; move işlemleri yalnız canonical `events` dizisinin sırasını değiştirir. Görsel click grouping uygulanmaz, `delay/mouseDown/delay/mouseUp` ayrı ve düzenlenebilir satırlar olarak kalır.

## 9. BlueStacks karşılaştırma notu

Gerçek `Test_BS_01.json` örneğinde mutlak `Timestamp` taşıyan `MouseDown`, `MouseUp`, `MouseMove`, `MouseWheel` ve `IME` eventleri görülmüştür. ZUI aynı temel input kapsamını hedefler fakat kaynak modelde mutlak timestamp yerine manuel düzenlenebilir açık `delay` satırlarını korur. Bu bir tasarım referansıdır; BlueStacks format uyumluluğu hedeflenmez.
