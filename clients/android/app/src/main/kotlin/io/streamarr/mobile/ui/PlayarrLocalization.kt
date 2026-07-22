package io.streamarr.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import java.util.Locale

internal enum class PlayarrResolvedLanguage(val code: String) {
    English("en"),
    Thai("th"),
    Japanese("ja"),
    ;

    val locale: Locale get() = Locale.forLanguageTag(code)
}

internal enum class PlayarrString(
    val english: String,
    val thai: String,
    val japanese: String,
) {
    LanguageTitle("Language", "ภาษา", "言語"),
    LanguageAuto("Auto", "อัตโนมัติ", "自動"),
    LanguageAppLabel("App language", "ภาษาของแอป", "アプリの言語"),

    LoginKicker("Welcome home", "ยินดีต้อนรับกลับบ้าน", "おかえりなさい"),
    LoginHeading("Sign in to Playarr", "เข้าสู่ระบบ Playarr", "Playarrにサインイン"),
    LoginDescription(
        "Choose your Streamarr server, then save this profile on the current device.",
        "เลือกเซิร์ฟเวอร์ Streamarr ของคุณ แล้วบันทึกโปรไฟล์นี้ไว้บนอุปกรณ์เครื่องนี้",
        "Streamarrサーバーを選択し、この端末にプロフィールを保存してください。",
    ),
    LoginServerUrl("Server URL", "URL เซิร์ฟเวอร์", "サーバーURL"),
    LoginDirectConnectionHint(
        "Your device connects directly to this server. Playarr does not proxy your login.",
        "อุปกรณ์ของคุณเชื่อมต่อกับเซิร์ฟเวอร์นี้โดยตรง Playarr ไม่ได้เป็นตัวกลางในการเข้าสู่ระบบของคุณ",
        "端末はこのサーバーに直接接続します。Playarrはログイン情報を中継しません。",
    ),
    LoginUsername("Username", "ชื่อผู้ใช้", "ユーザー名"),
    LoginPassword("Password", "รหัสผ่าน", "パスワード"),
    LoginSubmit("Sign in", "เข้าสู่ระบบ", "サインイン"),
    LoginInvalidServer(
        "Enter a valid Streamarr server address.",
        "กรุณาป้อนที่อยู่เซิร์ฟเวอร์ Streamarr ที่ถูกต้อง",
        "有効なStreamarrサーバーのアドレスを入力してください。",
    ),
    LoginMissingCredentials(
        "This server requires a username and password to sign in.",
        "เซิร์ฟเวอร์นี้ต้องใช้ชื่อผู้ใช้และรหัสผ่านในการเข้าสู่ระบบ",
        "このサーバーへのサインインにはユーザー名とパスワードが必要です。",
    ),
    LoginRejected(
        "Sign-in failed. Check your username and password and try again.",
        "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบชื่อผู้ใช้และรหัสผ่านแล้วลองอีกครั้ง",
        "サインインに失敗しました。ユーザー名とパスワードを確認してもう一度お試しください。",
    ),
    LoginForbidden(
        "This account cannot sign in on this device.",
        "บัญชีนี้ไม่สามารถเข้าสู่ระบบบนอุปกรณ์เครื่องนี้ได้",
        "このアカウントはこの端末ではサインインできません。",
    ),
    LoginConnectionFailed(
        "Couldn’t connect to that Streamarr server. Check the address and try again.",
        "เชื่อมต่อกับเซิร์ฟเวอร์ Streamarr ไม่สำเร็จ กรุณาตรวจสอบที่อยู่แล้วลองอีกครั้ง",
        "Streamarrサーバーに接続できませんでした。アドレスを確認してもう一度お試しください。",
    ),

    DeviceLoginKicker("Sign in on another device", "เข้าสู่ระบบบนอุปกรณ์อื่น", "他のデバイスでサインイン"),
    DeviceLoginTitle("Link this TV", "เชื่อมโยงทีวีเครื่องนี้", "このテレビを連携"),
    DeviceLoginCreatingCode(
        "Creating a secure sign-in code…",
        "กำลังสร้างรหัสเข้าสู่ระบบที่ปลอดภัย…",
        "安全なサインインコードを作成しています…",
    ),
    DeviceLoginInstructions(
        "Scan the QR code, or visit {{url}} and enter this code.",
        "สแกนคิวอาร์โค้ด หรือไปที่ {{url}} แล้วป้อนรหัสนี้",
        "QRコードを読み取るか、{{url}}にアクセスしてこのコードを入力してください。",
    ),
    DeviceLoginPairingCode("Pairing code {{code}}", "รหัสจับคู่ {{code}}", "ペアリングコード {{code}}"),
    DeviceLoginWaitingApproval("Waiting for approval…", "กำลังรอการอนุมัติ…", "承認をお待ちください…"),
    DeviceLoginTryAgain("Try again", "ลองอีกครั้ง", "もう一度試す"),
    DeviceLoginQrLabel(
        "QR code for the Playarr TV sign-in link",
        "คิวอาร์โค้ดสำหรับลิงก์เข้าสู่ระบบ Playarr TV",
        "Playarr TVサインインリンクのQRコード",
    ),

    NavDownloads("Downloads", "ดาวน์โหลด", "ダウンロード"),
    NavSearch("Search", "ค้นหา", "検索"),
    NavHome("Home", "หน้าแรก", "ホーム"),
    NavSeries("Series", "ซีรีส์", "シリーズ"),
    NavMovies("Movies", "ภาพยนตร์", "映画"),
    NavSites("Sites", "ไซต์", "サイト"),
    NavMusic("Music", "เพลง", "音楽"),
    NavPlaylists("Playlists", "เพลย์ลิสต์", "プレイリスト"),

    SettingsTitle("Preferences", "การตั้งค่า", "環境設定"),
    SettingsAppearance("Appearance", "ลักษณะที่ปรากฏ", "外観"),
    SettingsAvatar("Profile avatar", "รูปโปรไฟล์", "プロフィールアバター"),
    SettingsLanguage("Language", "ภาษา", "言語"),
    SettingsPlayer("Player", "เครื่องเล่น", "プレイヤー"),
    SettingsServer("Server connection", "การเชื่อมต่อเซิร์ฟเวอร์", "サーバー接続"),
    SettingsProfileLock("Profile lock", "การล็อกโปรไฟล์", "プロフィールロック"),
    SettingsInvite("Invite a friend", "เชิญเพื่อน", "友達を招待"),

    ProfileViewerFallback("Viewer", "ผู้ชม", "視聴者"),
    ProfileControl("Profiles for {{name}}", "โปรไฟล์สำหรับ {{name}}", "{{name}}のプロフィール"),
}

@Immutable
internal data class PlayarrLanguageState(
    val preference: String,
    val resolved: PlayarrResolvedLanguage,
) {
    val locale: Locale get() = resolved.locale

    fun text(key: PlayarrString, parameters: Map<String, Any> = emptyMap()): String {
        val template = when (resolved) {
            PlayarrResolvedLanguage.English -> key.english
            PlayarrResolvedLanguage.Thai -> key.thai
            PlayarrResolvedLanguage.Japanese -> key.japanese
        }
        return interpolatePlayarrTranslation(template, parameters)
    }
}

internal val LocalPlayarrLanguage = compositionLocalOf {
    PlayarrLanguageState("system", PlayarrResolvedLanguage.English)
}

internal fun parsePlayarrLanguagePreference(value: String?): String =
    value?.takeIf { it in setOf("system", "en", "th", "ja") } ?: "system"

internal fun resolvePlayarrLanguage(
    preference: String,
    systemLanguageTags: List<String>,
): PlayarrResolvedLanguage {
    val explicit = when (parsePlayarrLanguagePreference(preference)) {
        "en" -> PlayarrResolvedLanguage.English
        "th" -> PlayarrResolvedLanguage.Thai
        "ja" -> PlayarrResolvedLanguage.Japanese
        else -> null
    }
    if (explicit != null) return explicit
    return systemLanguageTags.firstNotNullOfOrNull { tag ->
        when (tag.substringBefore('-').substringBefore('_').lowercase(Locale.ROOT)) {
            "en" -> PlayarrResolvedLanguage.English
            "th" -> PlayarrResolvedLanguage.Thai
            "ja" -> PlayarrResolvedLanguage.Japanese
            else -> null
        }
    } ?: PlayarrResolvedLanguage.English
}

internal fun interpolatePlayarrTranslation(
    template: String,
    parameters: Map<String, Any>,
): String = PlayarrInterpolationPattern.replace(template) { match ->
    parameters[match.groupValues[1]]?.toString() ?: match.value
}

private val PlayarrInterpolationPattern = "\\{\\{(\\w+)\\}\\}".toRegex()

@Composable
internal fun rememberPlayarrLanguageState(preference: String): PlayarrLanguageState {
    val locales = LocalConfiguration.current.locales
    val languageTags = remember(locales) { (0 until locales.size()).map { locales[it].toLanguageTag() } }
    val normalisedPreference = parsePlayarrLanguagePreference(preference)
    return remember(normalisedPreference, languageTags) {
        PlayarrLanguageState(normalisedPreference, resolvePlayarrLanguage(normalisedPreference, languageTags))
    }
}

@Composable
internal fun playarrString(key: PlayarrString, vararg parameters: Pair<String, Any>): String =
    LocalPlayarrLanguage.current.text(key, parameters.toMap())

internal data class PlayarrUiLanguageOption(val preference: String, val nativeName: String?)

internal val playarrUiLanguageOptions = listOf(
    PlayarrUiLanguageOption("system", null),
    PlayarrUiLanguageOption("en", "English"),
    PlayarrUiLanguageOption("th", "ไทย"),
    PlayarrUiLanguageOption("ja", "日本語"),
)

@Composable
internal fun PlayarrUiLanguageOption.label(): String = nativeName ?: playarrString(PlayarrString.LanguageAuto)
