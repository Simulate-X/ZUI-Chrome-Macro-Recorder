# Yol Haritası

Bu yol haritası faz kapılarıyla ilerler. Bir fazın çıktısı kanıtlanmadan sonraki faz, bilinmeyenleri “çözülmüş” kabul etmez.

## Faz 0 — Dokümantasyon ve sözleşmeler

**Durum:** Tamamlandı (2026-09-23).

**Amaç:** Kapsamı, riskleri, veri modelini ve PoC sorularını koddan önce sabitlemek.

Adımlar:

- Ürün amacı, kapsam dışı alanlar ve güvenlik sınırlarını yaz.
- MV3 bileşenlerini ve iki playback backend adayını tanımla.
- JSON event modelini ve normalize koordinat sözleşmesini tasarla.
- İnsan tarafından düzenlenebilir `MACRO_FORMAT` sözleşmesini, şema doğrulamasını ve backward-compatibility politikasını yaz.
- Cross-profile import/export gizlilik sınırını sabitle; runtime profil/tab/hesap bilgilerini format dışında tut.
- Hedef tab, frame, navigasyon ve stop davranışlarını tanımla.
- Faz 1 test matrisi ve kabul kriterlerini oluştur.

Çıkış kriteri:

- `README`, gereksinim, mimari, event modeli, makro formatı, koordinat sistemi, roadmap ve Faz 1 belgeleri birbiriyle tutarlı.
- Huuge uyumluluğu hakkında doğrulanmamış iddia yok.

## Faz 1 — Teknik fizibilite / PoC

**Durum:** Genel ürün kapısı tamamlandı (2026-09-24). Scheduler `OFFSCREEN_DOCUMENT`; pointer/mouse/canvas backend'i `DOM_SYNTHETIC`; native keyboard/text/select/wheel backend'i `CDP_INPUT` olarak seçildi. Ölçümler için [PHASE_1_RESULTS.md](PHASE_1_RESULTS.md), [PHASE_1B_RESULTS.md](PHASE_1B_RESULTS.md), [PHASE_1C_RESULTS.md](PHASE_1C_RESULTS.md), [PHASE_1D_RESULTS.md](PHASE_1D_RESULTS.md) ve [PHASE_1D_GENERIC_RESULTS.md](PHASE_1D_GENERIC_RESULTS.md) belgelerine bakın.

**Amaç:** Genel amaçlı recorder için standard DOM, canvas ve modern framework sınıflarında uygulanabilir dispatch yöntemini ve koordinat modelini kanıtlamak; site-specific uyumluluğu ayrı tutmak.

Adımlar:

- İzinli/test hesabıyla hedef sayfanın tab, frame, canvas/container ve overlay topolojisini gözlemle.
- Minimal MV3 PoC ile hedef sabitleme ve yaşam döngüsünü doğrula.
- DOM sentetik mouse/pointer ve keyboard eventlerini kontrollü, geri döndürülebilir hedeflerde dene.
- Gerekirse ayrı PoC ile `chrome.debugger` + CDP Input yöntemini dene.
- Normal boyut, resize, tam ekran, zoom/DPR ve mümkünse background tab senaryolarını ölç.
- `isTrusted`, focus, event sırası, pointer fields ve gözlenebilir oyun tepkisini kaydet.
- Cross-origin iframe ve permission gereksinimini belirle.
- Background throttling ve MV3 worker askıya alınma riskini ölç.
- En az yetkili çalışan backend'i ve destek sınırlarını karar kaydına geçir.

Phase 1C kararı: gerçek hidden-tab timing için `OFFSCREEN_DOCUMENT` seçildi; content-script scheduler elendi. Timing kapısı extension-only olarak kapandı.

Phase 1D Huuge çevre sonucu tarihsel/site-specific `BLOCKED_BY_ENV` olarak korunur. Phase 1D-G generic matrisi pointer/mouse/canvas/React için DOM'u, native keyboard/text/select/wheel için CDP'yi pozitif UI davranışıyla seçti. Huuge erişimi Phase 2'yi bloke etmez.

Çıkış kriteri:

- En az bir backend için “event gönderildi” değil, hedefin beklenen tepkisiyle pozitif kanıt; veya açık `BLOCKED/NOT_FEASIBLE` sonucu.
- Normalize koordinatın en az iki farklı hedef boyutunda aynı mantıksal noktayı vurduğu kanıt.
- Frame/coordinate/focus modeli belgelendi.
- Gerekli Chrome izinleri ve kullanıcı uyarıları kesinleşti.

## Faz 2 — Recorder

**Durum:** Tamamlandı (2026-09-24). Sonuçlar ve açık sınırlar için [PHASE_2_RESULTS.md](PHASE_2_RESULTS.md) belgesine bakın.

**Amaç:** Seçili hedefte güvenilir event kaydı ve yerel makro üretmek.

Adımlar:

- Hedef tab/surface seçimi ve sabitleme UI'ı.
- Kayıt durum makinesi: start, pause/resume, stop.
- Keyboard ve mouse ayrı aç/kapat ayarları.
- Varsayılan clicks-only; opsiyonel movement recording.
- Mouse move sampling/coalescing ve boyut limitleri.
- `DELAY + input event` dönüşümü.
- Normalize koordinat, target locator ve tanısal geometry kaydı.
- Parola/hassas input koruması.
- JSON doğrulama, yerel kayıt ve export.

Çıkış kriteri:

- Kontrollü sayfada kayıt deterministik JSON üretir.
- Clicks-only hareket spam'i üretmez.
- Resize sonrası kayıtlı normalized değerler geçerli kalır.
- Hedef tab kapanması/navigasyonu kayıt işlemini güvenli durdurur.

Kapanış kanıtı: Standard DOM, canvas ve MUI/React sayfalarında gerçek browser inputu Record→Stop→schema/semantic validation→Replay zincirinden geçti; hidden hedefte `OFFSCREEN_DOCUMENT` regresyonu ve pause süresi dışlama testi geçti. Hotkey'ler kapsam büyütmemek için Faz 4'te bırakıldı.

## Faz 3 — Makro editörü

**Durum:** Tamamlandı (2026-09-24). Uygulama sözleşmesi için [EDITOR.md](EDITOR.md), kabul kanıtı için [PHASE_3_RESULTS.md](PHASE_3_RESULTS.md) belgelerine bakın.

**Amaç:** Makroları kod yazmadan güvenli biçimde düzenlemek.

Adımlar:

- Event listesi ve detay editörü.
- Event ekleme, silme, kopyalama, enable/disable ve yeniden sıralama.
- Tür bazlı alan kontrolleri ve inline validation.
- Macro metadata ve playback defaults düzenleme.
- JSON import/export ve şema sürümü kontrolü.
- Başka Chrome profilinden gelen export için runtime hedefini yeniden bağlama; profile/account/session alanlarının bulunmadığını doğrulama.
- Undo/redo veya açık kaydet/iptal modeli.

Kapanış kanıtı: Phase 2 macro'su editor'da açıldı; delay/coordinate edit, add/delete/duplicate/reorder, undo/redo, schema+semantic+privacy validation, save/save-as, Raw JSON, export/import ve edited replay gerçek Chromium akışında geçti. Standard DOM, canvas, MUI/React ve hidden-tab edited replay doğrulandı.

Çıkış kriteri:

- Tüm desteklenen event türleri UI'da kayıpsız round-trip yapar.
- Geçersiz event kaydedilemez/oynatılamaz.
- Güvenilmeyen/bozuk JSON güvenli ve anlaşılır biçimde reddedilir.

## Faz 4 — Playback, loop ve hotkey'ler

**Durum:** Tamamlandı (2026-09-24). Kanıt: [PHASE_4_RESULTS.md](PHASE_4_RESULTS.md).

**Amaç:** Seçilen Faz 1 backend'i ile kontrol edilebilir ve iptal edilebilir playback.

Adımlar:

- Playback coordinator ve durum makinesi.
- Hız çarpanı, repeat, `0 = sonsuz`, loop delay.
- Play, pause/resume, stop ve step-by-step.
- Kalan delay'in pause/resume semantiği.
- `stopOnError` ve event-index bazlı hata raporu.
- Hedef/tab/frame/geometry preflight kontrolleri.
- Kullanıcı tarafından değiştirilebilir hotkey katmanı ve çakışma kontrolü.
- Debugger backend seçildiyse attach/detach ve görünür izin/uyarı akışı.
- Sekme kapanması, navigasyon ve backend detach halinde güvenli stop.

Çıkış kriteri:

- Stop planlı sonraki eventi güvenilir biçimde iptal eder.
- Sonsuz döngü görünürdür ve UI/hotkey ile durdurulabilir.
- Step mode her onayda yalnız bir tam safe semantic unit ilerletir; held input bırakabilecek ham satırı tek başına çalıştırmaz.
- Gerçek Windows mouse/keyboard'u etkilenmez.

## Faz 5 — Sağlamlaştırma ve test

**Durum:** Tamamlandı (2026-09-24). Otomatik Edge Chromium matrisi ile exact görünür Google Chrome iki-profil portability ve 80/100/125/150/200 native-zoom kapıları geçti. Kanıt ve açık sınırlar: [PHASE_5_RESULTS.md](PHASE_5_RESULTS.md), [HARDENING.md](HARDENING.md), [PORTABILITY.md](PORTABILITY.md), [DIAGNOSTICS.md](DIAGNOSTICS.md).

**Amaç:** Bilinen sınırları ölçmek, regresyonları engellemek ve güvenli sürüm adayı hazırlamak.

Adımlar:

- Unit test: şema, delay hesabı, loop, state machine, coordinate conversion.
- Integration test: tab lifecycle, navigation, frame ve permission akışları.
- Huuge doğrulama matrisi: boyut, zoom, DPR, fullscreen, overlay/re-layout.
- Background tab throttling ve uzun süreli timing drift ölçümü.
- Keyboard layout, modifiers, auto-repeat, Unicode/IME destek sınırları.
- Büyük makro, storage quota ve bozuk import testleri.
- Cross-profile import/export ve hassas/runtime alan sızıntısı regresyon testleri.
- Güvenlik incelemesi: host permissions, debugger, hassas input, log redaction.
- Erişilebilirlik ve kullanıcı uyarıları.
- Paketleme, sürümleme ve geri dönüş planı.

Çıkış kriteri:

- Kritik test matrisi geçer; açık sınırlamalar release notlarında yazılıdır.
- İzinler gerekçeli ve minimumdur.
- Hata/stop sonrası bağlı debugger, timer veya aktif session kalmaz.
- Huuge desteği yalnız ölçülen senaryolar kapsamıyla ilan edilir.

## Faz 6A — Ürünleştirme ve internal beta hazırlığı

**Durum:** Tamamlandı (2026-09-25). Görünür Google Chrome full-product UI, ayrı Chrome profilleri arasında full-library backup/restore/rebind/replay ve manuel visual/focus kapıları geçti.

**Amaç:** Phase 1–5 motorunu değiştirmeden popup, kütüphane, editor, ayarlar, onboarding, hata geri bildirimi, yedekleme ve release paketini günlük kullanıma hazırlamak.

Phase 6A için `0.6.0 internal beta` seçildi. Chrome ürün-UI smoke'u Phase 6A kapsamında tamamlandı; Phase 6B gerçek günlük kullanım doğrulaması yapılmadan `1.0.0-rc.1` veya stable etiketi verilmez. Kanıt için [PHASE_6A_RESULTS.md](PHASE_6A_RESULTS.md) belgesine bakın.

## Faz 6B — Daily-use validation ve bug burn-down

**Durum:** Tamamlandı / `USER DAILY-USE ACCEPTANCE PASS` (2026-09-30). İlk automated stress turunda bulunan P1 Pause/Resume acknowledgement race'i (`DUI-001`) düzeltildi. DUI-005 gerçek Google Chrome'da Billionaire source → Huuge explicit rebind → observable gameplay effect ile `FIXED / VERIFIED` kapandı. Open P0/P1 sıfırdır. Final görünür Chrome popup Record/Play başarı ve hata/recovery smoke'u geçti.

Automated kanıt; 21 target switch, 25 popup reopen, 100.000-input accelerated soak, 1.000-input recording, 10.000-event large macro/bulk delay, loop/speed/rapid-control, backup/restore, privacy ve cleanup matrislerini kapsar. Ayrıntılar [PHASE_6B_RESULTS.md](PHASE_6B_RESULTS.md), gerçek issue kayıtları [DAILY_USE_ISSUES.md](DAILY_USE_ISSUES.md) ve kanıt durumu [DAILY_USE_VALIDATION.md](DAILY_USE_VALIDATION.md) dosyalarındadır.

Final full regression ve package audit kapandı. Public yayın kanalı bilinçli olarak `0.6.0 internal beta` kaldı; bu karar production stable veya `1.0.0-rc.1` iddiası değildir.

## Fazlar arası ana karar kapıları

| Kapı | Karar |
|---|---|
| G1 — Faz 1 | DOM, CDP, her ikisi veya fizibilite yok |
| G2 — Faz 1 | Canvas/container locator ve frame modeli |
| G3 — Faz 2 | `mouseDown + delay + mouseUp` dönüşümünün regresyon kanıtı |
| G4 — Faz 4 | Kapandı: timer sahibi OFFSCREEN_DOCUMENT; global toggle/stop Chrome commands, step editor-local F10 |
| G5 — Faz 5 | Kapandı: Edge Chromium matrisi ve exact Google Chrome two-profile/native-zoom kabulü geçti; production soak ve Huuge `BLOCKED_BY_ENV` kapsam dışı/açık sınır |
