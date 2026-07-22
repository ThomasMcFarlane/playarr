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

    CommonBack("Back", "ย้อนกลับ", "戻る"),
    CommonCancel("Cancel", "ยกเลิก", "キャンセル"),
    CommonClose("Close", "ปิด", "閉じる"),
    CommonTryAgain("Try again", "ลองอีกครั้ง", "もう一度試す"),
    WorkKindMovie("Movie", "ภาพยนตร์", "映画"),
    WorkKindSeries("Series", "ซีรีส์", "シリーズ"),
    WorkKindSite("Site", "ไซต์", "サイト"),
    WorkKindArtist("Artist", "ศิลปิน", "アーティスト"),
    WorkKindAuthor("Author", "นักเขียน", "著者"),
    WorkKindMovies("Movies", "ภาพยนตร์", "映画"),
    WorkKindSites("Sites", "ไซต์", "サイト"),
    WorkKindMusic("Music", "เพลง", "音楽"),
    WorkKindBooks("Books", "หนังสือ", "書籍"),

    HomePreparing("Preparing home", "กำลังเตรียมหน้าแรก", "ホームを準備しています"),
    HomeEmptyTitle(
        "Your home screen is waiting for its first title",
        "หน้าแรกของคุณกำลังรอเรื่องแรก",
        "ホーム画面には最初のタイトルがまだありません",
    ),
    HomeEmptyDescription(
        "Available films, series and sites will appear here after the next sync.",
        "ภาพยนตร์ ซีรีส์ และไซต์ที่พร้อมใช้งานจะปรากฏที่นี่หลังการซิงค์ครั้งถัดไป",
        "次回の同期後、視聴可能な映画、シリーズ、サイトがここに表示されます。",
    ),
    HomeNoSynopsis("No synopsis is available.", "ไม่มีเรื่องย่อ", "あらすじはありません。"),
    HomeDefaultGenre("Your library", "ไลบรารีของคุณ", "あなたのライブラリ"),
    HomeEpisodeLabel("Episode {{number}}", "ตอนที่ {{number}}", "エピソード{{number}}"),
    HomeEpisodeProvider(
        "{{title}} · S{{season}} E{{episode}}",
        "{{title}} · S{{season}} E{{episode}}",
        "{{title}}・S{{season}} E{{episode}}",
    ),
    HomeKindGenre("{{kind}} · {{genre}}", "{{kind}} · {{genre}}", "{{kind}}・{{genre}}"),
    HomeRailOnDeck("On deck", "กำลังดูอยู่", "続きを見る"),
    HomeRailStartWatching("Start watching", "เริ่มดู", "視聴を開始"),
    HomeRailNewMovies("New movies", "ภาพยนตร์ใหม่", "新着映画"),
    HomeRailNewSeries("New series", "ซีรีส์ใหม่", "新着シリーズ"),
    HomeRailNewSites("New sites", "ไซต์ใหม่", "新着サイト"),
    HomeRailMoreMovies("More movies", "ภาพยนตร์เพิ่มเติม", "その他の映画"),
    HomeRailMoreSeries("More series", "ซีรีส์เพิ่มเติม", "その他のシリーズ"),
    HomeRailMoreSites("More sites", "ไซต์เพิ่มเติม", "その他のサイト"),

    LibraryCollectionArtists("artists", "ศิลปิน", "アーティスト"),
    LibraryCollectionTitles("titles", "เรื่อง", "タイトル"),
    LibraryCollectionCount(
        "{{count}} {{collection}}",
        "{{count}} {{collection}}",
        "{{count}}件の{{collection}}",
    ),
    LibraryLoading("Loading {{label}}", "กำลังโหลด {{label}}", "{{label}}を読み込んでいます"),
    LibraryEmptyTitle(
        "No playable {{plural}} yet",
        "ยังไม่มี{{plural}}ที่เล่นได้",
        "再生可能な{{plural}}はまだありません",
    ),
    LibraryEmptyDescription(
        "Available {{collection}} will appear here after your library is updated.",
        "{{collection}}ที่พร้อมใช้งานจะปรากฏที่นี่หลังไลบรารีของคุณอัปเดต",
        "ライブラリが更新されると、利用可能な{{collection}}がここに表示されます。",
    ),
    LibraryFilters("Filters", "ตัวกรอง", "フィルター"),
    LibraryCloseFilters("Close filters", "ปิดตัวกรอง", "フィルターを閉じる"),
    LibraryView("View", "มุมมอง", "表示"),
    LibraryViewCoverFlow("Cover Flow", "Cover Flow", "Cover Flow"),
    LibraryViewList("list", "รายการ", "リスト"),
    LibraryViewScreen("screen", "หน้าจอ", "スクリーン"),
    LibraryViewCover("cover", "ปก", "カバー"),
    LibraryArtworkSize("Artwork size", "ขนาดภาพปก", "アートワークサイズ"),
    LibrarySizeSmall("small", "เล็ก", "小"),
    LibrarySizeMedium("medium", "กลาง", "中"),
    LibrarySizeLarge("large", "ใหญ่", "大"),
    LibrarySortBy("Sort by", "เรียงตาม", "並べ替え"),
    LibrarySortTitle("Title", "ชื่อเรื่อง", "タイトル"),
    LibrarySortDateAdded("Date added", "วันที่เพิ่ม", "追加日"),
    LibraryOrder("Order", "ลำดับ", "順序"),
    LibrarySortAscAlpha("A-Z", "A-Z", "A-Z"),
    LibrarySortAscDate("Oldest first", "เก่าสุดก่อน", "古い順"),
    LibrarySortDescAlpha("Z-A", "Z-A", "Z-A"),
    LibrarySortDescDate("Newest first", "ใหม่สุดก่อน", "新しい順"),

    SearchTitle("Search", "ค้นหา", "検索"),
    SearchAll("All", "ทั้งหมด", "すべて"),
    SearchFilterMovies("Movies", "ภาพยนตร์", "映画"),
    SearchFilterSeries("Series", "ซีรีส์", "シリーズ"),
    SearchFilterSites("Sites", "ไซต์", "サイト"),
    SearchFilterMusic("Music", "เพลง", "音楽"),
    SearchFilterPlaylists("Playlists", "เพลย์ลิสต์", "プレイリスト"),
    SearchResultCountOne("{{count}} result", "{{count}} ผลลัพธ์", "{{count}}件の結果"),
    SearchResultCountOther("{{count}} results", "{{count}} ผลลัพธ์", "{{count}}件の結果"),
    SearchSearching("Searching…", "กำลังค้นหา…", "検索しています…"),
    SearchZeroResults("0 results", "0 ผลลัพธ์", "0件の結果"),
    SearchPlaceholder(
        "Search your libraries and playlists",
        "ค้นหาไลบรารีและเพลย์ลิสต์ของคุณ",
        "ライブラリとプレイリストを検索",
    ),
    SearchClear("Clear", "ล้าง", "クリア"),
    SearchFilters("Filters", "ตัวกรอง", "フィルター"),
    SearchLibraryFilter(" · {{library}}", " · {{library}}", " ・{{library}}"),
    SearchAllLibraries("All libraries", "ทุกไลบรารี", "すべてのライブラリ"),
    SearchType("Type", "ประเภท", "種類"),
    SearchLibrary("Library", "ไลบรารี", "ライブラリ"),
    SearchSystemPlaylist("System playlist", "เพลย์ลิสต์ระบบ", "システムプレイリスト"),
    SearchPlaylist("Playlist", "เพลย์ลิสต์", "プレイリスト"),
    SearchNoSynopsis("No synopsis is available.", "ไม่มีเรื่องย่อ", "あらすじはありません。"),
    SearchIdleTitle(
        "Start typing to search.",
        "เริ่มพิมพ์เพื่อค้นหา",
        "入力を開始して検索してください。",
    ),
    SearchEmptyPrompt(
        "Find any available movie, series, artist or playlist.",
        "ค้นหาภาพยนตร์ ซีรีส์ ศิลปิน หรือเพลย์ลิสต์ที่มีอยู่",
        "利用可能な映画、シリーズ、アーティスト、プレイリストを検索できます。",
    ),
    SearchNoResultsTitle(
        "No matching titles or playlists.",
        "ไม่พบเรื่องหรือเพลย์ลิสต์ที่ตรงกัน",
        "一致するタイトルやプレイリストがありません。",
    ),
    SearchNoResultsDescription(
        "Try another title or adjust the filters.",
        "ลองเรื่องอื่นหรือปรับตัวกรอง",
        "別のタイトルを試すか、フィルターを調整してください。",
    ),

    ContextOpen("Open", "เปิด", "開く"),
    ContextAddToPlaylist("Add to Playlist", "เพิ่มลงในเพลย์ลิสต์", "プレイリストに追加"),
    ContextDownload("Download", "ดาวน์โหลด", "ダウンロード"),
    ContextResolving("Resolving…", "กำลังค้นหารายการ…", "項目を確認しています…"),
    ContextMarkWatched("Mark as Watched", "ทำเครื่องหมายว่าดูแล้ว", "視聴済みにする"),
    ContextMarkUnwatched("Mark as Unwatched", "ทำเครื่องหมายว่ายังไม่ได้ดู", "未視聴にする"),
    ContextAddToPlaylistHeading("Add to playlist", "เพิ่มลงในเพลย์ลิสต์", "プレイリストに追加"),
    ContextNoPersonalPlaylistsTitle(
        "No personal playlists yet",
        "ยังไม่มีเพลย์ลิสต์ส่วนตัว",
        "個人のプレイリストはまだありません",
    ),
    ContextNoPersonalPlaylistsDescription(
        "Create one from the Playlists page.",
        "สร้างเพลย์ลิสต์ได้จากหน้าเพลย์ลิสต์",
        "プレイリストページから作成してください。",
    ),

    DetailLoadingDetails("Loading details", "กำลังโหลดรายละเอียด", "詳細を読み込んでいます"),
    DetailNoSynopsis("No synopsis is available.", "ไม่มีเรื่องย่อ", "あらすじはありません。"),
    DetailNoEpisodeSynopsis(
        "No episode synopsis is available.",
        "ไม่มีเรื่องย่อของตอนนี้",
        "このエピソードのあらすじはありません。",
    ),
    DetailResumeFrom("Resume from {{position}}", "เล่นต่อจาก {{position}}", "{{position}}から再開"),
    DetailNoPlayableMedia("No playable media", "ไม่มีสื่อที่เล่นได้", "再生可能なメディアがありません"),
    DetailPlay("Play", "เล่น", "再生"),
    DetailPlayback("Playback", "การเล่น", "再生"),
    DetailDownloadTitle("Download {{title}}", "ดาวน์โหลด {{title}}", "{{title}} をダウンロード"),
    DetailPlaybackSettingsTitle("Playback settings", "การตั้งค่าการเล่น", "再生設定"),
    DetailQuality("Quality", "คุณภาพ", "画質"),
    DetailAudio("Audio", "เสียง", "音声"),
    DetailAutomatic("Automatic", "อัตโนมัติ", "自動"),
    DetailSubtitles("Subtitles", "คำบรรยาย", "字幕"),
    DetailSubtitlesOff("Off", "ปิด", "オフ"),
    DetailSave("Save", "บันทึก", "保存"),
    DetailTitleSeasonsAndEpisodes(
        "{{title}} seasons and episodes",
        "ซีซันและตอนของ {{title}}",
        "{{title}}のシーズンとエピソード",
    ),
    DetailSeasonNumber("Season {{number}}", "ซีซัน {{number}}", "シーズン{{number}}"),
    DetailEpisodeNumber("Episode {{number}}", "ตอนที่ {{number}}", "エピソード{{number}}"),
    DetailRuntimeMinutes("{{minutes}} min", "{{minutes}} นาที", "{{minutes}}分"),
    DetailRuntimeHours("{{hours}}h", "{{hours}} ชม.", "{{hours}}時間"),
    DetailRuntimeHoursMinutes(
        "{{hours}}h {{minutes}}m",
        "{{hours}} ชม. {{minutes}} นาที",
        "{{hours}}時間{{minutes}}分",
    ),
    DetailUnavailable("Unavailable", "ไม่พร้อมใช้งาน", "利用できません"),
    DetailChapters("Chapters", "บท", "チャプター"),
    DetailChapterNumber("Chapter {{number}}", "บทที่ {{number}}", "チャプター{{number}}"),
    DetailCast("Cast", "นักแสดง", "キャスト"),
    DetailSimilarTitles("Similar Titles", "เรื่องที่คล้ายกัน", "似ているタイトル"),
    DetailPlaybackSaved(
        "Playback settings saved.",
        "บันทึกการตั้งค่าการเล่นแล้ว",
        "再生設定を保存しました。",
    ),

    ServerChoiceAvailable("Available on {{count}} servers", "พร้อมใช้งานบน {{count}} เซิร์ฟเวอร์", "{{count}}台のサーバーで利用可能"),
    ServerChoiceWhere(
        "Where should Playarr play {{title}}?",
        "ต้องการให้ Playarr เล่น {{title}} จากที่ไหน?",
        "Playarrは{{title}}をどのサーバーで再生しますか?",
    ),
    ServerChoiceChoose(
        "Choose the server to connect to for this playback session.",
        "เลือกเซิร์ฟเวอร์ที่จะเชื่อมต่อสำหรับการเล่นครั้งนี้",
        "この再生セッションで接続するサーバーを選択してください。",
    ),
    ServerChoiceConnecting("Connecting…", "กำลังเชื่อมต่อ…", "接続しています…"),
    ServerChoiceLoading(
        "Loading available servers…",
        "กำลังโหลดเซิร์ฟเวอร์ที่พร้อมใช้งาน…",
        "利用可能なサーバーを読み込んでいます…",
    ),

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
