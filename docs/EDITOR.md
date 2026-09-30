# Editable Macro Editor

## Canonical state

Editor ayrı bir extension sayfasıdır. Tek veri otoritesi `state.macro` içindeki kanonik version 1 macro nesnesidir. Visual event listesi/detail formu, Raw JSON, import/export ve Preview Replay aynı nesneyle çalışır. UI sıra numarası veya filtre bilgisi JSON'a yazılmaz.

## Library ve lifecycle

Sol library her macro için ad, updated/created zamanı ve event sayısını; Open, Replay, Export, Duplicate ve Delete kontrollerini gösterir. Unsaved macro'dan başka macro'ya geçerken kullanıcıya sırasıyla Save veya Discard/Cancel seçimi verilir. Sayfa kapanırken dirty state browser `beforeunload` kapısıyla korunur.

Delete confirmation ister. Aktif recording veya playback varken service worker delete işlemini reddeder. Import aynı ismi bulursa `Name (2)`, `Name (3)` biçiminde görünür unique isim ve yeni portable ID üretir.

## Visual edit

Desteklenen türler `delay`, `mouseDown`, `mouseUp`, `mouseMove`, `mouseWheel`, `keyDown`, `keyUp` ile mevcut schema'daki `text` ve `ime` olur. Her satır canonical index, type, human-readable summary ve validation göstergesi taşır. Koordinat JSON'da 0..1 olarak kalır, listede yüzde gösterilir.

Detail form event türünün schema alanlarını düzenler. Add seçili satırın arkasına güvenli varsayılan event ekler. Delete, Duplicate, Move Up ve Move Down doğrudan canonical array üzerinde çalışır. Duplicate deep clone ve yeni event ID üretir. Multi-select ve drag reorder bu fazda uygulanmadı.

Manuel `text`/`ime` değeri kullanıcı tarafından açıkça girilir; editor sayfa, clipboard veya browser credential içeriği toplamaz. Playback bu türleri CDP `Input.insertText` adapter'ına yönlendirir ve loglarda metin yerine yalnız uzunluk döndürür.

## Undo, redo ve dirty state

Field edit, add, delete, duplicate, move, name edit ve Raw JSON Apply en fazla 50 kanonik snapshot'lık history'ye girer. Undo/redo macro ve selection'ı birlikte geri yükler. `Ctrl+Z`, `Ctrl+Y` ve `Ctrl+Shift+Z`, metin alanlarının native undo davranışını bozmamak için yalnız form inputu dışında yakalanır.

Dirty state mevcut canonical JSON ile son başarılı save snapshot'ının karşılaştırılmasıdır. Save sonrası history temizlenir ve state clean olur.

## Validation

Her değişiklikten sonra row-level ve whole-macro structural/semantic/privacy validation çalışır. Hatalar JSON path, stable code ve okunabilir message ile gösterilir. Geçersiz satır kırmızı işaretlenir; Save, Save As, Export ve Preview Replay devre dışı kalır. Service worker Save sırasında aynı validation'ı tekrarlar.

## Save ve Save As

Save aynı macro `id` değerini ve `createdAt` zamanını korur, `updatedAt` değerini yeniler. Save As deep clone, yeni ID, ad ve timestamps üretir. Chrome profile/account/tab/window/debugger/cookie/token/local-path/backend alanları kanonik macro içinde kabul edilmez.

## Import ve export

Import pipeline: file read → JSON parse → structural validation → semantic/privacy validation → confirmation → unique name/new ID → storage. Hata halinde active macro veya storage değişmez.

Export yalnız son geçerli in-memory canonical state'i UTF-8, pretty JSON ve `.zui-macro.json` adıyla üretir. Bu nedenle kaydedilmemiş fakat valid bir edit Preview Replay ve Export için kullanılabilir; storage sessizce değişmez.

Phase 5 library load sırasında bozuk storage satırlarını quarantine özetine ayırır ve geçerli makroları kullanılabilir bırakır. **EXPORT DIAGNOSTICS**; sürüm, platform, redakte playback state, hata kodları ve quarantine özetini indirir. Macro save/export state'ini değiştirmez ve indirme engellenirse aynı düğmeyle tekrar denenebilir.

## Raw JSON

Raw sekmesi canonical macro'nun pretty JSON görünümüdür. Apply ancak JSON parse ve full validation geçerse canonical state'i atomik değiştirir ve undo history'sine girer. Invalid Apply active macro'yu değiştirmez. Cancel Visual görünüme döner.

## Replay semantiği

Preview Replay, storage kopyası yerine geçerli in-memory canonical state'i mevcut Phase 2 router ve `OFFSCREEN_DOCUMENT` scheduler'a gönderir. Invalid state oynatılamaz.

Phase 3 tesliminde `PLAY SELECTED` ve `PLAY FROM HERE` uygulanmamıştı; tek `mouseDown`, eşleşmeyen keyDown/up veya ortadan başlayan drag dizisinin hedefte basılı state bırakma riski Phase 4 safe-unit coordinator ile aşağıdaki biçimde kapatıldı.

## Phase 4 playback integration

Editor artık macro-specific `playbackDefaults` alanlarını dirty/undo/save sözleşmesi içinde düzenler. Play valid ama dirty macro'nun immutable in-memory snapshot'ını kullanır. Step/Play Selected seçimi tam safe unit'e genişletir; Play From Here yalnız safe boundary kabul eder. Aktif session kontrolleri ve progress popup ile aynı playback service'ten gelir. Önceki erteleme Phase 4 ile kapanmıştır; tam sözleşme [PLAYBACK.md](PLAYBACK.md) içindedir.
