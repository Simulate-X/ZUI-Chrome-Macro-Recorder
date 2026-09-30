# Recorder Yaşam Döngüsü

## Sahiplik

Recorder oturumu popup'a bağlı değildir. MV3 service worker, `chrome.storage.session` içindeki `recorderSession` kaydının sahibidir. Runtime `tabId` yalnız bu geçici kayıtta bulunur; kanonik macro oluşturulurken atılır. Ayarlar `chrome.storage.local`, geçerli makrolar `zuiMacros` listesinde tutulur.

Durum makinesi:

```text
IDLE --START--> RECORDING --PAUSE--> PAUSED --RESUME--> RECORDING
                         \--STOP-----------------------> STOPPED
RECORDING/PAUSED --CANCEL--> IDLE
```

Aynı anda ikinci session başlatılmaz. Target kapanınca `target_closed`, origin değişince `target_navigated` sebebiyle fail-closed `STOPPED` üretilir. Başka sekmelerin inputu sender tab kontrolünde reddedilir.

## Timing ve explicit delay

Content script her kabul edilen input için aynı document clock'undan `performance.now()` timestamp'i gönderir. Service worker önceki kabul edilen input ile farkı hesaplar ve her input önüne explicit `delay` satırı koyar. Duvar saati yalnız popup duration göstergesi içindir.

Pause sırasında capture kapatılır. Resume cevabındaki yeni `performance.now()` değeri baseline olur; pause içinde geçen süre ve inputlar macro'ya girmez. Content script stop cevabından önce bekleyen capture mesajlarını flush eder.

## Surface ve koordinat

Öncelik kullanıcının ilk pointer etkileşiminin gerçek `[data-zui-surface]`/canvas yüzeyi, ardından görünür büyük canvas ve document viewport'tur. Küçük/dekoratif canvas'ın tüm sayfa için yanlış target seçilmesini önlemek amacıyla otomatik canvas adayı viewport alanının en az %10'unu kaplamalıdır. İlk pointer event surface'i kilitler; locator ID/data marker/yerel sıra ile kararlılaştırılır. Pozisyonlar güncel rect'e göre `[0,1]` aralığına clamp edilir.

Same-origin iframe locator'ı portable `::frame::` yolu olarak kaydedilir; runtime `frameId` macro'ya girmez. Cross-origin iframe capture güvenilir top-frame locator üretemediğinde `CROSS_ORIGIN_FRAME_UNSUPPORTED` uyarısıyla fail-closed kalır.

Worker restart sırasında kalan `RECORDING/PAUSED` session, pinned content script aynı aktif `sessionId` ile cevap veriyorsa korunur; popup yeniden açıldığında durum ve macro adı geri yüklenir. Content recorder yoksa veya session eşleşmiyorsa kayıt stale kabul edilip `IDLE/service_worker_restarted` olur ve frame capture'ları kapatılır. Extension reload ise content script dünyasını değiştirdiği için runtime sessionı temizler. Playback aktifken recorder ve recorder aktifken playback başlatılamaz; target pin de session bitene kadar kilitlidir.

## Movement sampling

- Normal opt-in movement: en az 24 ms ve 0.004 normalize mesafe.
- Drag movement: en az 12 ms veya 0.01 normalize mesafe.
- `mouseDown`/`mouseUp` asla atılmaz.
- Clicks-only modunda drag dışındaki hareket kaydedilmez.

## Hassas alanlar

Password type/autocomplete, OTP ve token/secret benzeri input adları fail-closed atlanır. Pointer veya keyboard eventinden kanonik satır üretilmez; session'a yalnız `SENSITIVE_INPUT_BLOCKED` warning kodu eklenir. İçerik ve clipboard okunmaz.

## Stop sonucu

Stop, kanonik `1.0` macro envelope üretir; structural `macro-v1.schema.json` sözleşmesi ve semantic validator birlikte geçmeden macro playback veya normal local storage listesine alınmaz. Geçersiz ham sonuç yalnız yerel debug kaydı olarak tutulur. Export popup içinde UTF-8, pretty JSON ve `.zui-macro.json` adıyla üretilir.
