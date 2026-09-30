# ZUI Macro Recorder for Chrome — Quick Guide

## Record

Popup'ı açın, **Select current tab**, makro adı ve **Record** sırasını izleyin. Kayıt göstergesi ve sayaç aktif kalır; popup kapanırsa kayıt service worker üzerinden devam eder. **Pause/Resume**, **Stop** ve iptal onayı bulunan **Cancel** kullanılabilir.

## Edit and validate

**Library & Editor** sayfasında bir makroyu **Edit** ile açın. Event satırlarını ekleyin, silin, çoğaltın, taşıyın veya Raw JSON'da düzenleyin. `0..1` koordinat hassasiyeti canonical JSON'da korunur. Validation problemi varsa hata satırındaki **Go to row** kullanılır; geçersiz makro kaydedilemez veya oynatılamaz.

Bir Delay satırında istediğiniz milisaniye değerini girip **Apply value to all delays** seçeneğini kullanarak makrodaki bütün Delay satırlarını tek işlemde güncelleyebilirsiniz. Diğer event türleri ile Delay satırlarının label/enabled alanları değişmez. Toplu değişiklik tek **Undo** ile geri alınabilir ve playback aktifken kullanılamaz.

## Replay and loop

Önce hedef sekmeyi açıkça seçin. Hız, repeat ve loop delay makroya kaydedilebilir. Repeat `0` sonsuzdur; **Stop** veya Chrome Stop kısayolu ile sonlandırın. Global → Macro → Current Session sırası uygulanır; son katman önceki değeri override eder ve Stop on Error daima açıktır.

## Import, export and another profile

Tek makro için **Import macro/Export**, tüm kütüphane için **Back up library/Restore backup** kullanın. Backup şeması `1.0`'dır. Restore, üst seviye backup şemasını ve privacy sınırını atomik doğrular; geçerli makroları kısmi restore eder, geçersizleri reddeder. ID/ad çakışmasında Keep Both (benzersiz ad), Replace veya Skip seçilir. Yeni profilde hedef tab yeniden seçilmelidir.

## Errors and diagnostics

UI kullanıcı dostu başlık, açıklama, teknik kod ve güvenli kurtarma eylemi gösterir. Settings > Diagnostics içinden redacted rapor dışa aktarılabilir veya geçmiş temizlenebilir. Şifre, OTP, typed secret, cookie, token, hesap ve profil verisi rapora ya da backup'a yazılmaz.

## Permissions

- `storage`: ayarlar ve yerel macro library.
- `tabs`: kullanıcının seçtiği hedef sekmeyi bulmak/odaklamak.
- `offscreen`: güvenilir playback zamanlaması.
- `debugger`: yalnız seçili sekmeye keyboard/text/select/wheel input göndermek.
- `webNavigation`: hedef origin değişimini fail-closed algılamak.
- `scripting`: yalnız izin verilmiş seçili target tab'a ZUI recorder runtime'ını kurmak.

## Site permissions

- Site erişimi kurulum sırasında değil, kullanıcı **Select current tab** dediğinde yalnız o HTTP/HTTPS site için istenir.
- Bir siteye izin verilmesi başka bir siteyi yetkilendirmez.
- İzin reddedilirse hedef seçilmez. İzin sonradan kaldırılırsa kayıt/playback fail-closed durur ve site yeniden seçilmelidir.
- **Settings > Site access** altında erişilebilen siteler görülebilir ve aktif işlem yokken **Remove access** ile kaldırılabilir.
- Macro JSON ve library backup site izni içermez. Başka Chrome profiline taşınan makro için hedef site yeniden seçilir ve izin yeniden verilir.

Uzantı Windows seviyesinde input göndermez, telemetry/cloud/account servisi kullanmaz. Closed Shadow DOM, cross-origin iframe ve bazı hidden CDP inputları bilinen sınırlardır.
