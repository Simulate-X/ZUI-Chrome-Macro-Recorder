# Phase 1D — Gerçek Huuge Input Uyumluluğu

## Sonuç özeti

**Durum: `BLOCKED_BY_ENV` — gerçek hedef yüklenemedi; input backend kapısı kapanmadı.**

23 Eylül 2026 tarihinde kullanıcının normal günlük Chrome profili ve manuel yüklenmiş ZUI Macro Recorder extension'ı ile gerçek Huuge Casino Web Edition hedefi açılmaya çalışıldı. Hem `https://play.billionaire-casino.com/` hem de `https://play.huuugecasino.com/index.html` Chrome'da `ERR_CONNECTION_RESET` ile başarısız oldu.

Bağımsız ağ preflight'ı iki host için DNS çözümlemesi ve TCP/443 bağlantısının başarılı olduğunu, fakat TLS el sıkışmasının HTTP yanıtı alınmadan karşı tarafça sıfırlandığını doğruladı. Bu kırılma noktası content script, `DOM_SYNTHETIC`, `chrome.debugger`, CDP Input ve hedef sayfa JavaScript'i devreye girmeden öncedir.

Bu nedenle bu koşu:

- `DOM_SYNTHETIC` backend'ini reddetmez veya kabul etmez;
- CDP fallback'ini gerektiriyor sonucunu üretmez;
- Huuge surface/frame/geometri modelini kanıtlamaz;
- Phase 2 Recorder'a geçiş izni vermez.

## Güvenlik sınırı

- Gerçek para, bahis, spin, claim, satın alma, Club action veya geri döndürülemez oyun eylemi yapılmadı.
- Huuge UI yüklenmediği için hiçbir programatik mouse/keyboard event'i gönderilmedi.
- Windows mouse/keyboard otomasyonu kullanılmadı.
- `debugger` izni eklenmedi ve hiçbir CDP oturumu attach edilmedi.
- Kullanıcı profili, hesap/oturum verisi, cookie veya hassas değer loglanmadı.

## Test ortamı

| Alan | Değer |
|---|---|
| Tarih | 2026-09-23 |
| Tarayıcı profili | Kullanıcının normal günlük Chrome profili |
| Extension | Manuel yüklenmiş `ZUI Macro Recorder PoC 0.1.0` |
| Extension kimliği | `hcjbilbokehlhimkaccamckdkpgamiha` |
| Başlangıç commit'i | `138d867 feat: validate chrome hidden-tab playback timing` |
| Çalışma ağacı | Test başlangıcında temiz `main` |
| Scheduler | `OFFSCREEN_DOCUMENT`; değiştirilmedi |

## Erişim kanıtı ve kırılma noktası

| Kontrol | Billionaire hedefi | Huuge hedefi |
|---|---|---|
| DNS A kaydı | Çözümlendi | Çözümlendi |
| TCP/443 | Başarılı | Başarılı |
| TLS handshake | Bağlantı sıfırlandı | Bağlantı sıfırlandı |
| HTTP yanıtı | Alınamadı | Alınamadı |
| Normal Chrome | `ERR_CONNECTION_RESET` | `ERR_CONNECTION_RESET` |
| Huuge uygulama yüklemesi | Başlamadı | Başlamadı |

Sınıflandırma: **browser/network precondition — TLS öncesi/handshake sırasında remote reset**. Bu sonuç site tarafı erişim politikası, ağ yolu veya geçici servis durumu arasında daha ileri bir ayrım yapmaz. Kanıt yalnız hatanın extension input katmanından önce oluştuğunu kesinleştirir.

## İstenen Phase 1D matrisi

| Alan | Sonuç |
|---|---|
| Huuge target surface tipi | `UNKNOWN / NOT OBSERVED` |
| Top-level DOM / canvas / WebGL / iframe | `NOT OBSERVED` |
| Bounding rect, viewport, DPR, zoom/transform | `NOT OBSERVED` |
| `DOM_SYNTHETIC` üç tekrar | `NOT EXERCISED` — hedef yüklenmedi |
| `isTrusted` gerçek-target gözlemi | `NOT EXERCISED` |
| Keyboard smoke test | `NOT EXERCISED` |
| CDP gerekliliği | `UNDETERMINED` — DOM sonucu yok |
| CDP PoC | `NOT STARTED` — güçlü izin gereksiz yere eklenmedi |
| Real-target normalized coordinate resize | `NOT EXERCISED` |
| Target-tab-close fail-safe | Mevcut kod/test sözleşmesi korunuyor; bu koşuda gerçek Huuge üzerinde çalıştırılmadı |

## Mimari karar

- Scheduler kararı değişmedi: **`OFFSCREEN_DOCUMENT`** yalnız playback zamanlamasının sahibidir.
- Input backend kararı hâlâ açıktır: **`DOM_SYNTHETIC` aday**, CDP yalnız gerçek hedefte DOM kabulü yetersiz kalırsa fallback adayıdır.
- Manifest'e Huuge host permission veya `debugger` izni eklenmedi; çalışan ve ölçülebilir hedef olmadan yetki genişletilmedi.
- Phase 2 Recorder başlatılmadı.

## Regresyon doğrulamaları

| Kontrol | Sonuç |
|---|---|
| Unit: normalize koordinat ve makro şeması | 6/6 geçti |
| Yerel uçtan uca PoC | Geçti; DOM synthetic mouse/keyboard, resize mapping ve `isTrusted=false` doğrulandı |
| Target-tab-close fail-safe | Geçti |
| Phase 1B timing regresyonu | Geçti; foreground ve unfocused-visible 100/200/500 ms matrisi |
| Phase 1C fixture server smoke | HTTP 200 ve hedef surface bulundu |
| JavaScript sözdizimi | Tüm `extension`, `tests` ve `demo` `.js`/`.mjs` dosyaları geçti |
| `git diff --check` | Geçti |

Günlük profil gerçek hidden-tab Phase 1C matrisi bu turda yeniden yürütülmedi; kanonik kanıt `PHASE_1C_RESULTS.md` içinde korunuyor. Phase 1D için yeni backend testi eklenmedi, çünkü gerçek hedef input katmanına ulaşılamadı ve backend kodu değiştirilmedi.

## Yeniden deneme kapısı

Phase 1D aşağıdaki koşullar sağlandığında yeniden çalıştırılmalıdır:

1. Normal Chrome profilinde Huuge lobby tamamen yüklenir ve görünür olur.
2. Kullanıcı oturumu manuel olarak hazırdır; otomasyon login/CAPTCHA/yaş doğrulaması yapmaz.
3. Spin, bahis, satın alma, claim veya Club action olmayan geri döndürülebilir bir UI hedefi seçilebilir.
4. Önce read-only topoloji/geometri kaydı, ardından `DOM_SYNTHETIC` ile en az üç gözlenebilir UI davranışı denenir.
5. Yalnız DOM davranışı gerçekten oluşmazsa ayrı CDP adapter/izin PoC'sine geçilir.

Faz 1 kabul kriterleri karşılanmış değildir. **Phase 2 Recorder'a geçmeye hazır değiliz.**
