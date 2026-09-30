# Phase 1B — Normal Chrome ve Background Playback Sonuçları

## Sonuç özeti

**Karar: 3 — Extension-only çözümün hidden/background-tab timing hedefini karşıladığı kanıtlanmadı; Phase 2 öncesi mimari karar gerekiyor.**

Normal Google Chrome'da foreground ve hedef Chrome penceresi odaksızken `DOM_SYNTHETIC + CONTENT_SCRIPT` ölçümleri 100/200/500 ms eşiklerini geçti. Ancak gerçek inactive tab (`document.visibilityState=hidden`) matrisi, unpacked extension yüklemek için gereken otomasyon oturumunun sayfa yaşam döngüsünü değiştirmesi nedeniyle normal Chrome'da güvenilir biçimde tamamlanamadı. Headless sonuç başarı sayılmadı.

Phase 2 Recorder'a geçiş hazır değildir. Recorder tasarımından önce hidden-tab davranışı manuel yüklenmiş normal Chrome profiliyle ölçülmeli veya Plan B için ayrı karar verilmelidir.

## Test ortamı

| Alan | Değer |
|---|---|
| Tarih | 2026-09-23 |
| İşletim sistemi | Windows, Win64 |
| Tarayıcı | Google Chrome 153.0.8010.53 |
| Chrome binary | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Çalışma modu | Görünür GUI, headless değil |
| Profil | İzole ve geçici |
| Extension yükleme | Resmî CDP `Extensions.loadUnpacked`; yalnız bootstrap/test profili |
| Güvenli hedef | `http://127.0.0.1:<ephemeral-port>/` localhost canvas fixture |
| Backend | `DOM_SYNTHETIC` |
| Scheduler | `CONTENT_SCRIPT` |
| Örneklem | Her satırda 31 playback olayı, 30 interval |
| Kabul eşiği | p95 ≤ requested × 1.25 ve maximum drift ≤ max(50 ms, requested × 0.5) |

Gerçek para, bahis, spin, claim, satın alma veya casino hesabı kullanılmadı.

## Normal Chrome doğrulaması

| Kontrol | Sonuç | Kanıt sınırı |
|---|---|---|
| MV3 service worker | Geçti | Chrome target listesinde extension worker bulundu |
| Content script | Geçti | Localhost yüzeyinden `GET_SURFACE` yanıtı alındı |
| Target tab pinleme | Geçti | Runtime binding ve mesaj yönlendirme çalıştı |
| Pointer/Mouse | Geçti | Canvas pointer/mouse zincirini aldı; `isTrusted=false` |
| Keyboard keyDown/keyUp | Geçti | Güvenli input iki olayı da aldı; `isTrusted=false` |
| Target close fail-closed | Geçti | Sekme kapanınca pinned target temizlendi |
| Gerçek uygulama/Huuge kabulü | Ölçülmedi | Local fixture sonucu gerçek uygulamaya genellenemez |

## Foreground benchmark

| İstenen | Medyan | p95 | Maksimum interval | Maksimum drift | Kümülatif drift | Sonuç |
|---:|---:|---:|---:|---:|---:|---|
| 100 ms | 94.2 ms | 110.0 ms | 110.3 ms | 10.3 ms | -5.6 ms | Geçti |
| 200 ms | 201.8 ms | 213.0 ms | 213.3 ms | 14.1 ms | 7.3 ms | Geçti |
| 500 ms | 499.5 ms | 509.9 ms | 512.7 ms | 12.7 ms | 2.2 ms | Geçti |

## Background / unfocused-window benchmark

Bu tabloda hedef tab görünür kaldı (`visibilityState=visible`), fakat hedef Chrome penceresi odaksızdı. Ayrı bir normal Chrome penceresi öne alındı ve hedef pencere için `chrome.windows.focused=false` doğrulandı. Bu, “kullanıcı başka pencereyle çalışırken” senaryosunu ölçer; inactive/hidden tab kanıtı değildir.

| İstenen | Medyan | p95 | Maksimum interval | Maksimum drift | Kümülatif drift | Sonuç |
|---:|---:|---:|---:|---:|---:|---|
| 100 ms | 94.5 ms | 109.8 ms | 110.6 ms | 10.6 ms | 6.0 ms | Geçti |
| 200 ms | 201.8 ms | 204.7 ms | 216.9 ms | 16.9 ms | 14.9 ms | Geçti |
| 500 ms | 499.8 ms | 512.7 ms | 513.6 ms | 13.6 ms | 4.4 ms | Geçti |

## Inactive/hidden tab ve throttling sonucu

Normal Chrome inactive-tab matrisi **tamamlanmadı**:

- Remote-debugging ile yönetilen testlerde aktif sekme kimliği değişse veya pencere minimize edilse bile hedef sayfa `visibilityState=visible` kaldı. Bu koşul hidden-tab diye raporlanmadı.
- Extension yüklemesi ile timing ölçümünü iki Chrome açılışına ayırma denendi. CDP `Extensions.loadUnpacked` kurulumu restart sonrasında kalıcı değildi; Chrome Stable normal açılışında command-line `--load-extension` extension'ı etkinleştirmedi.
- Masaüstü UI köprüsü Chrome penceresini sunmadığı için onaylanmış manuel “Load unpacked” adımı otomatikleştirilemedi.
- Eski headless tanı testinde 100 ms timer için yaklaşık 909.9 ms maksimum drift görülmesi throttling riski göstergesidir, fakat normal Chrome kabul kanıtı değildir.

Bu nedenle “100 ms hidden tab çalışır” iddiası yapılmaz. “Kesin ~1000 ms olur” da normal Chrome için ölçülmüş sonuç sayılmaz.

## Alternatif offscreen scheduler

Küçük bir `chrome.offscreen` PoC eklendi. Offscreen document absolute-deadline `setTimeout` döngüsüyle tick üretir ve gerçek target tab dispatch zincirini kullanır. Ancak güvenilir normal-Chrome hidden-tab koşulu kurulamadığı için 100/200/500 ms kabul tablosu tamamlanmadı. Offscreen'ın daha hassas olduğu varsayılmadı ve scheduler seçilmedi.

## Koordinat ve resize

| Kontrol | Sonuç |
|---|---|
| İlk CSS yüzey | 640 × 360 |
| Resize sonrası CSS yüzey | 960 × 540 |
| Normalize nokta | x=0.25, y=0.75 |
| Sonuç | İki boyutta da aynı göreli nokta; geçti |
| DPR | 1.5 |
| Backing store | 960 × 540 |
| CSS transform | `none` |
| Border / padding | 0 px |
| Object fit / letterboxing | `fill`; fixture'da letterbox yok |

DOM backend `getBoundingClientRect()` üzerinden CSS pixel kullanır. DPR ile device pixel karıştırılmadı. CDP playback adapter seçilmediği için CDP coordinate mapping iddiası yoktur.

## Backend ve CDP kararı

- Kanıtlanan dar kapsam: `DOM_SYNTHETIC + CONTENT_SCRIPT`, yalnız local fixture foreground ve unfocused-visible pencere.
- CDP playback adapter oluşturulmadı. Local fixture sentetik DOM input'u kabul etti; ölçülen unfocused timing geçti. Açık kapı scheduler/hidden-tab yaşam döngüsüdür ve CDP input dispatch tek başına bu scheduler sorununu çözmez.
- Gerçek uygulama kabulü ve `isTrusted=false` etkisi açık kalır.

## Bilinen sınırlamalar

- Inactive/hidden normal Chrome tab timing matrisi yoktur.
- Offscreen PoC'nin hidden-tab kabul tablosu yoktur.
- MV3 service worker uzun playback yaşam döngüsü ayrıca ölçülmelidir.
- Cross-origin iframe, CSS transform, border/padding, letterboxing ve farklı zoom/DPR kombinasyonları bu fixture'da kapsanmadı.
- Huuge Casino uyumluluğu hakkında kanıt yoktur.
- Sentetik keyboard olayları gerçek metin girdisi veya framework kabulünü garanti etmez.

## Phase 2 kapısı

**Hazır değil.** Aşağıdakilerden biri tamamlanmadan Recorder fazına geçilmemeli:

1. Normal Chrome'da extension manuel olarak unpacked yüklenir; 100/200/500 ms inactive-tab matrisi ve offscreen karşılaştırması yeniden çalıştırılır.
2. Extension-only garantiden vazgeçilerek [ARCHITECTURE.md](ARCHITECTURE.md) içindeki Plan B için kullanıcıyla ayrı mimari kararı alınır.
