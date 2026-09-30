# ZUI Macro Recorder for Chrome — Changelog

## 0.6.0 — Internal beta

- Public repository starts from a sanitized snapshot history under the MIT License; local `storage/`, macro exports, diagnostics, temporary profiles and user screenshots are excluded.
- Final visible Chrome popup smoke passed: successful Record/Play starts close the popup, while failed starts keep recovery UI open. User daily-use acceptance is recorded as passed.
- Popup; Target, Recording, Playback ve hızlı aksiyonları tek kontrol merkezinde birleştirir.
- Başarılı Record (`RECORDING`) ve Play (`RUNNING`) başlangıcından sonra popup kapanır; başarısız başlangıçta recovery UI açık kalır.
- Genel web siteleri için profil-local, site-bazlı izin akışı; required host permission sayısı sıfırdır.
- Recorder, editable canonical macro editor ve browser-only playback; hız, tekrar, loop, Pause/Resume, Stop ve Step kontrollerini içerir.
- Cross-profile macro ve library portability; runtime tab/window/profile state taşınmaz.
- Explicit cross-site **Rebind a Copy** / **Rebind This Macro** akışı eklendi; sessiz rebind yapılmaz. Billionaire kaynak makronun Huuge hedefinde observable gameplay etkisi gerçek Chrome'da doğrulandı.
- Macro Library artık search, sort, recent, rename ve görünür validation/playback özetleri sunar.
- Global Settings, onboarding, Quick Guide, kullanıcı dostu hata/kurtarma mesajları ve redacted diagnostics kontrolleri eklendi.
- Versioned portable full-library backup ve validated partial restore; Keep Both, Replace ve Skip conflict politikalarını destekler.
- Tutarlı ürün görsel sistemi, 16/32/48/128 ikon seti ve deterministik release build/package eklendi.
- Popup kayıt adı taslağı polling sırasında korunur; clicks-only kayıtta yok sayılan hover artık yanlış yüzeyi kilitlemez.
- Rename sonrası stale adın geri gelmesi ve case/whitespace duplicate ad üretimi düzeltildi.
- Hızlı popup reopen ve ardışık Pause/Resume sırasında offscreen acknowledgement yarışı giderildi; playback kontrolleri idempotent kaldı.
- Redacted diagnostics, privacy-safe synthetic fixtures ve deterministic package-content audit ile GitHub publication hazırlığı eklendi.
- Görünür Google Chrome ürün akışı ve ayrı profiller arasında üç makrolu backup/restore/rebind/replay kabulü tamamlandı.
- Faz 1–5 scheduler, DOM/CDP routing ve canonical Macro JSON sözleşmesi korunur.

## 0.5.0 — Phase 1–5 foundation

- Target-relative recorder ve editable canonical Macro JSON.
- Visual/Raw editor, validation, undo/redo, import/export.
- Offscreen playback scheduler; speed, repeat, infinite loop, pause/stop ve safe-step.
- DOM pointer/mouse/canvas ile scoped CDP keyboard/text/select/wheel routing.
- Cross-profile portability, lifecycle recovery, sensitive-input protection ve privacy-safe diagnostics.
