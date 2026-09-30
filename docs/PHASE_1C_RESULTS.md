# Phase 1C — Günlük Chrome Profilinde Gerçek Hidden-Tab Sonuçları

## Sonuç özeti

**Karar: B — Extension-only playback timing için `OFFSCREEN_DOCUMENT` scheduler seçildi.**

Normal günlük Chrome profilinde manuel yüklenmiş unpacked extension ile gerçek inactive hedef sekme doğrulandı: `document.visibilityState === "hidden"` ve `document.hidden === true`. Content-script scheduler hidden sekmede 100/200/500 ms hedeflerini karşılamadı. Offscreen document scheduler aynı hidden hedefe event gönderirken 100/200/500 ms matrisinin tamamını kabul eşiği içinde bitirdi.

Bu karar yalnız scheduler içindir. Input backend hâlâ yerel fixture'da `DOM_SYNTHETIC` ve `isTrusted=false` kapsamındadır; gerçek Huuge uygulamasının event kabulü kanıtlanmış değildir. Phase 2 bu çalışmada başlatılmadı.

## Test ortamı ve kanıt sınırı

| Alan | Değer |
|---|---|
| Tarih | 2026-09-23 |
| İşletim sistemi | Windows 11, Win64 |
| Tarayıcı | Google Chrome 153.0.0.0 user-agent / 153.0.8010.53 kurulu sürüm |
| Profil | Kullanıcının normal günlük profili; geçici profil değil |
| Extension | Manuel unpacked yükleme, `hcjbilbokehlhimkaccamckdkpgamiha`, v0.1.0 |
| Çalışma modu | Görünür normal Chrome; headless değil |
| Güvenli hedef | `http://127.0.0.1:4173/` yerel canvas fixture |
| Hedef düzeni | Ayrı normal Chrome penceresinde inactive hedef sekme; zararsız extension sekmesi aktif; runner penceresi odaklı |
| Backend | `DOM_SYNTHETIC`; OS mouse/keyboard yok; `isTrusted=false` |
| Örneklem | Her satırda 31 playback olayı, 30 interval |
| Kabul eşiği | p95 ≤ requested × 1.25 ve maximum drift ≤ max(50 ms, requested × 0.5) |

Gerçek para, bahis, spin, claim, satın alma, hesap işlemi veya geri döndürülemez eylem kullanılmadı.

## Yaşam döngüsü kanıtı

| Durum | `visibilityState` | `document.hidden` | Sonuç |
|---|---|---:|---|
| Foreground hedef | `visible` | `false` | Doğrulandı |
| Inactive hedef sekme | `hidden` | `true` | Doğrulandı |

Offscreen matrisinin bütün satırlarında 31 olayın tamamı `hidden/true` döndürdü. Böylece sonuç, unfocused ama görünür pencere ölçümü değil gerçek inactive-tab ölçümüdür.

## Foreground — content-script scheduler

| İstenen | Medyan | p95 | Maksimum interval | Maksimum drift | Kümülatif drift | Sonuç |
|---:|---:|---:|---:|---:|---:|---|
| 100 ms | 94.7 ms | 109.6 ms | 110.3 ms | 10.3 ms | 7.3 ms | Geçti |
| 200 ms | 202.1 ms | 204.6 ms | 209.7 ms | 13.2 ms | 12.0 ms | Geçti |
| 500 ms | 498.7 ms | 511.7 ms | 512.5 ms | 13.6 ms | 4.3 ms | Geçti |

## Hidden — content-script scheduler

| İstenen | Medyan | p95 | Maksimum interval | Maksimum drift | Kümülatif drift | Sonuç |
|---:|---:|---:|---:|---:|---:|---|
| 100 ms | 996.1 ms | 1008.8 ms | 1009.3 ms | 909.3 ms | 22401.5 ms | Kaldı |
| 200 ms | 996.8 ms | 1012.1 ms | 1012.4 ms | 812.4 ms | 19985.0 ms | Kaldı |
| 500 ms | 997.6 ms | 1014.7 ms | 1226.9 ms | 726.9 ms | 12230.1 ms | Kaldı |

100 ve 500 ms satırları son kabul koşusundan, 200 ms satırı aynı günlük profil ve aynı `hidden/true` düzenindeki önceki geçerli koşudan alınmıştır. Son kabul koşusundaki 200 ms content satırı sırasında yaşam döngüsü değiştiği için o satır dışlandı. Üç geçerli satır da content-script timer'ın hidden sekmede yaklaşık 1000 ms seviyesine throttle olduğunu gösterir.

## Hidden — offscreen document scheduler

| İstenen | Medyan | p95 | Maksimum interval | Maksimum drift | Kümülatif drift | Sonuç |
|---:|---:|---:|---:|---:|---:|---|
| 100 ms | 94.7 ms | 109.7 ms | 110.1 ms | 10.1 ms | 2.8 ms | Geçti |
| 200 ms | 202.2 ms | 205.1 ms | 205.2 ms | 13.8 ms | 2.0 ms | Geçti |
| 500 ms | 498.4 ms | 513.2 ms | 513.5 ms | 13.5 ms | 0.3 ms | Geçti |

Offscreen document yalnız zamanlamanın sahibidir. Her tick service worker üzerinden sabitlenmiş hedef tab'a, ardından content script içindeki aynı `DOM_SYNTHETIC` dispatch yoluna gider. Bu nedenle scheduler başarısı ile input backend kabulü birbirine karıştırılmaz.

## Service worker ve yaşam döngüsü kararı

Service worker tek başına uzun timer sahibi olarak benchmark edilmedi. Deney sırasında uzun `extension page → service worker → content script` mesaj zincirinde kanalın yanıt gelmeden kapanabildiği gözlendi. Content ölçümü daha sonra doğrudan hedef sekmeye bağlandı; offscreen akışında ise her tick worker'a yeni mesaj gönderir.

Seçilen üretim yönü:

- Scheduler: `OFFSCREEN_DOCUMENT`.
- Dispatch: hedef content script üzerinden seçilmiş backend; Phase 1C'de `DOM_SYNTHETIC`.
- Service worker: hedef yaşam döngüsü, güvenli yönlendirme ve offscreen oluşturma/kapatma; hassas uzun timer sahibi değil.
- Fail closed: hedef kapanır/navigate olur veya mesaj zinciri koparsa playback durur.

## Mimari A/B/C kararı

| Seçenek | Sonuç | Gerekçe |
|---|---|---|
| A — Content script scheduler | Elendi | Hidden 100/200/500 ms timing kabul eşiğini karşılamadı. |
| B — Offscreen extension scheduler | **Seçildi** | Gerçek hidden hedefte 100/200/500 ms matrisinin tamamı geçti. |
| C — Native helper / extension-only timing yetersiz | Şimdilik gerekli değil | Extension-only timing kapısı offscreen ile kapandı; gerçek target input kabulü ayrı kapıdır. |

## Açık kapılar ve kapsam dışı kalanlar

- Gerçek Huuge target topolojisi, frame/locator ve `isTrusted=false` kabulü hâlâ ölçülmedi.
- CDP input yalnız gerçek target DOM backend'i kabul etmezse ayrı izinli PoC adayıdır; timing için CDP kullanılmadı.
- Minimize pencere testi opsiyoneldi ve çalıştırılmadı.
- MV3 worker suspend/restart ve uzun playback dayanıklılığı Phase 4/5 entegrasyon testidir.
- Zoom, fullscreen, farklı DPR, cross-origin iframe ve gerçek uygulama re-layout'u bu fixture sonucuyla kanıtlanmaz.
- Phase 2 Recorder bu görevde başlatılmadı.

## Regresyon ve tekrar üretim

- Normalize koordinat/şema testleri `npm test` ile çalışır.
- Günlük profil doğrulaması için `npm run test:phase1c:server`, ardından manuel yüklenmiş extension içindeki `phase1c.html` kullanılır.
- Phase 1C koşucusu geçici profil, headless Chrome, CDP timing veya `Extensions.loadUnpacked` kullanmaz.
