' Pairing screen theme + language preferences (web TvStageChrome on /login/qr).
' Theme: system | light | dark. Language: system | en | ja | th.

function PairingPrefsRegistry() as Object
    return CreateObject("roRegistrySection", "playarr.prefs")
end function

function LoadPairingThemePreference() as String
    value = PairingPrefsRegistry().Read("theme")
    if value = "light" or value = "dark" or value = "system" then return value
    return "dark"
end function

sub SavePairingThemePreference(value as String)
    section = PairingPrefsRegistry()
    section.Write("theme", value)
    section.Flush()
end sub

function LoadPairingLanguagePreference() as String
    value = PairingPrefsRegistry().Read("language")
    if value = "en" or value = "ja" or value = "th" or value = "system" then return value
    return "system"
end function

sub SavePairingLanguagePreference(value as String)
    section = PairingPrefsRegistry()
    section.Write("language", value)
    section.Flush()
end sub

' Resolve system -> concrete theme. Roku TVs are a dark living-room product;
' system maps to dark (same default as Playarr dark shell).
function ResolvePairingTheme(preference as String) as String
    if preference = "light" then return "light"
    return "dark"
end function

function ResolvePairingLanguage(preference as String) as String
    if preference = "en" or preference = "ja" or preference = "th" then return preference
    ' system: try device locale, else English.
    deviceInfo = CreateObject("roDeviceInfo")
    locale = ""
    if deviceInfo <> invalid then locale = LCase(deviceInfo.GetCurrentLocale())
    if Left(locale, 2) = "ja" then return "ja"
    if Left(locale, 2) = "th" then return "th"
    return "en"
end function

function PairingThemeOptionLabels(lang as String) as Object
    if lang = "ja"
        return ["システム", "ライト", "ダーク"]
    else if lang = "th"
        return ["ระบบ", "สว่าง", "มืด"]
    end if
    return ["System", "Light", "Dark"]
end function

function PairingLanguageOptionLabels() as Object
    ' Latin labels: Roku default fonts lack CJK/Thai glyphs (tofu boxes).
    return ["Auto", "English", "Japanese", "Thai"]
end function

function PairingThemePreferenceFromIndex(index as Integer) as String
    options = ["system", "light", "dark"]
    if index < 0 or index >= options.Count() then return "dark"
    return options[index]
end function

function PairingLanguagePreferenceFromIndex(index as Integer) as String
    options = ["system", "en", "ja", "th"]
    if index < 0 or index >= options.Count() then return "system"
    return options[index]
end function

function PairingThemeIndex(preference as String) as Integer
    if preference = "system" then return 0
    if preference = "light" then return 1
    return 2
end function

function PairingLanguageIndex(preference as String) as Integer
    if preference = "en" then return 1
    if preference = "ja" then return 2
    if preference = "th" then return 3
    return 0
end function

function PairingThemeChromeLabel(preference as String, lang as String) as String
    labels = PairingThemeOptionLabels(lang)
    return labels[PairingThemeIndex(preference)]
end function

function PairingLanguageChromeLabel(preference as String) as String
    labels = PairingLanguageOptionLabels()
    return labels[PairingLanguageIndex(preference)]
end function

' Strings for the pairing panel (subset of web i18n).
function PairingUiStrings(lang as String) as Object
    if lang = "ja"
        return {
            kicker: "おかえりなさい"
            title: "Playarrにサインイン"
            description: "スマートフォンまたは別のブラウザでQRコードを読み取り、このデバイスにサインインしてください。"
            scan: "QRコードを読み取るか、こちらにアクセスしてください"
            enter: "このコードを入力してください"
            waiting: "承認をお待ちください…"
            refreshesPrefix: "コードの更新まで "
            creating: "安全なサインインコードを作成しています…"
            manualBtn: "手動でサインイン"
            failed: "続行できませんでした"
            unavailable: "Playarrのリンクを利用できません。"
        }
    else if lang = "th"
        return {
            kicker: "ยินดีต้อนรับกลับบ้าน"
            title: "เข้าสู่ระบบ Playarr"
            description: "สแกนคิวอาร์โค้ดด้วยโทรศัพท์หรือเบราว์เซอร์อื่น เพื่อเข้าสู่ระบบบนอุปกรณ์นี้"
            scan: "สแกนคิวอาร์โค้ด หรือเข้าไปที่"
            enter: "แล้วป้อนรหัสนี้"
            waiting: "กำลังรอการอนุมัติ…"
            refreshesPrefix: "รหัสจะรีเฟรชใน "
            creating: "กำลังสร้างรหัสเข้าสู่ระบบที่ปลอดภัย…"
            manualBtn: "เข้าสู่ระบบด้วยตนเอง"
            failed: "ดำเนินการต่อไม่ได้"
            unavailable: "การลิงก์ Playarr ใช้ไม่ได้ในตอนนี้"
        }
    end if
    return {
        kicker: "WELCOME HOME"
        title: "Sign in to Playarr"
        description: "Scan the QR code with your phone or another browser to sign in on this device."
        scan: "Scan the QR code, or visit"
        enter: "and enter this code"
        waiting: "Waiting for approval…"
        refreshesPrefix: "Code refreshes in "
        creating: "Creating a secure sign-in code…"
        manualBtn: "Sign in manually"
        failed: "Couldn’t continue"
        unavailable: "Playarr linking is unavailable right now."
    }
end function

' Playback defaults kept on this device (web stores the same choices locally): quality ("original" or "UHD:Low" ...)
' and default subtitles ("off", "forced", "always").
function LoadQualityPreference() as String
    value = PairingPrefsRegistry().Read("quality")
    if value = "" then return "original"
    return value
end function

sub SaveQualityPreference(value as String)
    section = PairingPrefsRegistry()
    section.Write("quality", value)
    section.Flush()
end sub

function LoadSubtitlePreference() as String
    value = PairingPrefsRegistry().Read("subtitles")
    if value = "forced" or value = "always" then return value
    return "off"
end function

sub SaveSubtitlePreference(value as String)
    section = PairingPrefsRegistry()
    section.Write("subtitles", value)
    section.Flush()
end sub

' Maximum bitrate (bits per second) for a quality choice; `fallback` when the choice is "original" or unknown.
function QualityMaxBitrate(choice as String, fallback as Integer) as Integer
    if choice = "original" then return 100000000
    rows = { UHD: [12, 20, 35], FHD: [4, 8, 12], HD: [2, 4, 6], SD: [1, 2, 3] }
    parts = choice.Split(":")
    if parts.Count() <> 2 then return fallback
    rates = rows[parts[0]]
    if rates = invalid then return fallback
    index = 1
    if parts[1] = "Low" then index = 0
    if parts[1] = "High" then index = 2
    return rates[index] * 1000000
end function
