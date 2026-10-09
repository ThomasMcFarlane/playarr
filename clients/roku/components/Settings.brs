' Settings.brs
'
' Preferences on the page shell (web /settings): the section list on the left, the chosen section's panel on the
' right. Layout numbers are the web DOM at 1920x1080. The panel content is functional where the Roku can do the job
' (theme, language, quality, audio language, PIN lock, server list, avatar) and says plainly where a section belongs
' to another client (invite, phone remote, data export), as the web does on devices without a file picker.

function settingsSections() as Object
    return [
        { id: "appearance", title: "Appearance", detail: "Choose this device’s theme and home screen artwork." }
        { id: "avatar", title: "Profile avatar", detail: "Choose how your profile appears on this account." }
        { id: "language", title: "Language", detail: "Follow this device or keep a language fixed." }
        { id: "player", title: "Player", detail: "Choose how Playarr should start quality, subtitles and audio." }
        { id: "server", title: "Server connection", detail: "Combine libraries from multiple servers." }
        { id: "lock", title: "Profile lock", detail: "Require a four-digit PIN before switching to this profile." }
        { id: "invite", title: "Invite a friend", detail: "Ask your Playarr Server admin for one friend-invite QR code." }
        { id: "latency", title: "Request latency", detail: "Per-route HTTP request latency for admins." }
        { id: "remote", title: "Phone remote", detail: "Control this device from your phone, or control another device." }
        { id: "data", title: "Your data", detail: "Export your watch progress, playlists and preferences." }
        { id: "home", title: "Customise Home", detail: "Choose which Home rails show and in what order." }
    ]
end function

function settingsSectionIndexOf(id as String) as Integer
    sections = settingsSections()
    for i = 0 to sections.Count() - 1
        if sections[i].id = id then return i
    end for
    return 0
end function

sub pageSettingsFocusDefault()
    ' First focusable after the back button is the active section row.
    m.pageFocusIdx = 1 + settingsSectionIndexOf(m.settingsPanel)
    if m.pageFocusIdx >= m.pageItems.Count() then m.pageFocusIdx = 0
end sub

sub renderSettings()
    sections = settingsSections()
    activeIdx = settingsSectionIndexOf(m.settingsPanel)
    pageBegin("Preferences", 672)
    pgLabel(m.pageHead, 226.6, 119.5, 420, 21, UCase(sections[activeIdx].title), 14, 800, "inkMuted")
    pgLabel(m.pageHead, 226.6, 143.7, 420, 16, UCase(sections[activeIdx].detail), 12, 400, "inkMuted", { maxLines: 1 })
    for i = 0 to sections.Count() - 1
        y = 162 + 91.9 * i
        if i = activeIdx then pgRect(m.pageBody, 153.6, y, 480.4, 91.9, "surfaceSoft")
        num = i + 1
        numText = num.ToStr()
        if num < 10 then numText = "0" + numText
        pgLabel(m.pageBody, 185.6, y + 23.8, 40, 18, numText, 10, 800, "inkMuted")
        pgLabel(m.pageBody, 245.6, y + 23.8, 330, 44, sections[i].title, 30, 500, "ink")
        arrowRole = "inkMuted"
        if i = activeIdx then arrowRole = "ink"
        pgIcon(m.pageBody, 586, y + 33, 20, "arrow-right.png", arrowRole)
        pgFocusable(153.6, y, 480.4, 91.9, 12, "section", sections[i].id, false)
    end for
    id = m.settingsPanel
    if id = "appearance"
        panelAppearance()
    else if id = "avatar"
        panelAvatar()
    else if id = "language"
        panelLanguage()
    else if id = "player"
        panelPlayer()
    else if id = "server"
        panelServer()
    else if id = "lock"
        panelLock()
    else if id = "invite"
        panelInvite()
    else if id = "latency"
        panelLatency()
    else if id = "remote"
        panelRemote()
    else if id = "home"
        panelHome()
    else
        panelData()
    end if
end sub

' Segmented control (web .theme-choice): outlined group, the active option filled with ink. Returns the group width.
function pgSegmented(x as Float, y as Float, h as Float, labels as Object, activeIdx as Integer, action as String) as Float
    widths = []
    total = 0.0
    for each text in labels
        probe = pgLabel(m.pageBody, x, y, 0, h, text, 12, 700, "inkSoft")
        w = probe.boundingRect().width + 36
        m.pageBody.removeChild(probe)
        widths.Push(w)
        total = total + w
    end for
    pgRound(m.pageBody, x, y, total + 2, h, 6, "line", -1, true)
    cx = x + 1
    for i = 0 to labels.Count() - 1
        if i = activeIdx
            pgRound(m.pageBody, cx, y + 1, widths[i], h - 2, 6, "ink")
            pgLabel(m.pageBody, cx, y + 1, widths[i], h - 2, labels[i], 12, 700, "bg", { horizAlign: "center", vertAlign: "center" })
        else
            pgLabel(m.pageBody, cx, y + 1, widths[i], h - 2, labels[i], 12, 700, "inkMuted", { horizAlign: "center", vertAlign: "center" })
        end if
        pgFocusable(cx, y + 1, widths[i], h - 2, 6, action, i, true)
        cx = cx + widths[i]
    end for
    return total
end function

sub pgHeading(y as Float, text as String)
    pgLabel(m.pageBody, 773.8, y, 995, 40, text, 26, 600, "ink")
end sub

sub pgHint(y as Float, text as String, size = 13 as Integer)
    pgLabel(m.pageBody, 773.8, y, 995, 22, text, size, 400, "inkMuted", { wrap: true })
end sub

sub panelAppearance()
    pgHeading(210, "Colour theme")
    pgSegmented(773.8, 265.8, 50, ["System", "Light", "Dark"], PairingThemeIndex(m.themePreference), "theme")
    pgRect(m.pageBody, 773.8, 346, 995, 1, "line")
    pgHeading(377.3, "Home screen artwork")
    pgHint(422.5, "Show portrait covers instead of wide media thumbnails on the home screen.")
    pgSegmented(773.8, 459, 50, ["Thumbnails"], 0, "artwork")
    pgHint(528, "Portrait covers are not available on Roku yet; thumbnails are used.", 12)
end sub

sub panelAvatar()
    presets = ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"]
    ' The account's own choice; a custom photo (chosen on another device) highlights no preset.
    current = ""
    if m.avatarKind = "custom"
        current = "custom"
    else
        current = currentAvatarPresetId(m.profileId)
    end if
    for i = 0 to presets.Count() - 1
        col = i mod 4
        row = Int(i / 4)
        x = 773.8 + col * 185.5
        y = 210 + row * 185.5
        if presets[i] = current then pgRound(m.pageBody, x - 5, y - 5, 173, 173, 12, "ink", 40, true)
        pgArtwork(m.pageBody, x + 9, y + 9, 145, 145, "")
        art = m.pageBody.getChild(m.pageBody.getChildCount() - 1)
        art.uri = "pkg:/images/avatar-" + presets[i] + ".png"
        art.loadDisplayMode = "scaleToFit"
        pgFocusable(x, y, 163.5, 163.5, 12, "avatar", presets[i], true)
    end for
    pgLabel(m.pageBody, 773.8, 591.4, 995, 30, "Choosing a custom photo is not available on this device. A photo chosen elsewhere is shown here.", 19, 400, "inkMuted")
end sub

sub panelLanguage()
    pgRound(m.pageBody, 773.8, 210, 168, 48, 6, "bg")
    pgRound(m.pageBody, 773.8, 210, 168, 48, 6, "line", -1, true)
    lang = ResolvePairingLanguage(m.languagePreference)
    pgLabel(m.pageBody, 818.7, 210, 100, 48, PairingLanguageChromeLabel(m.languagePreference), 12, 700, "ink", { vertAlign: "center" })
    pgIcon(m.pageBody, 914, 227, 14, "chevron-down.png", "inkMuted")
    pgFocusable(773.8, 210, 168, 48, 6, "language", invalid, true)
    names = { en: "English", ja: "Japanese", th: "Thai" }
    pgHint(288.2, "Playarr detected " + names[lang] + " from this device and will follow it. Pick a language to override.")
end sub

function qualityRows() as Object
    return [
        { name: "UHD", note: "2160p", rates: [12, 20, 35] }
        { name: "FHD", note: "1080p", rates: [4, 8, 12] }
        { name: "HD", note: "720p", rates: [2, 4, 6] }
        { name: "SD", note: "480p", rates: [1, 2, 3] }
    ]
end function

sub panelPlayer()
    pgHeading(210, "Default quality")
    pgHint(255.2, "Start playback at this quality when the connection allows it.")
    selected = m.qualityPref
    if selected = invalid or selected = "" then selected = "original"
    ' Original row.
    pgRound(m.pageBody, 773.8, 295, 995, 60, 12, "surface")
    if selected = "original" then pgRound(m.pageBody, 773.8, 295, 995, 60, 12, "brand", 60)
    pgRound(m.pageBody, 773.8, 295, 995, 60, 12, "line", -1, true)
    pgLabel(m.pageBody, 784.7, 307.7, 400, 19, "Original", 12, 700, "ink")
    pgLabel(m.pageBody, 784.7, 328.3, 400, 14, "Best available source", 9, 400, "inkMuted")
    if selected = "original" then pgIcon(m.pageBody, 1742, 316, 14, "check.png", "brand")
    pgFocusable(773.8, 295, 995, 60, 12, "quality", "original", true)
    heads = ["Low", "Medium", "High"]
    for c = 0 to 2
        pgLabel(m.pageBody, 968.8 + c * 268.6, 363, 262, 28, UCase(heads[c]), 10, 800, "inkMuted")
    end for
    rows = qualityRows()
    for r = 0 to rows.Count() - 1
        y = 396.5 + 66 * r
        pgLabel(m.pageBody, 777.8, y + 13, 180, 18, rows[r].name, 12, 800, "ink")
        pgLabel(m.pageBody, 777.8, y + 33, 180, 14, rows[r].note, 9, 400, "inkMuted")
        for c = 0 to 2
            x = 968.8 + c * 268.6
            key = rows[r].name + ":" + heads[c]
            pgRound(m.pageBody, x, y, 262.6, 60, 12, "surface")
            if selected = key then pgRound(m.pageBody, x, y, 262.6, 60, 12, "brand", 60)
            pgRound(m.pageBody, x, y, 262.6, 60, 12, "line", -1, true)
            pgLabel(m.pageBody, x + 11, y + 12.7, 200, 19, rows[r].rates[c].ToStr() + " Mbps", 12, 700, "inkSoft")
            pgLabel(m.pageBody, x + 11, y + 33.3, 200, 14, heads[c], 9, 400, "inkMuted")
            pgFocusable(x, y, 262.6, 60, 12, "quality", key, true)
        end for
    end for
    pgHeading(716, "Default subtitles")
    pgHint(761.2, "Keep subtitles off, show forced dialogue only, or always show them.")
    subs = m.subtitlePref
    if subs = invalid or subs = "" then subs = "off"
    opts = [{ id: "off", text: "Off" }, { id: "forced", text: "Forced only" }, { id: "always", text: "Always on" }]
    for i = 0 to 2
        x = 773.8 + i * 251.7
        pgRound(m.pageBody, x, 800.9, 239.7, 68, 12, "surface")
        if subs = opts[i].id then pgRound(m.pageBody, x, 800.9, 239.7, 68, 12, "brand", 60)
        pgRound(m.pageBody, x, 800.9, 239.7, 68, 12, "line", -1, true)
        pgLabel(m.pageBody, x + 15, 800.9, 209, 68, opts[i].text, 14, 700, "inkSoft", { vertAlign: "center" })
        pgFocusable(x, 800.9, 239.7, 68, 12, "subtitles", opts[i].id, true)
    end for
    pgHeading(930.4, "Default audio track")
    pgHint(975.6, "Prefer this audio language whenever a matching track is available.")
    codes = m.audioLanguageCodes
    if codes = invalid then codes = []
    for i = 0 to codes.Count() - 1
        col = i mod 2
        row = Int(i / 2)
        x = 773.8 + col * 503.4
        y = 1015.4 + row * 74
        active = codes[i] = m.preferredAudioLanguage
        pgRound(m.pageBody, x, y, 491.5, 62, 12, "surface")
        if active then pgRound(m.pageBody, x, y, 491.5, 62, 12, "brand", 60)
        pgRound(m.pageBody, x, y, 491.5, 62, 12, "line", -1, true)
        pgLabel(m.pageBody, x + 17, y, 380, 62, audioLanguageLabel(codes[i]), 15, 700, "ink", { vertAlign: "center" })
        pgLabel(m.pageBody, x + 440, y, 40, 62, codes[i], 9, 700, "brand", { vertAlign: "center", mono: true })
        pgFocusable(x, y, 491.5, 62, 12, "audio", codes[i], true)
    end for
end sub

sub panelServer()
    n = m.serverAddresses.Count()
    pgRound(m.pageBody, 773.8, 210, 900, 100.9, 12, "surface")
    pgRound(m.pageBody, 773.8, 210, 900, 100.9, 12, "line", -1, true)
    pgLabel(m.pageBody, 793.1, 227, 700, 29, "Playarr Server", 19, 700, "ink")
    if m.session <> invalid and m.session.profileName <> invalid then pgLabel(m.pageBody, 793.1, 259, 700, 16, m.session.profileName, 11, 400, "inkMuted")
    if n > 0 then pgLabel(m.pageBody, 793.1, 278, 760, 16, m.serverAddresses[0], 11, 400, "inkMuted")
    pgLabel(m.pageBody, 1587, 244.8, 80, 31, "Primary", 11, 400, "inkMuted", { mono: true, vertAlign: "center" })
    pgLabel(m.pageBody, 773.8, 341, 900, 17, UCase("Add another server"), 11, 700, "inkMuted")
    pgButton(m.pageBody, 773.8, 365.1, 62, "Connect a server", "primary", "serverConnect", invalid, 24)
    pgHint(445, "Credentials and requests go directly from this device to the server you choose.", 12)
    pgHint(544.3, "The first connected server stays primary.", 12)
    pgFocusable(773.8, 365.1, 200, 62, 31, "serverConnectProbe", invalid, true)
    m.pageItems.Pop()
end sub

sub panelLock()
    pgLabel(m.pageBody, 773.8, 210, 420, 17, UCase("New PIN"), 11, 700, "inkMuted")
    status = "PIN lock is off."
    if m.profilePinLocked = true then status = "PIN lock is on."
    pgRound(m.pageBody, 773.8, 234, 420, 62, 6, "bg")
    pgRound(m.pageBody, 773.8, 234, 420, 62, 6, "line", -1, true)
    pgLabel(m.pageBody, 794, 234, 280, 62, "Four digits", 13, 400, "inkMuted", { vertAlign: "center" })
    pgFocusable(773.8, 234, 325.2, 62, 6, "pinEdit", invalid, true)
    pgButton(m.pageBody, 1099.9, 234, 62, "Set PIN", "primary", "pinEdit", invalid, 28)
    m.pageItems.Pop()
    pgFocusable(1099.9, 234, 93.8, 62, 6, "pinEdit", invalid, true)
    if m.profilePinLocked = true then pgButton(m.pageBody, 773.8, 312, 50, "Remove PIN", "secondary", "pinRemove", invalid, 24)
    pgLabel(m.pageBody, 773.8, 329.8 + 50, 600, 29, status, 19, 400, "inkMuted")
end sub

sub panelInvite()
    pgLabel(m.pageBody, 773.8, 210, 995, 29, "Invites are created on the web or mobile app.", 19, 400, "inkMuted")
    pgHint(255, "Ask your Playarr Server admin for one friend-invite QR code from Preferences on another device.", 13)
end sub

sub panelLatency()
    pgRound(m.pageBody, 901.1, 210, 164, 164, 82, "surface", 138)
    pgRound(m.pageBody, 901.1, 210, 164, 164, 82, "line", -1, true)
    pgIcon(m.pageBody, 963, 272, 40, "icon-empty.png", "brand")
    pgLabel(m.pageBody, 1107.1, 255.7, 460, 33, "Admins only", 22, 700, "ink")
    pgLabel(m.pageBody, 1107.1, 296, 230, 40, "Sign in with an admin account to see per-route request latency.", 11, 400, "inkMuted", { wrap: true, maxLines: 2 })
end sub

sub panelRemote()
    pgLabel(m.pageBody, 773.8, 210, 995, 34, "This device", 22, 700, "ink")
    pgHint(273.9, "Phone remote control is managed from the Playarr web or mobile app.", 15)
    pgLabel(m.pageBody, 773.8, 447.7, 995, 34, "Control another device", 22, 700, "ink")
    pgLabel(m.pageBody, 773.8, 511.6, 995, 29, "Other devices are controlled from the web or mobile app.", 19, 400, "inkMuted")
end sub

sub panelHome()
    pgLabel(m.pageBody, 773.8, 210, 995, 34, "Home rails", 22, 700, "ink")
    pgLabel(m.pageBody, 773.8, 273.9, 995, 58, "Show, hide and reorder the rails on your Home screen. Changes are saved on every press.", 19, 400, "inkMuted", { wrap: true, maxLines: 2 })
    pgButton(m.pageBody, 773.8, 360, 50, "Open Customise Home", "primary", "openCustomise", invalid, 24)
end sub

sub panelData()
    pgLabel(m.pageBody, 773.8, 210, 995, 34, "Export my data", 22, 700, "ink")
    pgLabel(m.pageBody, 773.8, 273.9, 995, 58, "Exporting and importing your data needs a file picker. Use Playarr on a phone, tablet or computer for this.", 19, 400, "inkMuted", { wrap: true, maxLines: 2 })
end sub

' ---------------------------------------------------------------------------
' Actions

sub settingsAction(item as Object)
    a = item.action
    if a = "section"
        m.settingsPanel = item.data
        renderSettings()
        m.pageFocusIdx = 1 + settingsSectionIndexOf(m.settingsPanel)
        if m.settingsPanel = "player" then loadPlayerPreferences()
        if m.settingsPanel = "avatar" then sendApi("avatarGet", "GET", "/api/v1/users/me/profile-avatar", invalid, true)
        if m.settingsPanel = "lock" then loadProfilePinSetting()
        pageFocusRender()
        return
    end if
    if a = "openCustomise"
        openPage("customise")
        return
    end if
    if a = "theme"
        options = ["system", "light", "dark"]
        setThemePreference(options[item.data])
    else if a = "language"
        openPairingLanguagePicker()
        return
    else if a = "quality"
        m.qualityPref = item.data
        SaveQualityPreference(item.data)
    else if a = "subtitles"
        m.subtitlePref = item.data
        SaveSubtitlePreference(item.data)
    else if a = "audio"
        saveAudioLanguage(item.data)
        m.preferredAudioLanguage = item.data
    else if a = "avatar"
        deleteCustomAvatarFile()
        m.avatarKind = "preset"
        m.avatarValue = item.data
        m.avatarCustomUri = ""
        applyShellAvatar()
        sendApi("avatarSave", "PUT", "/api/v1/users/me/profile-avatar", { preference: { kind: "preset", value: item.data } }, true)
    else if a = "serverConnect"
        openServerDialog()
        return
    else if a = "pinEdit"
        openProfilePinDialog()
        return
    else if a = "pinRemove"
        removeProfilePin()
        return
    else
        return
    end if
    keep = m.pageFocusIdx
    renderSettings()
    m.pageFocusIdx = keep
    if m.pageFocusIdx >= m.pageItems.Count() then m.pageFocusIdx = 0
    pageFocusRender()
end sub

' Called by the language dialog and the PIN/audio flows after they change state.
sub settingsRefresh()
    if m.top.screenState = "page" and m.pageKind = "settings"
        keep = m.pageFocusIdx
        renderSettings()
        m.pageFocusIdx = keep
        if m.pageFocusIdx >= m.pageItems.Count() then m.pageFocusIdx = 0
        pageFocusRender()
    end if
end sub
