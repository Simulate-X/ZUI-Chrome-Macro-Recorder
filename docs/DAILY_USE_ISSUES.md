# Phase 6B Daily-Use Issue Log

Bu dosya Phase 6B boyunca gerçek issue tracker'dır. Secret, şifre, OTP, cookie veya token eklenmez. Severity sözleşmesi: P0 Critical, P1 Major, P2 Moderate, P3 Minor.

## DUI-001 — Rapid Pause/Resume acknowledgement race

- ID: `DUI-001`
- Date: 2026-09-25
- Severity: P1 — Major
- Browser/Profile: Microsoft Edge automated clean profile; popup lifecycle stress
- Website: Local safe dynamic-app fixture
- Compatibility class: `LIFECYCLE`
- Macro: `popup-lifecycle`, 40 repeats
- Steps to reproduce: Playback başlat; popup'ı art arda kapat/aç; her beşinci açılışta Pause ardından hemen Resume; çevrimi tekrarla.
- Expected: Her Pause/Resume isteği idempotent çalışır; playback RUNNING/PAUSED arasında güvenli ilerler ve terminale ulaşır.
- Observed: İki koşuda terminal timeout; ayrıntılı koşuda `INVALID_PLAYBACK_TRANSITION:PAUSED->PAUSE_PENDING`.
- Error code: `INVALID_PLAYBACK_TRANSITION`
- Reproducibility: Intermittent; yoğun popup/control lifecycle altında üç koşunun ikisinde timeout, birinde stable transition error.
- Root cause: Offscreen `pauseGate`, `PAUSED` durumunu status acknowledgement yayımlanmadan önce doğrudan mutate ediyordu. Hemen gelen Resume isteği, public state ile scheduler'ın gerçek pause gate'i arasında yarışabiliyor ve sonraki Pause eski `PAUSED` state'ine çarpıyordu.
- Fix: PAUSED geçişi yalnız `publish()` üzerinden yapılır. Pause/Resume/Stop aynı veya geçişteki state için idempotent hale getirildi; Resume acknowledgement sırasında gelirse pause gate beklemeden RUNNING'e döner.
- Regression test: `tests/offscreen-control.test.mjs` içinde 50 ardışık Pause/Resume; `tests/e2e/run-phase-6b.mjs` içinde 25 popup reopen ve beş Pause/Resume çevrimi.
- Commit: `761a542 fix: stabilize rapid playback pause resume`
- Status: **FIXED / VERIFIED** — unit 110/110 ve full Phase 6B E2E PASS.

## DUI-002 — Rename ardından Save eski adı geri yazıyor

- Severity: P1 — Major
- Root cause: Library Rename storage kaydını güncelliyor, açık editörün canonical in-memory snapshot'ı eski `name` değerini taşımaya devam ediyordu. Sonraki Save stale snapshot'ı storage'a yazıyordu.
- Fix: Açık macro yeniden adlandırılırken editör snapshot'ı source-of-truth olarak kaydediliyor ve başarılı storage yanıtı `markSaved` ile aynı state'e geri bağlanıyor.
- Regression: Gerçek Chromium'da Rename → Save → library reread `Renamed Contract`; unit/state testleri.
- Status: **FIXED / VERIFIED**.

## DUI-003 — Kullanıcıya görünen duplicate macro adları

- Severity: P1 — Major
- Root cause: Storage service yalnız internal ID conflict'ini denetliyor; entry point'ler case-sensitive farklı yardımcılar kullanıyordu.
- Fix: Canonical trim + locale case-insensitive key, service-layer conflict guard ve görünür unique suggestion. Existing duplicate data startup'ta silinmez/migrate edilmez.
- Policy: Normal Save/Rename conflict'i bloklar; Recorder/Duplicate/Import/Keep Both güvenli unique ad üretip sonucu görünür gösterir; Replace/Skip atomik kalır.
- Regression: Case/whitespace collision, Keep Both/Replace/Skip, import helper, gerçek worker conflict ve 35-macro backup restore.
- Status: **FIXED / VERIFIED**.

## DUI-004 — Chrome shortcut product configuration

- Severity: P2 — Moderate
- Finding: Chrome yalnız dört suggested shortcut'a izin verir; `Ctrl+Alt` AltGr nedeniyle yasaktır ve `F10` desteklenen command key değildir. Chrome ayrıca çakışan öneriyi atamasız bırakabilir.
- Fix: Beş command gerçek state-machine handler'larına bağlandı. Manifest geçerli öneriler olarak playback toggle `Ctrl+Shift+P`, stop `Ctrl+Q` taşır; diğer üçü gerçek Chrome'da atanmak üzere listelenir. Settings manifest metnini değil `chrome.commands.getAll()` sonucunu **Current** olarak, Jitbit-style manual seti ayrı **Recommended** olarak gösterir ve Chrome'un bazı kısayolları atamasız bırakabileceğini açıklar.
- Actual clean Chromium: Stop `Ctrl+Q`; playback toggle, step, recording toggle ve abort `Not assigned`.
- Platform evidence: [Chrome Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands).
- Status: **FIXED / VERIFIED WITH CHROME LIMITATION**.

## DUI-005 — Cross-origin rebind yanlış destination surface'e bağlanıyor

- Severity: P1 — Major.
- Reopened evidence: Billionaire source `canvas / #gameframe ::frame:: #canvas` iken Huuge rebind exports `viewport / html` oldu. Scheduler RUNNING/counters advancing görünmesine rağmen oyun yüzeyine olay gitmedi.
- Round 2 root cause: Rebind, source surface contract'ını hedefte resolve etmek yerine top document'taki generic `findSurface()` sonucunu alıyordu; Huuge target böylece yanlış `html` yüzeyine bağlanıyordu.
- Round 3 false-negative root cause: `#gameframe ::frame:: #canvas` top-frame resolver ile doğru DOM node'a ulaşıyordu, fakat iframe realm'indeki gerçek `<canvas>` üst realm'in `HTMLCanvasElement` constructor'ına `instanceof` olmadığı için `container` sınıflandırılıyordu. `expectedKind=canvas` ile `resolvedKind=container` karşılaştırması `SURFACE_KIND_MISMATCH` üretip generic `REBIND_SURFACE_INCOMPATIBLE` sonucuna dönüşüyordu. Başarılı nested resolution sonrası `portableSelector()`ın üst `window`dan başlaması da frame chain'i düşürebilecek ikinci parity kusuruydu.
- Round 3 fix: Recorder/Rebind kind sınıflandırması realm-neutral tag semantics kullanır. Playback ve Rebind `resolvePortableSurface()` üzerinden aynı `::frame::` traversal'ını kullanır; canonical selector üretimi resolved element'in `ownerDocument.defaultView` zincirinden başlar. Copy ve Replace aynı `RESOLVE_REBIND_SURFACE` pipeline'ını korur. Geometry exact-equality şartı yoktur; destination current rect kaydedilir. Hostname branch eklenmedi.
- Diagnostics: User-facing code `REBIND_SURFACE_INCOMPATIBLE` kalır. Internal metadata `FRAME_LOCATOR_FAILED`, `FRAME_ENTER_FAILED`, `LOCATOR_NOT_FOUND`, `LOCATOR_INVALID`, `SURFACE_KIND_MISMATCH`, `ZERO_RECT`, `VISIBILITY_REJECTED`, `RUNTIME_NOT_AVAILABLE` alt nedenlerini ve güvenli frame-step/rect/kind/visibility trace'ini taşır.
- Regression: İki ayrı local origin üzerinde aynı-origin `#gameframe` iframe + `#canvas` fixture'ı kullanıldı. Destination Recorder aynı canonical locator'ı keşfetti; Copy ve Replace aynı locator'ı canvas olarak resolve etti; destination geometry `640×360 @ DPR 1` ile yenilendi; playback iframe içindeki observable sayacı artırdı. Eksik frame/canvas, iframe olmayan boundary, kind mismatch ve zero rect fail-closed kaldı. Events değişmedi, export/import portable kaldı ve runtime ID serialize edilmedi.
- Manual acceptance: Gerçek Google Chrome'da Billionaire üzerinde kaydedilen macro için Huuge target seçildi, origin mismatch sonrası explicit rebind uygulandı ve rebound Play gerçek Huuge oyununda observable gameplay etkisi üretti. Bu kanıt yalnız scheduler/event counter değildir. Hostname-specific production code eklenmedi.
- Status: **FIXED / VERIFIED**.

## DUI-006 — Editor error mesajı okunmadan kayboluyor

- Severity: P2 — Moderate UX
- Root cause: 250 ms playback refresh terminal status metnini error status üstüne yazıyordu.
- Fix: Error dismiss veya sonraki başarılı action'a kadar sticky; title, explanation, code ve recovery action görünür. Worker diagnostic kaydı korunur.
- Regression: Origin mismatch mesajı 5.1 saniye sonra görünür; recovery actions visible; Diagnostics last error `ORIGIN_MISMATCH`.
- Status: **FIXED / VERIFIED**.

## DUI-007 — Serbest pencere resize sırasında olası playback stop

- Severity: Investigation (P2 candidate)
- Automated result: **NOT REPRODUCED**. Viewport küçültülerek surface 640 px'den 400 px'e indirildi; current rect yeniden ölçüldü, normalized point görünür tıklama üretti ve playback COMPLETED oldu.
- Exact error/root cause: Yok; otomatik reproduction bir error code üretmedi.
- Decision: Kanıtsız geometry fix veya hostname-specific workaround eklenmedi. Gerçek site diagnostic code ile yeniden açılmak üzere monitoring.

## Invalidated observation — fresh install test macros

Clean Profile B first install empty library ile açıldı. Beklenen davranış doğrulandı; destructive startup cleanup eklenmedi.

## Current counts

| Severity | Found | Open |
|---|---:|---:|
| P0 | 0 | 0 |
| P1 | 4 | 0 |
| P2 | 3 | 0 |
| P3 | 1 | 0 |

`DUI-007` confirmed product bug değil, izlenen investigation kaydıdır. Otomasyon PASS sonucu gelecekte kullanıcı tarafından gözlenen ve diagnostic ile kanıtlanan resize sorununu geçersiz kılmaz.
