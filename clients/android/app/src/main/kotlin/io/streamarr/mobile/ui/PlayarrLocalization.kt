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
    CommonDone("Done", "เสร็จสิ้น", "完了"),
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
    ContextDownloadCount(
        "Download {{count}} items",
        "ดาวน์โหลด {{count}} รายการ",
        "{{count}} 件をダウンロード",
    ),
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

    PlaylistsTitle("Playlists", "เพลย์ลิสต์", "プレイリスト"),
    PlaylistsLoading("Loading playlists", "กำลังโหลดเพลย์ลิสต์", "プレイリストを読み込んでいます"),
    PlaylistsPreparing("Preparing playlists", "กำลังเตรียมเพลย์ลิสต์", "プレイリストを準備しています"),
    PlaylistsCountOne("{{count}} playlist", "{{count}} เพลย์ลิสต์", "{{count}}件のプレイリスト"),
    PlaylistsCountOther("{{count}} playlists", "{{count}} เพลย์ลิสต์", "{{count}}件のプレイリスト"),
    PlaylistsShared("Shared", "แชร์แล้ว", "共有"),
    PlaylistsPersonal("Personal", "ส่วนตัว", "個人"),
    PlaylistsItemCountOne("{{count}} title", "{{count}} เรื่อง", "{{count}}件のタイトル"),
    PlaylistsItemCountOther("{{count}} titles", "{{count}} เรื่อง", "{{count}}件のタイトル"),
    PlaylistsFolderCountOne("{{count}} folder", "{{count}} โฟลเดอร์", "{{count}}件のフォルダ"),
    PlaylistsFolderCountOther("{{count}} folders", "{{count}} โฟลเดอร์", "{{count}}件のフォルダ"),
    PlaylistsNoMatchingTitle(
        "No matching top-level playlists",
        "ไม่พบเพลย์ลิสต์ระดับบนสุดที่ตรงกัน",
        "一致する最上位のプレイリストがありません",
    ),
    PlaylistsNoMatchingDescription(
        "Change the filters or open a nested playlist from Search.",
        "เปลี่ยนตัวกรองหรือเปิดเพลย์ลิสต์ย่อยจากการค้นหา",
        "フィルターを変更するか、検索からネストされたプレイリストを開いてください。",
    ),
    PlaylistsNoneYetTitle("No playlists yet", "ยังไม่มีเพลย์ลิสต์", "プレイリストはまだありません"),
    PlaylistsCreateCollectionDescription(
        "Create a playlist to begin building your collection.",
        "สร้างเพลย์ลิสต์เพื่อเริ่มสร้างคอลเลกชันของคุณ",
        "プレイリストを作成してコレクションを作り始めましょう。",
    ),
    PlaylistsCreate("Create", "สร้าง", "作成"),
    PlaylistsCreating("Creating…", "กำลังสร้าง…", "作成しています…"),
    PlaylistsFilters("Filters", "ตัวกรอง", "フィルター"),
    PlaylistsCreateTitle("Create playlist", "สร้างเพลย์ลิสต์", "プレイリストを作成"),
    PlaylistsName("Name", "ชื่อ", "名前"),
    PlaylistsNamePlaceholder("Playlist name", "ชื่อเพลย์ลิสต์", "プレイリスト名"),
    PlaylistsNameRequired(
        "Enter a name for the playlist.",
        "กรุณาป้อนชื่อเพลย์ลิสต์",
        "プレイリストの名前を入力してください。",
    ),
    PlaylistsMediaType("Playlist type", "ประเภทเพลย์ลิสต์", "プレイリストの種類"),
    PlaylistsMediaTypeVideo("Video", "วิดีโอ", "ビデオ"),
    PlaylistsMediaTypeAudio("Audio", "เสียง", "オーディオ"),
    PlaylistsMediaTypeMismatch(
        "This Streamarr server does not support audio playlists yet. Update or restart the server, then try again.",
        "เซิร์ฟเวอร์ Streamarr นี้ยังไม่รองรับเพลย์ลิสต์เสียง โปรดอัปเดตหรือรีสตาร์ตเซิร์ฟเวอร์แล้วลองอีกครั้ง",
        "このStreamarrサーバーはまだオーディオプレイリストに対応していません。サーバーを更新または再起動してから、もう一度お試しください。",
    ),
    PlaylistsParent("Parent playlist", "เพลย์ลิสต์หลัก", "親プレイリスト"),
    PlaylistsNoParent("None - top level", "ไม่มี - ระดับบนสุด", "なし - 最上位"),
    PlaylistsControls("Playlist controls", "ตัวควบคุมเพลย์ลิสต์", "プレイリストの操作"),
    PlaylistsShow("Show", "แสดง", "表示"),
    PlaylistsVisibilityAll("all", "ทั้งหมด", "すべて"),
    PlaylistsVisibilityMine("Mine", "ของฉัน", "自分のみ"),
    PlaylistsVisibilityShared("shared", "แชร์แล้ว", "共有"),
    PlaylistsOrder("Order", "ลำดับ", "順序"),
    PlaylistsOrderAscending("A–Z", "A–Z", "A–Z"),
    PlaylistsOrderDescending("Z–A", "Z–A", "Z–A"),
    PlaylistsCreateLabel("Create playlist", "สร้างเพลย์ลิสต์", "プレイリストを作成"),
    PlaylistsFilterLabel("Filter playlists", "กรองเพลย์ลิสต์", "プレイリストを絞り込む"),
    PlaylistsOpenLabel("Open {{name}}", "เปิด {{name}}", "{{name}}を開く"),
    PlaylistsBack("Back to playlists", "กลับไปที่เพลย์ลิสต์", "プレイリストに戻る"),
    PlaylistsTrackCountOne("{{count}} track", "{{count}} แทร็ก", "{{count}}件のトラック"),
    PlaylistsTrackCountOther("{{count}} tracks", "{{count}} แทร็ก", "{{count}}件のトラック"),
    PlaylistsDirectItemsOne("Direct items · {{count}} title", "รายการโดยตรง · {{count}} เรื่อง", "直下のアイテム・{{count}}件のタイトル"),
    PlaylistsDirectItemsOther("Direct items · {{count}} titles", "รายการโดยตรง · {{count}} เรื่อง", "直下のアイテム・{{count}}件のタイトル"),
    PlaylistsEmptyTrackTitle("Nothing here yet", "ยังไม่มีอะไรที่นี่", "まだ何もありません"),
    PlaylistsEmptyTrackDescription(
        "Move a movie or series into this track from its context menu.",
        "ย้ายภาพยนตร์หรือซีรีส์มาไว้ในแทร็กนี้จากเมนูบริบท",
        "コンテキストメニューから映画またはシリーズをこのトラックに移動してください。",
    ),
    PlaylistsUnavailableTitle("Unavailable title", "ไม่มีรายการนี้", "利用できないタイトル"),
    PlaylistsItemPosition("Item {{position}}", "รายการ {{position}}", "項目 {{position}}"),
    PlaylistsCreateSubPlaylist("Create sub-playlist", "สร้างเพลย์ลิสต์ย่อย", "サブプレイリストを作成"),
    PlaylistActionsEdit("Edit name or parent", "แก้ไขชื่อหรือเพลย์ลิสต์หลัก", "名前または親を編集"),
    PlaylistActionsDelete("Delete", "ลบ", "削除"),
    PlaylistActionsSave("Save changes", "บันทึกการเปลี่ยนแปลง", "変更を保存"),
    PlaylistActionsSaving("Saving…", "กำลังบันทึก…", "保存しています…"),
    PlaylistActionsConfirmDelete("Delete playlist", "ลบเพลย์ลิสต์", "プレイリストを削除"),
    PlaylistActionsDeleting("Deleting…", "กำลังลบ…", "削除しています…"),
    PlaylistActionsDeleteDescription(
        "Delete {{name}}? Its nested playlists and every item inside them will also be deleted.",
        "ลบ {{name}} หรือไม่ เพลย์ลิสต์ย่อยและรายการทั้งหมดภายในจะถูกลบด้วย",
        "{{name}}を削除しますか？内包するプレイリストとすべての項目も削除されます。",
    ),
    PlaylistItemPlay("Play", "เล่น", "再生"),
    PlaylistItemMoveUp("Move up", "เลื่อนขึ้น", "上へ移動"),
    PlaylistItemMoveDown("Move down", "เลื่อนลง", "下へ移動"),
    PlaylistItemRemove("Remove from playlist", "นำออกจากเพลย์ลิสต์", "プレイリストから削除"),

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
    DetailPlayTitle("Play {{title}}", "เล่น {{title}}", "{{title}}を再生"),
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

    MusicTitle("Music", "เพลง", "音楽"),
    MusicBackToMusic("Back to Music", "กลับไปที่เพลง", "音楽に戻る"),
    MusicArtist("Artist", "ศิลปิน", "アーティスト"),
    MusicOverviewFallback(
        "Choose an album and track to start listening.",
        "เลือกอัลบั้มและแทร็กเพื่อเริ่มฟัง",
        "アルバムとトラックを選んで再生を開始してください。",
    ),
    MusicNoAlbumsTitle(
        "No playable albums yet",
        "ยังไม่มีอัลบั้มที่เล่นได้",
        "再生可能なアルバムはまだありません",
    ),
    MusicNoAlbumsDescription(
        "Available tracks will appear here after the music library is updated.",
        "แทร็กที่พร้อมใช้งานจะปรากฏที่นี่หลังไลบรารีเพลงอัปเดต",
        "音楽ライブラリが更新されると、利用可能なトラックがここに表示されます。",
    ),
    MusicAlbums("Albums", "อัลบั้ม", "アルバム"),
    MusicTrackSingular("track", "แทร็ก", "トラック"),
    MusicTrackPlural("tracks", "แทร็ก", "トラック"),
    MusicTrackCount("{{count}} {{unit}}", "{{count}} {{unit}}", "{{count}} {{unit}}"),
    MusicDurationUnavailable("Duration unavailable", "ไม่ทราบความยาว", "再生時間は利用できません"),
    MusicAddTrackToPlaylist(
        "Add {{title}} to playlist",
        "เพิ่ม {{title}} ลงในเพลย์ลิสต์",
        "{{title}}をプレイリストに追加",
    ),

    PlayerSeekValueText("{{position}} of {{duration}}", "{{position}} จาก {{duration}}", "{{duration}}中 {{position}}"),
    PlayerPreviousEpisode("Previous episode", "ตอนก่อนหน้า", "前のエピソード"),
    PlayerPause("Pause", "หยุดชั่วคราว", "一時停止"),
    PlayerPlay("Play", "เล่น", "再生"),
    PlayerNextEpisode("Next episode", "ตอนถัดไป", "次のエピソード"),
    PlayerAudioTrackMenuLabel("Audio track", "แทร็กเสียง", "音声トラック"),
    PlayerAudioHeading("Audio", "เสียง", "音声"),
    PlayerSubtitleTrackMenuLabel("Subtitle track", "แทร็กคำบรรยาย", "字幕トラック"),
    PlayerSubtitlesHeading("Subtitles", "คำบรรยาย", "字幕"),
    PlayerOff("Off", "ปิด", "オフ"),
    PlayerQualityMenuLabel("Playback quality", "คุณภาพการเล่น", "再生画質"),
    PlayerQualityHeading("Quality", "คุณภาพ", "画質"),
    PlayerPlaylistLabelSingular(
        "Playlist: {{count}} item",
        "เพลย์ลิสต์: {{count}} รายการ",
        "プレイリスト: {{count}}件",
    ),
    PlayerPlaylistLabelPlural(
        "Playlist: {{count}} episodes",
        "เพลย์ลิสต์: {{count}} ตอน",
        "プレイリスト: {{count}}話",
    ),
    PlayerBackToDetails("Back to details", "กลับไปที่หน้ารายละเอียด", "詳細に戻る"),
    PlayerMinimise("Minimise player", "ย่อเครื่องเล่น", "プレイヤーを最小化"),
    PlayerMinimiseLabel("Minimise", "ย่อ", "最小化"),
    PlayerClosePlaylist("Close playlist", "ปิดเพลย์ลิสต์", "プレイリストを閉じる"),
    PlayerUpNext("Up next", "ต่อไป", "次はこちら"),
    PlayerUnitTrack("track", "แทร็ก", "トラック"),
    PlayerUnitTracks("tracks", "แทร็ก", "トラック"),
    PlayerUnitItem("item", "รายการ", "件"),
    PlayerUnitEpisodes("episodes", "ตอน", "話"),
    PlayerQueueCount("{{count}} {{unit}}", "{{count}} {{unit}}", "{{count}} {{unit}}"),
    PlayerSeasonHeading("Season {{number}}", "ซีซัน {{number}}", "シーズン{{number}}"),
    PlayerSeasonEpisodeLabel(
        "S{{season}} · E{{episode}}",
        "S{{season}} · E{{episode}}",
        "S{{season}}・E{{episode}}",
    ),
    PlayerNowPlaying("Now playing", "กำลังเล่น", "再生中"),
    PlayerTrackLabel("Track", "แทร็ก", "トラック"),
    PlayerMovieLabel("Movie", "ภาพยนตร์", "映画"),
    PlayerMaximiseTitle("Maximise {{title}}", "ขยาย {{title}} เต็มจอ", "{{title}}を最大化"),
    PlayerOneMoment("One moment", "รอสักครู่", "少々お待ちください"),
    PlayerPreparingPlayback("Preparing playback", "กำลังเตรียมการเล่น", "再生を準備しています"),
    PlayerPreparingMessage(
        "Large files can take a few seconds while a stream is prepared.",
        "ไฟล์ขนาดใหญ่อาจใช้เวลาสักครู่ในการเตรียมสตรีม",
        "ファイルサイズが大きい場合、ストリームの準備に数秒かかることがあります。",
    ),
    PlayerPlaybackUnavailable("Playback unavailable", "ไม่สามารถเล่นได้", "再生できません"),
    PlayerCouldNotStart(
        "Couldn’t start this title",
        "ไม่สามารถเริ่มเล่นเรื่องนี้ได้",
        "このタイトルを再生できませんでした",
    ),

    DownloadsTitle("Downloads", "ดาวน์โหลด", "ダウンロード"),
    DownloadsOffline("Offline", "ออฟไลน์", "オフライン"),
    DownloadsEmptyTitle("No downloads yet", "ยังไม่มีการดาวน์โหลด", "ダウンロードはまだありません"),
    DownloadsEmptyDescription(
        "Download a title from its detail page to watch it without a connection.",
        "ดาวน์โหลดรายการจากหน้ารายละเอียดเพื่อดูโดยไม่ต้องเชื่อมต่ออินเทอร์เน็ต",
        "詳細ページからタイトルをダウンロードすると、接続がなくても視聴できます。",
    ),
    DownloadsActiveHeading("Active", "กำลังดำเนินการ", "進行中"),
    DownloadsNeedsAttentionHeading("Needs attention", "ต้องดำเนินการ", "要確認"),
    DownloadsCompletedHeading("Downloaded", "ดาวน์โหลดแล้ว", "ダウンロード済み"),
    DownloadsLoading("Loading downloads", "กำลังโหลดรายการดาวน์โหลด", "ダウンロードを読み込み中"),
    DownloadsStatusQueued("Queued", "รอคิว", "待機中"),
    DownloadsStatusDownloading("Downloading", "กำลังดาวน์โหลด", "ダウンロード中"),
    DownloadsStatusPaused("Paused", "หยุดชั่วคราว", "一時停止"),
    DownloadsStatusReady("Downloaded", "ดาวน์โหลดแล้ว", "ダウンロード済み"),
    DownloadsStatusFailed("Failed", "ล้มเหลว", "失敗"),
    DownloadsStatusRemoving("Removing…", "กำลังลบ…", "削除しています…"),
    DownloadsKeepForever("Keep forever", "เก็บไว้ตลอดไป", "無期限で保存"),
    DownloadsKeepUntilDate("Keep until {{date}}", "เก็บไว้ถึง {{date}}", "{{date}} まで保存"),
    DownloadsKeepAfterWatchedDays(
        "Keep {{count}} days after watched",
        "เก็บไว้ {{count}} วันหลังดูแล้ว",
        "視聴後 {{count}} 日間保存",
    ),
    DownloadsKeepAfterWatchedWeeks(
        "Keep {{count}} weeks after watched",
        "เก็บไว้ {{count}} สัปดาห์หลังดูแล้ว",
        "視聴後 {{count}} 週間保存",
    ),
    DownloadsPause("Pause", "หยุดชั่วคราว", "一時停止"),
    DownloadsResume("Resume", "ดำเนินการต่อ", "再開"),
    DownloadsCancel("Cancel", "ยกเลิก", "キャンセル"),
    DownloadsDelete("Delete", "ลบ", "削除"),
    DownloadsSave("Save", "บันทึก", "保存"),
    DownloadsEditKeepUntil(
        "Edit keep-until for {{title}}",
        "แก้ไขระยะเวลาเก็บของ {{title}}",
        "{{title}} の保存期限を編集",
    ),
    DownloadsUnknownSize("unknown size", "ไม่ทราบขนาด", "サイズ不明"),
    DownloadDrawerDialogLabel("Download {{title}}", "ดาวน์โหลด {{title}}", "{{title}} をダウンロード"),
    DownloadDrawerKicker("Offline download", "ดาวน์โหลดออฟไลน์", "オフラインダウンロード"),
    DownloadDrawerLoading("Loading download options…", "กำลังโหลดตัวเลือกดาวน์โหลด…", "ダウンロードオプションを読み込み中…"),
    DownloadDrawerLoadError(
        "Download options could not be loaded",
        "ไม่สามารถโหลดตัวเลือกดาวน์โหลดได้",
        "ダウンロードオプションを読み込めませんでした",
    ),
    DownloadDrawerNoPlayable(
        "No playable media is available for this title.",
        "ไม่มีสื่อที่เล่นได้สำหรับรายการนี้",
        "このタイトルには再生可能なメディアがありません。",
    ),
    DownloadDrawerQuality("Quality", "คุณภาพ", "画質"),
    DownloadDrawerPerItemSize(
        "{{size}} per item · {{count}} items",
        "{{size}} ต่อรายการ · {{count}} รายการ",
        "1件あたり {{size}} ・ {{count}} 件",
    ),
    DownloadDrawerKeepUntil("Keep until", "เก็บไว้จนถึง", "保存期間"),
    DownloadDrawerForever("Forever", "ตลอดไป", "無期限"),
    DownloadDrawerOnDate("On a date", "ระบุวันที่", "日付を指定"),
    DownloadDrawerAfterWatched("After watched", "หลังจากดูแล้ว", "視聴後"),
    DownloadDrawerAmount("Amount", "จำนวน", "数量"),
    DownloadDrawerDays("Days", "วัน", "日"),
    DownloadDrawerWeeks("Weeks", "สัปดาห์", "週間"),
    DownloadDrawerAfterWatchedHint(
        "Deleted from this device automatically once that much time has passed since it's marked watched.",
        "จะลบออกจากอุปกรณ์นี้โดยอัตโนมัติเมื่อครบเวลาที่กำหนดหลังจากทำเครื่องหมายว่าดูแล้ว",
        "視聴済みとしてマークされてから指定した期間が経過すると、この端末から自動的に削除されます。",
    ),
    DownloadDrawerStarting("Starting…", "กำลังเริ่ม…", "開始しています…"),
    DownloadDrawerDownload("Download", "ดาวน์โหลด", "ダウンロード"),

    SettingsTitle("Preferences", "การตั้งค่า", "環境設定"),
    SettingsAppearance("Appearance", "ลักษณะที่ปรากฏ", "外観"),
    SettingsAvatar("Profile avatar", "รูปโปรไฟล์", "プロフィールアバター"),
    SettingsLanguage("Language", "ภาษา", "言語"),
    SettingsPlayer("Player", "เครื่องเล่น", "プレイヤー"),
    SettingsServer("Server connection", "การเชื่อมต่อเซิร์ฟเวอร์", "サーバー接続"),
    SettingsProfileLock("Profile lock", "การล็อกโปรไฟล์", "プロフィールロック"),
    SettingsInvite("Invite a friend", "เชิญเพื่อน", "友達を招待"),
    SettingsAppearanceDescription(
        "Choose this device's theme and home screen artwork.",
        "เลือกธีมและภาพอาร์ตเวิร์กหน้าแรกสำหรับอุปกรณ์นี้",
        "この端末のテーマとホーム画面のアートワークを選択します。",
    ),
    SettingsColourTheme("Colour theme", "ธีมสี", "カラーテーマ"),
    SettingsThemeSystem("System", "ระบบ", "システム"),
    SettingsThemeLight("Light", "สว่าง", "ライト"),
    SettingsThemeDark("Dark", "มืด", "ダーク"),
    SettingsHomeViewTitle("Home screen artwork", "ภาพอาร์ตเวิร์กหน้าแรก", "ホーム画面のアートワーク"),
    SettingsHomeViewDescription(
        "Show portrait covers instead of wide media thumbnails on the home screen.",
        "แสดงภาพปกแนวตั้งแทนภาพขนาดย่อแนวกว้างบนหน้าแรก",
        "ホーム画面で横長のサムネイルの代わりに縦長のカバーを表示します。",
    ),
    SettingsHomeViewThumbnail("Thumbnails", "ภาพขนาดย่อ", "サムネイル"),
    SettingsHomeViewCover("Covers", "ภาพปก", "カバー"),
    SettingsThemeSaved("Theme preference saved.", "บันทึกการตั้งค่าธีมแล้ว", "テーマ設定を保存しました。"),
    SettingsHomeViewSaved("Home screen view saved.", "บันทึกรูปแบบหน้าแรกแล้ว", "ホーム画面の表示を保存しました。"),
    SettingsLanguageDescription(
        "Follow this device or keep a language fixed.",
        "ใช้ตามอุปกรณ์นี้ หรือกำหนดภาษาไว้ตายตัว",
        "この端末の設定に従うか、言語を固定できます。",
    ),
    SettingsLanguageSaved("Language preference saved.", "บันทึกการตั้งค่าภาษาแล้ว", "言語設定を保存しました。"),
    SettingsPlayerDescription(
        "Choose how Playarr should start quality, subtitles and audio.",
        "เลือกคุณภาพ คำบรรยาย และเสียงเมื่อเริ่มเล่น",
        "再生開始時の画質、字幕、音声を選択します。",
    ),
    SettingsPlayerQualityTitle("Default quality", "คุณภาพเริ่มต้น", "デフォルト画質"),
    SettingsPlayerQualityDescription(
        "Start playback at this quality when the server can provide it.",
        "เริ่มเล่นด้วยคุณภาพนี้เมื่อเซิร์ฟเวอร์รองรับ",
        "サーバーが対応している場合、この画質で再生を開始します。",
    ),
    SettingsQualityOriginal("Original", "ต้นฉบับ", "オリジナル"),
    SettingsQualityOriginalDetail(
        "Best available source",
        "แหล่งที่มาคุณภาพดีที่สุด",
        "利用可能な最高品質のソース",
    ),
    SettingsQualityLow("Low", "ต่ำ", "低"),
    SettingsQualityMedium("Medium", "กลาง", "中"),
    SettingsQualityHigh("High", "สูง", "高"),
    SettingsQualityBitrate("{{value}} Mbps", "{{value}} Mbps", "{{value}} Mbps"),
    SettingsPlayerSubtitlesTitle("Default subtitles", "คำบรรยายเริ่มต้น", "デフォルト字幕"),
    SettingsPlayerSubtitlesDescription(
        "Keep subtitles off, show forced dialogue only, or turn them on automatically.",
        "ปิดคำบรรยาย แสดงเฉพาะบทบังคับ หรือเปิดอัตโนมัติ",
        "字幕をオフ、強制字幕のみ、または常にオンに設定します。",
    ),
    SettingsPlayerSubtitlesMode("Mode", "โหมด", "モード"),
    SettingsPlayerSubtitlesOff("Off", "ปิด", "オフ"),
    SettingsPlayerSubtitlesForced("Forced only", "เฉพาะบทบังคับ", "強制字幕のみ"),
    SettingsPlayerSubtitlesAlways("Always on", "เปิดเสมอ", "常にオン"),
    SettingsPlayerSubtitleLanguage(
        "Default subtitle language",
        "ภาษาคำบรรยายเริ่มต้น",
        "デフォルト字幕言語",
    ),
    SettingsPlayerAudioTitle("Default audio track", "แทร็กเสียงเริ่มต้น", "デフォルト音声トラック"),
    SettingsPlayerAudioDescription(
        "Prefer this audio language whenever a matching track is available.",
        "เลือกภาษานี้ก่อนเมื่อมีแทร็กที่ตรงกัน",
        "一致するトラックがある場合、この音声言語を優先します。",
    ),
    SettingsPlayerAudioLanguage(
        "Default audio track language",
        "ภาษาแทร็กเสียงเริ่มต้น",
        "デフォルト音声トラックの言語",
    ),
    SettingsPlayerDeviceNote(
        "Quality and subtitle defaults are saved on this device. Audio language follows your profile.",
        "คุณภาพและคำบรรยายจะบันทึกในอุปกรณ์นี้ ภาษาเสียงจะบันทึกในโปรไฟล์ของคุณ",
        "画質と字幕はこの端末に保存されます。音声言語はプロフィールに保存されます。",
    ),
    SettingsPlayerStatusReady(
        "{{language}} will be selected when it is available.",
        "จะเลือก {{language}} โดยอัตโนมัติเมื่อมีให้ใช้งาน",
        "{{language}}が利用可能な場合に選択されます。",
    ),
    SettingsPlayerDefaultsSaved(
        "Playback defaults saved on this device.",
        "บันทึกค่าเริ่มต้นการเล่นในอุปกรณ์นี้แล้ว",
        "再生の初期設定をこの端末に保存しました。",
    ),
    SettingsPlayerSaved("Player preference saved.", "บันทึกการตั้งค่าเครื่องเล่นแล้ว", "プレイヤーの設定を保存しました。"),
    SettingsAvatarSaved(
        "Profile avatar saved to your profile.",
        "บันทึกรูปโปรไฟล์ลงในโปรไฟล์ของคุณแล้ว",
        "プロフィールアバターをプロフィールに保存しました。",
    ),
    SettingsProfilePinSet("Profile PIN set.", "ตั้งค่า PIN โปรไฟล์แล้ว", "プロフィールPINを設定しました。"),
    SettingsProfilePinReplaced("Profile PIN replaced.", "แทนที่ PIN โปรไฟล์แล้ว", "プロフィールPINを変更しました。"),
    SettingsProfilePinRemoved("Profile PIN removed.", "ลบ PIN โปรไฟล์แล้ว", "プロフィールPINを削除しました。"),
    SettingsInviteRequestSent(
        "Invite request sent to your Streamarr admin.",
        "ส่งคำขอคำเชิญไปยังผู้ดูแลระบบ Streamarr ของคุณแล้ว",
        "Streamarrの管理者に招待リクエストを送信しました。",
    ),
    SettingsInviteGenerated(
        "Friend invite generated. It is valid for 24 hours.",
        "สร้างคำเชิญเพื่อนแล้ว ใช้ได้ภายใน 24 ชั่วโมง",
        "友達招待を生成しました。24時間有効です。",
    ),
    SettingsServerConnected("Server connected.", "เชื่อมต่อเซิร์ฟเวอร์แล้ว", "サーバーに接続しました。"),
    SettingsServerDisconnected("Server disconnected.", "ตัดการเชื่อมต่อเซิร์ฟเวอร์แล้ว", "サーバーを切断しました。"),
    SettingsServerGroupForgotten(
        "Forgot remembered server addresses.",
        "ลืมที่อยู่เซิร์ฟเวอร์ที่จดจำไว้แล้ว",
        "記憶していたサーバーアドレスを削除しました。",
    ),

    ProfilesTitle("Profiles", "โปรไฟล์", "プロフィール"),
    ProfilesHeading("Who’s watching?", "ใครกำลังดูอยู่?", "誰が見ますか?"),
    ProfilesLoading("Loading profiles…", "กำลังโหลดโปรไฟล์…", "プロフィールを読み込んでいます…"),
    ProfilesErrorShowingSaved(
        "Showing saved profiles. {{message}}",
        "กำลังแสดงโปรไฟล์ที่บันทึกไว้ {{message}}",
        "保存済みのプロフィールを表示しています。{{message}}",
    ),
    ProfilesAvatarLabel("{{name}}", "{{name}}", "{{name}}"),
    ProfilesAvatarLabelCurrent(
        "{{name}}, current profile",
        "{{name}}, โปรไฟล์ปัจจุบัน",
        "{{name}}(現在のプロフィール)",
    ),
    ProfilesStatusSwitching("Switching…", "กำลังสลับ…", "切り替えています…"),
    ProfilesStatusCurrent("Watching now", "กำลังดูอยู่", "視聴中"),
    ProfilesStatusPinRequired("PIN required", "ต้องใช้ PIN", "PINが必要です"),
    ProfilesStatusReady("Ready", "พร้อมใช้งาน", "準備完了"),
    ProfilesSettings("Settings", "การตั้งค่า", "設定"),
    ProfilesSettingsFor("{{name}} settings", "การตั้งค่าของ {{name}}", "{{name}}の設定"),
    ProfilesSignOut("Sign out", "ออกจากระบบ", "サインアウト"),
    ProfilesSignIn("Sign in", "เข้าสู่ระบบ", "サインイン"),
    ProfilesAddAnother("Add another profile", "เพิ่มโปรไฟล์อื่น", "プロフィールを追加"),
    ProfilesSwitchProfile("Switch profile", "สลับโปรไฟล์", "プロフィールを切り替え"),
    ProfilesEnterPin("Enter four-digit PIN", "ป้อน PIN 4 หลัก", "4桁のPINを入力"),
    ProfilesPinNotAccepted(
        "That PIN was not accepted.",
        "PIN นั้นไม่ถูกต้อง",
        "そのPINは承認されませんでした。",
    ),
    ProfilesChecking("Checking…", "กำลังตรวจสอบ…", "確認しています…"),
    ProfilesContinue("Continue", "ดำเนินการต่อ", "続ける"),
    ProfilesUseAccountSignIn(
        "Use account sign-in",
        "ใช้การเข้าสู่ระบบด้วยบัญชี",
        "アカウントでサインイン",
    ),
    ProfilesCheckForUpdates("Check for updates", "ตรวจสอบการอัปเดต", "アップデートを確認"),
    ProfilesUpdateAllowInstall(
        "Allow installs to continue",
        "อนุญาตการติดตั้งเพื่อดำเนินการต่อ",
        "インストールを許可して続行",
    ),
    ProfilesUpdateChecking(
        "Checking for updates…",
        "กำลังตรวจสอบการอัปเดต…",
        "アップデートを確認しています…",
    ),
    ProfilesUpdateCurrent(
        "Playarr is up to date",
        "Playarr เป็นเวอร์ชันล่าสุดแล้ว",
        "Playarrは最新です",
    ),
    ProfilesUpdateDownloading(
        "Downloading update…",
        "กำลังดาวน์โหลดการอัปเดต…",
        "アップデートをダウンロードしています…",
    ),
    ProfilesUpdateDownloadingProgress(
        "Downloading update… {{progress}}%",
        "กำลังดาวน์โหลดการอัปเดต… {{progress}}%",
        "アップデートをダウンロードしています… {{progress}}%",
    ),
    ProfilesUpdateInstalling(
        "Opening installer…",
        "กำลังเปิดตัวติดตั้ง…",
        "インストーラーを開いています…",
    ),
    ProfilesUpdateRetry("Try update again", "ลองอัปเดตอีกครั้ง", "もう一度アップデート"),

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
