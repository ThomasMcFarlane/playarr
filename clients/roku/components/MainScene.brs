sub init()
    m.statusGroup = m.top.findNode("statusGroup")
    m.spinner = m.top.findNode("spinner")
    m.statusTitle = m.top.findNode("statusTitle")
    m.statusMessage = m.top.findNode("statusMessage")
    m.pairingGroup = m.top.findNode("pairingGroup")
    m.pairingInstruction = m.top.findNode("pairingInstruction")
    m.pairingCode = m.top.findNode("pairingCode")
    m.pairingStatus = m.top.findNode("pairingStatus")
    m.pairingQr = m.top.findNode("pairingQr")
    m.pairingQrBg = m.top.findNode("pairingQrBg")
    m.pairingQrFrame = m.top.findNode("pairingQrFrame")
    m.pairingKicker = m.top.findNode("pairingKicker")
    m.pairingTitle = m.top.findNode("pairingTitle")
    m.pairingDescription = m.top.findNode("pairingDescription")
    m.pairingScan = m.top.findNode("pairingScan")
    m.pairingUrl = m.top.findNode("pairingUrl")
    m.pairingEnter = m.top.findNode("pairingEnter")
    m.pairingTimerLabel = m.top.findNode("pairingTimer")
    m.pairingCodeExpiresAt = 0
    m.pairingManualHint = m.top.findNode("pairingManualHint")
    m.pairingAuthBg = m.top.findNode("pairingAuthBg")
    m.pairingThemeHit = m.top.findNode("pairingThemeHit")
    m.pairingLangHit = m.top.findNode("pairingLangHit")
    m.pairingManualHit = m.top.findNode("pairingManualHit")
    m.pairingBackHit = m.top.findNode("pairingBackHit")
    m.pairingThemeLabel = m.top.findNode("pairingThemeLabel")
    m.pairingLangLabel = m.top.findNode("pairingLangLabel")
    m.pairingManualLabel = m.top.findNode("pairingManualLabel")
    m.pairingThemePill = m.top.findNode("pairingThemePill")
    m.pairingLangPill = m.top.findNode("pairingLangPill")
    m.pairingManualPill = m.top.findNode("pairingManualPill")
    m.pairingThemeIcon = m.top.findNode("pairingThemeIcon")
    m.pairingLangIcon = m.top.findNode("pairingLangIcon")
    m.pairingThemeChevron = m.top.findNode("pairingThemeChevron")
    m.pairingLangChevron = m.top.findNode("pairingLangChevron")
    m.pairingBackBtn = m.top.findNode("pairingBackBtn")
    m.themePreference = LoadPairingThemePreference()
    m.languagePreference = LoadPairingLanguagePreference()
    m.pairingChromeIsLight = false

    m.hostedLinkTimer = m.top.findNode("hostedLinkTimer")
    m.profilesGroup = m.top.findNode("profilesGroup")
    m.profilesRow = m.top.findNode("profilesRow")
    m.profilesAuthBg = m.top.findNode("profilesAuthBg")
    m.profilesThemeHit = m.top.findNode("profilesThemeHit")
    m.profilesLangHit = m.top.findNode("profilesLangHit")
    m.profilesThemePill = m.top.findNode("profilesThemePill")
    m.profilesLangPill = m.top.findNode("profilesLangPill")
    m.profilesThemeIcon = m.top.findNode("profilesThemeIcon")
    m.profilesLangIcon = m.top.findNode("profilesLangIcon")
    m.profilesThemeChevron = m.top.findNode("profilesThemeChevron")
    m.profilesLangChevron = m.top.findNode("profilesLangChevron")
    m.profilesThemeLabel = m.top.findNode("profilesThemeLabel")
    m.profilesLangLabel = m.top.findNode("profilesLangLabel")
    m.profilesKicker = m.top.findNode("profilesKicker")
    m.profilesTitle = m.top.findNode("profilesTitle")
    m.profileActionsGroup = m.top.findNode("profileActionsGroup")
    m.profilesSettingsBtn = m.top.findNode("profilesSettingsBtn")
    m.profilesSignOutBtn = m.top.findNode("profilesSignOutBtn")
    m.profilesSettingsHit = m.top.findNode("profilesSettingsHit")
    m.profilesSignOutHit = m.top.findNode("profilesSignOutHit")
    m.profilesFocusIndex = 0
    m.settingsGroup = m.top.findNode("settingsGroup")
    m.settingsSectionList = m.top.findNode("settingsSectionList")
    m.settingsDetail = m.top.findNode("settingsDetail")
    m.settingsActionList = m.top.findNode("settingsActionList")
    m.libraryGroup = m.top.findNode("libraryGroup")
    m.library = m.top.findNode("libraryList")
    m.libraryTitle = m.top.findNode("libraryTitle")
    m.homeGroup = m.top.findNode("homeGroup")
    m.homeStage = m.top.findNode("homeStage")
    m.homeContent = m.homeStage.contentTarget
    m.navDock = m.top.findNode("navDock")
    m.navHighlights = []
    m.navIcons = []
    m.navLabels = []
    for i = 0 to 6
        m.navHighlights.Push(m.top.findNode("navHighlight" + i.ToStr()))
        m.navIcons.Push(m.top.findNode("navIcon" + i.ToStr()))
        m.navLabels.Push(m.top.findNode("navLabel" + i.ToStr()))
    end for
    m.browseGroup = m.top.findNode("browseGroup")
    m.browseGrid = m.top.findNode("browseGrid")
    ' Product shell is a single SceneGraph UI — residual freeze Posters are
    ' gone from MainScene.xml (no dual stacked interface).
    hideAllResiduals()
    m.availableWorkKinds = invalid
    ' Sites (index 4) starts disabled until catalog/kinds proves access.
    m.navEnabled = [true, true, true, true, false, true, true]
    m.browseTitle = m.top.findNode("browseTitle")
    m.browseCountLabel = m.top.findNode("browseCountLabel")
    m.browseKeyArt = m.top.findNode("browseKeyArt")
    m.browsePreviewKind = m.top.findNode("browsePreviewKind")
    m.browsePreviewTitle = m.top.findNode("browsePreviewTitle")
    m.browsePreviewMeta = m.top.findNode("browsePreviewMeta")
    m.browsePreviewOverview = m.top.findNode("browsePreviewOverview")
    m.browseAlphabet = m.top.findNode("browseAlphabet")
    buildAlphabetStrip()
    m.browseFiltersButton = m.top.findNode("browseFiltersButton")
    m.browseFiltersPanel = m.top.findNode("browseFiltersPanel")
    m.browseFilterSortTitle = m.top.findNode("browseFilterSortTitle")
    m.browseFilterSortDate = m.top.findNode("browseFilterSortDate")
    m.browseFilterOrderAsc = m.top.findNode("browseFilterOrderAsc")
    m.browseFilterOrderDesc = m.top.findNode("browseFilterOrderDesc")
    m.browseFilterSizeSmall = m.top.findNode("browseFilterSizeSmall")
    m.browseFilterSizeMedium = m.top.findNode("browseFilterSizeMedium")
    m.browseFilterSizeLarge = m.top.findNode("browseFilterSizeLarge")
    m.browseFilterOptions = [m.browseFilterSortTitle, m.browseFilterSortDate, m.browseFilterOrderAsc, m.browseFilterOrderDesc, m.browseFilterSizeSmall, m.browseFilterSizeMedium, m.browseFilterSizeLarge]
    m.searchGroup = m.top.findNode("searchGroup")
    m.searchGrid = m.top.findNode("searchGrid")
    m.searchTitle = m.top.findNode("searchTitle")
    m.searchFieldLabel = m.top.findNode("searchFieldLabel")
    m.searchEmptyState = m.top.findNode("searchEmptyState")
    m.searchEmptyHint = m.top.findNode("searchEmptyHint")
    m.searchHint = m.top.findNode("searchHint")
    m.searchPreviewKind = m.top.findNode("searchPreviewKind")
    m.searchPreviewTitle = m.top.findNode("searchPreviewTitle")
    m.searchPreviewMeta = m.top.findNode("searchPreviewMeta")
    m.searchPreviewOverview = m.top.findNode("searchPreviewOverview")
    m.searchFilterLabels = [
        m.top.findNode("searchFilterAll")
        m.top.findNode("searchFilterMovie")
        m.top.findNode("searchFilterSeries")
        m.top.findNode("searchFilterArtist")
        m.top.findNode("searchFilterPlaylists")
    ]
    m.playlistsGroup = m.top.findNode("playlistsGroup")
    m.playlistsDirectoryGroup = m.top.findNode("playlistsDirectoryGroup")
    m.playlistsGrid = m.top.findNode("playlistsGrid")
    m.playlistsTitle = m.top.findNode("playlistsTitle")
    m.playlistDetailGroup = m.top.findNode("playlistDetailGroup")
    m.playlistDetailStage = m.top.findNode("playlistDetailStage")
    m.playlistDetailContent = m.playlistDetailStage.contentTarget
    m.playlistItemsGrid = m.top.findNode("playlistItemsGrid")
    ' playlistItemsGrid is declared as an XML sibling of <TvStage
    ' id="playlistDetailStage" /> (see MainScene.xml's playlistsGroup
    ' comment for why it can't be nested inside the <TvStage> tag itself)
    ' and reparented here into playlistDetailStage's contentTarget, the
    ' exact same pattern used below for detailOverview/detailActions/
    ' detailEpisodes into detailContent.
    m.playlistDetailContent.AppendChild(m.playlistItemsGrid)
    m.detailGroup = m.top.findNode("detailGroup")
    m.detailStage = m.top.findNode("detailStage")
    m.detailContent = m.detailStage.contentTarget
    m.detailOverview = m.top.findNode("detailOverview")
    m.detailActions = m.top.findNode("detailActions")
    m.detailEpisodes = m.top.findNode("detailEpisodes")
    m.detailChapters = m.top.findNode("detailChapters")
    m.detailSimilar = m.top.findNode("detailSimilar")
    ' detailOverview/detailActions/detailEpisodes/detailChapters/
    ' detailSimilar are declared as XML siblings of <TvStage id="detailStage" />
    ' (see MainScene.xml's detailGroup comment for why they can't be nested
    ' inside the <TvStage> tag itself) and reparented here into
    ' detailStage's contentTarget so they render inside TvStage's
    ' right-hand content panel, mirroring how createHomeRail() below builds
    ' Home's rail content straight into m.homeContent.
    m.detailContent.AppendChild(m.detailOverview)
    m.detailContent.AppendChild(m.detailActions)
    m.detailContent.AppendChild(m.detailEpisodes)
    m.detailContent.AppendChild(m.detailChapters)
    m.detailContent.AppendChild(m.detailSimilar)
    m.profileLabel = m.top.findNode("profileLabel")
    m.persistentHeader = m.top.findNode("persistentHeader")
    m.video = m.top.findNode("video")
    m.endScreen = m.top.findNode("endScreen")
    m.endHeading = m.top.findNode("endHeading")
    m.endTitle = m.top.findNode("endTitle")
    m.endMessage = m.top.findNode("endMessage")
    m.endCountdownLabel = m.top.findNode("endCountdownLabel")
    m.endSuggestions = m.top.findNode("endSuggestions")
    m.endCountdownTimer = m.top.findNode("endCountdownTimer")
    m.endButtons = []
    for i = 0 to 3
        m.endButtons.Push({ bg: m.top.findNode("endButton" + i.ToStr()), label: m.top.findNode("endButtonLabel" + i.ToStr()) })
    end for
    m.endActions = []
    m.endFocusIndex = 0
    m.endSuggestionWorks = []
    m.endCountdown = 0
    m.pairingTimer = m.top.findNode("pairingTimer")
    m.clockTime = m.top.findNode("clockTime")
    m.clockDate = m.top.findNode("clockDate")
    m.clockTimer = m.top.findNode("clockTimer")
    m.heartbeatTimer = m.top.findNode("heartbeatTimer")
    m.playerControls = m.top.findNode("playerControls")
    m.playerProgressTrack = m.top.findNode("playerProgressTrack")
    m.playerBufferedFill = m.top.findNode("playerBufferedFill")
    m.playerProgressFill = m.top.findNode("playerProgressFill")
    m.bufferedSeconds = 0
    m.playerPreviousLabel = m.top.findNode("playerPreviousLabel")
    m.playerPlayPauseLabel = m.top.findNode("playerPlayPauseLabel")
    m.playerNextLabel = m.top.findNode("playerNextLabel")
    m.playerTimeLabel = m.top.findNode("playerTimeLabel")
    m.controlBarProgressTimer = m.top.findNode("controlBarProgressTimer")
    m.playerAutoHideTimer = m.top.findNode("playerAutoHideTimer")
    m.browseKeyArtTimer = m.top.findNode("browseKeyArtTimer")

    m.profilesRow.ObserveField("rowItemSelected", "onProfileSelected")
    m.profilesRow.ObserveField("rowItemFocused", "onProfilesRowFocused")
    m.settingsSectionList.ObserveField("itemFocused", "onSettingsSectionFocused")
    m.settingsActionList.ObserveField("itemSelected", "onSettingsActionSelected")
    m.library.ObserveField("rowItemSelected", "onLibraryItemSelected")
    m.library.ObserveField("rowItemFocused", "onLibraryItemFocused")
    m.browseGrid.ObserveField("itemSelected", "onBrowseItemSelected")
    m.browseGrid.ObserveField("itemFocused", "onBrowseItemFocused")
    m.searchGrid.ObserveField("itemSelected", "onSearchItemSelected")
    m.searchGrid.ObserveField("itemFocused", "onSearchItemFocused")
    m.playlistsGrid.ObserveField("itemSelected", "onPlaylistDirectoryItemSelected")
    m.playlistItemsGrid.ObserveField("itemSelected", "onPlaylistItemSelected")

    ' 5 rails total, matching the real Home page exactly (confirmed live:
    ' Continue/Start watching, New movies, New series, More movies, More
    ' series -- there is no "New Sites" rail there at all).
    continueRail = createHomeRail(m.homeContent)
    moviesRail = createHomeRail(m.homeContent)
    seriesRail = createHomeRail(m.homeContent)
    moreMoviesRail = createHomeRail(m.homeContent)
    moreSeriesRail = createHomeRail(m.homeContent)
    m.continueRailGroup = continueRail.group : m.continueTitle = continueRail.title : m.continueRow = continueRail.row
    m.moviesRailGroup = moviesRail.group : m.moviesTitle = moviesRail.title : m.moviesRow = moviesRail.row
    m.seriesRailGroup = seriesRail.group : m.seriesTitle = seriesRail.title : m.seriesRow = seriesRail.row
    m.moreMoviesRailGroup = moreMoviesRail.group : m.moreMoviesTitle = moreMoviesRail.title : m.moreMoviesRow = moreMoviesRail.row
    m.moreSeriesRailGroup = moreSeriesRail.group : m.moreSeriesTitle = moreSeriesRail.title : m.moreSeriesRow = moreSeriesRail.row
    m.continueRow.ObserveField("rowItemFocused", "onHomeItemFocused")
    m.continueRow.ObserveField("rowItemSelected", "onHomeItemSelected")
    m.moviesRow.ObserveField("rowItemFocused", "onHomeItemFocused")
    m.moviesRow.ObserveField("rowItemSelected", "onHomeItemSelected")
    m.seriesRow.ObserveField("rowItemFocused", "onHomeItemFocused")
    m.seriesRow.ObserveField("rowItemSelected", "onHomeItemSelected")
    m.moreMoviesRow.ObserveField("rowItemFocused", "onHomeItemFocused")
    m.moreMoviesRow.ObserveField("rowItemSelected", "onHomeItemSelected")
    m.moreSeriesRow.ObserveField("rowItemFocused", "onHomeItemFocused")
    m.moreSeriesRow.ObserveField("rowItemSelected", "onHomeItemSelected")
    m.homeShown = false
    m.homeMovies = []
    m.homeSeries = []
    m.homeMoreMovies = []
    m.homeMoreSeries = []
    m.homeContinueEntries = []
    m.homeFallbackItems = []
    m.currentContinueWorks = []
    m.visibleRails = []
    m.homeFocusIndex = 0
    m.homeColIndex = 0
    m.homeLeftProxy = m.top.findNode("homeLeftProxy")
    m.navDockMode = false
    m.navDockIndex = 0
    m.navDockReturnState = "home"
    ' Layout rounded group panels after dock mode defaults exist (calling
    ' renderNavDockFocus before m.navDockMode is set suspends in the debugger).
    layoutNavDock()
    renderNavDockFocus()
    m.profiles = []
    ' Hide Sites until GET /api/v1/catalog/kinds confirms the viewer has a site library.
    applyNavDockKindFilter()
    m.detailOrigin = "home"
    m.currentProfileName = ""
    m.browseKind = ""
    m.browseLabel = ""
    m.browseItems = []
    m.browseTotal = invalid
    m.browseAlphabetMode = false
    m.browseAlphabetIndex = 0
    m.browseAlphabetPendingLetter = invalid
    m.browseFiltersButtonFocused = false
    m.browseFiltersMode = false
    m.browseFiltersIndex = 0
    m.browseSort = "title"
    m.browseOrder = "asc"
    m.searchQuery = ""
    m.searchItems = []
    m.searchDisplayItems = []
    m.searchFilterKind = ""
    m.searchFilterMode = false
    m.searchFilterIndex = 0
    m.playlists = []
    m.playlistDetailOpen = false
    m.selectedPlaylist = invalid
    m.playlistItems = []
    m.playlistItemQueue = []
    m.pendingPlaylistItem = invalid
    m.detailSeasons = []
    m.detailGroupKind = ""
    m.currentMediaFileId = ""
    m.pendingChapterSeekMs = invalid
    m.similarWorks = []
    m.playbackEpisodeList = []
    m.playbackEpisodeIndex = -1
    m.settingsSectionIndex = 0
    m.audioLanguageCodes = ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", "hi", "ar", "th"]
    m.audioLanguageLabels = ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Japanese", "Korean", "Chinese", "Hindi", "Arabic", "Thai"]
    m.preferredAudioLanguage = invalid

    m.detailActions.ObserveField("itemSelected", "onDetailActionSelected")
    m.detailEpisodes.ObserveField("rowItemSelected", "onDetailEpisodeSelected")
    m.detailChapters.ObserveField("rowItemSelected", "onDetailChapterSelected")
    m.detailSimilar.ObserveField("rowItemSelected", "onDetailSimilarSelected")
    m.pairingTimer.ObserveField("fire", "pollDeviceToken")
    m.clockTimer.ObserveField("fire", "updateClock")
    m.hostedLinkTimer.ObserveField("fire", "pollHostedLink")
    m.heartbeatTimer.ObserveField("fire", "sendHeartbeat")
    m.video.ObserveField("state", "onVideoStateChanged")
    m.endCountdownTimer.ObserveField("fire", "onEndCountdownTick")
    m.endSuggestions.ObserveField("rowItemSelected", "onEndSuggestionSelected")
    m.video.ObserveField("downloadedSegment", "onDownloadedSegment")
    m.controlBarProgressTimer.ObserveField("fire", "updatePlayerProgress")
    m.playerAutoHideTimer.ObserveField("fire", "hidePlayerControls")
    if m.browseKeyArtTimer <> invalid
        m.browseKeyArtTimer.ObserveField("fire", "onBrowseKeyArtTimer")
    end if

    m.requestBusy = false
    m.pendingApiQueue = []
    m.pendingPlaybackRequest = invalid
    m.items = []
    m.totalItems = invalid
    m.profiles = []
    m.playbackSessionId = ""
    m.playbackEnded = true
    m.lastVideoState = ""
    m.session = LoadSession()
    m.serverAddresses = m.session.serverUrls
    m.serverIndex = 0
    m.serverUrl = ""
    if m.serverAddresses.Count() > 0 then m.serverUrl = m.serverAddresses[0]
    m.accessToken = m.session.accessToken
    m.refreshToken = m.session.refreshToken
    m.deviceId = m.session.deviceId
    publishArtAuthHeaders()
    m.profileLabel.text = m.session.profileName
    setListContent(m.detailActions, ["Play"])

    updateClock()
    m.clockTimer.control = "start"

    if m.serverUrl = ""
        beginHostedLink()
    else
        connectToServer()
    end if
end sub

' Matches tv-web's App.tsx formatTime/formatDate (hour12:false 24-hour clock,
' short-weekday + numeric-day + long-month date), shown in the persistent
' header on every authenticated screen via clockTime/clockDate. Roku's
' roDateTime defaults to UTC on creation -- ToLocalTime() is required to get
' the device's actual configured local time, matching what a browser's Date
' object already gives tv-web for free.
sub updateClock()
    dt = CreateObject("roDateTime")
    dt.ToLocalTime()
    hourStr = dt.GetHours().ToStr()
    if dt.GetHours() < 10 then hourStr = "0" + hourStr
    minuteStr = dt.GetMinutes().ToStr()
    if dt.GetMinutes() < 10 then minuteStr = "0" + minuteStr
    m.clockTime.text = hourStr + ":" + minuteStr

    ' Web App.tsx formatDate: short weekday + day + long month, uppercase
    ' style shown on TV freezes as "WED 29 JULY" (no comma).
    weekdayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    monthNames = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
    weekday = ""
    dayOfWeek = dt.GetDayOfWeek()
    if dayOfWeek >= 0 and dayOfWeek <= 6 then weekday = weekdayNames[dayOfWeek]
    month = ""
    monthIndex = dt.GetMonth()
    if monthIndex >= 1 and monthIndex <= 12 then month = monthNames[monthIndex - 1]
    m.clockDate.text = weekday + " " + dt.GetDayOfMonth().ToStr() + " " + month
    ' Pairing "Code refreshes in M:SS" shares this 1s clock tick (web uses setInterval 1000).
    if m.top.screenState = "pairing" then updatePairingCountdown()
end sub

sub connectToServer()
    ' Stay on pairing chrome (no fullscreen Loading wall).
    showPairingBusy("Connecting…", "Checking " + m.serverUrl + "…")
    sendApi("version", "GET", "/api/system/version", invalid, false)
end sub

' Advances to the next remembered server address and retries the
' connectivity check against it. A simple sequential "try next on
' failure" loop -- not a parallel fan-out. Returns false once every
' remembered address has failed, so the caller falls through to the
' normal failure UI instead.
function tryNextServerAddress() as Boolean
    if m.serverIndex + 1 >= m.serverAddresses.Count() then return false
    m.serverIndex += 1
    m.serverUrl = m.serverAddresses[m.serverIndex]
    connectToServer()
    return true
end function

sub openServerDialog()
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = "Connect to Playarr Server"
    dialog.message = ["Enter the full HTTP or HTTPS server address. Separate multiple addresses with commas to add fallback servers."]
    dialog.text = joinStrings(m.serverAddresses, ", ")
    dialog.buttons = ["Connect"]
    dialog.ObserveField("buttonSelected", "onServerDialogButton")
    m.top.dialog = dialog
end sub

sub onServerDialogButton(event as Object)
    if event.GetData() <> 0 then return
    candidates = NormaliseServerUrlList(m.top.dialog.text)
    if candidates.Count() = 0
        m.top.dialog.message = ["Use one or more full addresses such as https://playarr.example.invalid"]
        return
    end if
    m.serverAddresses = candidates
    m.serverIndex = 0
    m.serverUrl = candidates[0]
    SaveServerAddresses(candidates)
    m.top.dialog.close = true
    connectToServer()
end sub

' First-launch bootstrap: gets a short code/QR from the same hosted linking
' service tv-webos/tv-tizen already use, so a new Roku never needs a typed
' server address. The viewer scans it (or visits the URL) on a phone,
' chooses their Playarr Server there, and approves -- see
' acceptHostedLinkClaim for how the resulting claim hands off into the
' existing on-device RFC 8628 token exchange.
sub beginHostedLink()
    if m.requestBusy then return
    strings = PairingUiStrings(ResolvePairingLanguage(m.languagePreference))
    showPairingBusy(strings.title, strings.creating)
    startApiRequest({
        action: "hostedLinkCode"
        method: "POST"
        path: ""
        url: AppConfig().hostedLinkOrigin + "/api/link/code"
        body: { client_platform: "web" }
        accessToken: ""
    })
end sub

sub acceptHostedLinkCode(data as Object)
    if data = invalid or data.device_code = invalid or data.user_code = invalid
        m.lastFailedAction = "hostedLinkCode"
        strings = PairingUiStrings(ResolvePairingLanguage(m.languagePreference))
        showPairingBusy(strings.failed, strings.unavailable)
        return
    end if
    m.hostedDeviceCode = data.device_code
    m.hostedLinkInterval = data.interval
    if m.hostedLinkInterval < 2 then m.hostedLinkInterval = 2
    strings = PairingUiStrings(ResolvePairingLanguage(m.languagePreference))
    if m.pairingKicker <> invalid then m.pairingKicker.text = UCase(strings.kicker)
    if m.pairingTitle <> invalid then m.pairingTitle.text = strings.title
    if m.pairingDescription <> invalid
        m.pairingDescription.text = strings.description
        m.pairingDescription.visible = true
    end if
    if m.pairingScan <> invalid
        m.pairingScan.text = strings.scan
        m.pairingScan.visible = true
    end if
    if m.pairingUrl <> invalid
        uri = data.verification_uri
        if uri = invalid then uri = "https://playarr.app/link"
        m.pairingUrl.text = uri
        m.pairingUrl.visible = true
    end if
    if m.pairingEnter <> invalid
        m.pairingEnter.text = strings.enter
        m.pairingEnter.visible = true
    end if
    m.pairingCode.text = data.user_code
    m.pairingStatus.text = strings.waiting
    if m.pairingManualLabel <> invalid then m.pairingManualLabel.text = strings.manualBtn
    applyPairingChrome()
    ' expires_in seconds (hosted) — cap 5 minutes like web.
    expiresIn = data.expires_in
    if expiresIn = invalid then expiresIn = 300
    if expiresIn > 300 then expiresIn = 300
    if expiresIn < 1 then expiresIn = 300
    m.pairingCodeExpiresAt = CreateObject("roDateTime").AsSeconds() + expiresIn
    updatePairingCountdown()
    qrTargetUrl = data.verification_uri_complete
    if qrTargetUrl = invalid and data.verification_uri <> invalid and data.user_code <> invalid
        qrTargetUrl = data.verification_uri + "?user_code=" + data.user_code
    end if
    if qrTargetUrl <> invalid
        m.pairingQr.uri = AppConfig().hostedLinkOrigin + "/api/link/qr?value=" + UrlEncode(qrTargetUrl)
        m.pairingQr.visible = true
        if m.pairingQrBg <> invalid then m.pairingQrBg.visible = true
        if m.pairingQrFrame <> invalid then m.pairingQrFrame.visible = true
    else
        hidePairingQr()
    end if
    showOnly("pairing")
    m.top.screenState = "pairing"
    m.hostedLinkTimer.duration = m.hostedLinkInterval
    m.hostedLinkTimer.control = "start"
end sub

sub pollHostedLink()
    if m.requestBusy or m.hostedDeviceCode = invalid or m.hostedDeviceCode = "" then return
    startApiRequest({
        action: "hostedLinkPoll"
        method: "GET"
        path: ""
        url: AppConfig().hostedLinkOrigin + "/api/link/code/" + UrlEncode(m.hostedDeviceCode)
        body: invalid
        accessToken: ""
    })
end sub

' The claim's server_device_code was already approved by the phone-side
' session (it called the real server's own device-authorisation endpoint on
' our behalf), so this hands straight into the existing pollDeviceToken loop
' instead of requesting a second code of our own.
sub acceptHostedLinkClaim(data as Object)
    if data = invalid or data.server_url = invalid or data.server_device_code = invalid
        m.lastFailedAction = "hostedLinkCode"
        showPairingBusy("Couldn’t continue", "Playarr returned an invalid link response." + Chr(10) + "Press OK to retry.")
        return
    end if
    m.hostedLinkTimer.control = "stop"
    servers = data.server_urls
    if servers = invalid or servers.Count() = 0 then servers = [data.server_url]
    m.serverAddresses = servers
    m.serverIndex = 0
    m.serverUrl = data.server_url
    SaveServerAddresses(m.serverAddresses)
    hidePairingQr()
    m.deviceCode = data.server_device_code
    m.pollInterval = 2
    m.pairingStatus.text = "Finishing sign-in…"
    m.pairingTimer.duration = m.pollInterval
    m.pairingTimer.control = "start"
    pollDeviceToken()
end sub

sub sendApi(action as String, method as String, path as String, body as Dynamic, authenticated = true as Boolean)
    request = {
        action: action
        method: method
        path: path
        url: m.serverUrl + path
        body: body
        accessToken: ""
    }
    if authenticated then request.accessToken = m.accessToken
    ' Single-flight ApiTask: never silently drop requests. Home chain
    ' (catalogKinds → watchProgress → rails) used to vanish forever when
    ' requestBusy was still true from an earlier call, leaving left-nav-only
    ' Home with no content. Playback keeps a dedicated slot at the front.
    if m.requestBusy
        if action = "playback"
            m.pendingPlaybackRequest = request
        else
            if m.pendingApiQueue = invalid then m.pendingApiQueue = []
            m.pendingApiQueue.Push(request)
        end if
        return
    end if
    startApiRequest(request)
end sub

sub startApiRequest(request as Object)
    m.requestBusy = true
    m.activeRequest = request
    m.pendingAction = request.action
    task = CreateObject("roSGNode", "ApiTask")
    task.ObserveField("result", "onApiResult")
    task.request = request
    m.apiTask = task
    task.control = "RUN"
end sub

sub flushPendingApiRequests()
    if m.requestBusy then return
    ' Playback first (user hit Play while embellishments were in flight).
    if m.pendingPlaybackRequest <> invalid
        req = m.pendingPlaybackRequest
        m.pendingPlaybackRequest = invalid
        startApiRequest(req)
        return
    end if
    if m.pendingApiQueue = invalid or m.pendingApiQueue.Count() = 0 then return
    req = m.pendingApiQueue.Shift()
    startApiRequest(req)
end sub

sub flushPendingPlaybackRequest()
    flushPendingApiRequests()
end sub

sub onApiResult(event as Object)
    result = event.GetData()
    if result = invalid then return
    action = m.pendingAction
    request = m.activeRequest
    m.requestBusy = false
    m.apiTask = invalid

    if not result.ok
        if result.status = 401 and action <> "refresh" and request.accessToken <> "" and m.refreshToken <> ""
            m.retryRequest = request
            refreshSession()
            return
        end if
        if action = "version"
            if tryNextServerAddress() then return
        end if
        if action = "hostedLinkPoll" and result.status = 404
            beginHostedLink()
            return
        end if
        handleApiFailure(action, result)
        return
    end if

    if action = "hostedLinkCode"
        acceptHostedLinkCode(result.data)
    else if action = "hostedLinkPoll"
        if result.data <> invalid and result.data.error = "authorization_pending"
            m.pairingStatus.text = "Waiting for approval…"
        else
            acceptHostedLinkClaim(result.data)
        end if
    else if action = "version"
        if m.refreshToken <> "" and m.deviceId <> ""
            refreshSession()
        else
            beginPairing()
        end if
    else if action = "refresh"
        acceptTokenResponse(result.data)
        if m.retryRequest <> invalid
            retry = m.retryRequest
            m.retryRequest = invalid
            retry.accessToken = m.accessToken
            retry.url = m.serverUrl + retry.path
            startApiRequest(retry)
        else
            loadProfiles()
        end if
    else if action = "deviceCode"
        acceptDeviceCode(result.data)
    else if action = "deviceToken"
        m.pairingTimer.control = "stop"
        acceptTokenResponse(result.data)
        loadProfiles()
    else if action = "profiles"
        showProfiles(result.data)
    else if action = "catalogKinds"
        acceptCatalogKinds(result.data)
    else if action = "catalog" or action = "catalogMore"
        acceptCatalog(result.data, action = "catalogMore")
    else if action = "browseCatalog" or action = "browseCatalogMore"
        acceptBrowseCatalog(result.data, action = "browseCatalogMore")
    else if action = "search"
        acceptSearchResults(result.data)
    else if action = "playlists"
        acceptPlaylists(result.data)
    else if action = "playlistItems"
        acceptPlaylistItems(result.data)
    else if action = "playlistItemWork"
        acceptPlaylistItemWork(result.data)
    else if action = "playerPrefs" or action = "playerPrefsSave"
        acceptPlayerPreferences(result.data)
    else if action = "profilePin" or action = "profilePinSave"
        acceptProfilePinSetting(result.data)
    else if action = "watchProgress"
        acceptWatchProgress(result.data)
    else if action = "homeWorkDetail"
        acceptHomeWorkDetail(result.data)
    else if action = "homeFallback"
        m.homeFallbackItems = filterHomePrimaryKinds(itemsFromCatalog(result.data))
        ' Web mergeRecent(series, movie, site) for Start watching; sites gated.
        sendApi("homeFallbackSeries", "GET", "/api/v1/catalog?kind=series&available_only=true&sort=recent&limit=8&offset=0", invalid, true)
    else if action = "homeFallbackSeries"
        seriesItems = filterHomePrimaryKinds(itemsFromCatalog(result.data))
        for each work in seriesItems
            m.homeFallbackItems.Push(work)
        end for
        m.homeFallbackItems = takeFirstWorks(sortWorksByAddedAtDesc(m.homeFallbackItems), 8)
        loadHomeMovies()
    else if action = "homeMovies"
        m.homeMovies = filterHomePrimaryKinds(itemsFromCatalog(result.data))
        loadHomeSeries()
    else if action = "homeSeries"
        m.homeSeries = filterHomePrimaryKinds(itemsFromCatalog(result.data))
        loadHomeMoreMovies()
    else if action = "homeMoreMovies"
        m.homeMoreMovies = filterHomePrimaryKinds(itemsFromCatalog(result.data))
        loadHomeMoreSeries()
    else if action = "homeMoreSeries"
        m.homeMoreSeries = filterHomePrimaryKinds(itemsFromCatalog(result.data))
        finishHomeLoad()
    else if action = "detail"
        showDetail(result.data)
    else if action = "chapters"
        acceptDetailChapters(result.data)
    else if action = "endSimilar"
        acceptEndSuggestions(result.data)
    else if action = "similarPrimary"
        acceptSimilarPrimary(result.data)
    else if action = "similarGenre"
        acceptSimilarGenrePage(result.data)
    else if action = "playback"
        startPlayback(result.data)
    else if action = "playbackEvent" and m.queuedPlaybackEvent <> invalid
        queued = m.queuedPlaybackEvent
        m.queuedPlaybackEvent = invalid
        sendPlaybackEvent(queued)
    end if
    ' After any completed request, start a queued Play if the viewer hit
    ' Play while chapters/similar still held the single-flight slot.
    flushPendingPlaybackRequest()
end sub

sub handleApiFailure(action as String, result as Object)
    if action = "deviceToken" and result.data <> invalid
        code = result.data.error
        if code = "authorization_pending"
            m.pairingStatus.text = "Waiting for approval…"
            return
        else if code = "slow_down"
            m.pollInterval += 5
            m.pairingTimer.duration = m.pollInterval
            m.pairingStatus.text = "Waiting for approval…"
            return
        else if code = "expired_token"
            beginPairing()
            return
        end if
    end if

    if action = "refresh"
        ClearSession(true)
        m.accessToken = ""
        m.refreshToken = ""
        m.deviceId = ""
        publishArtAuthHeaders()
        beginPairing()
        return
    end if

    ' Telemetry is best effort and must never cover or stop native playback.
    if action = "playbackEvent"
        if m.queuedPlaybackEvent <> invalid
            queued = m.queuedPlaybackEvent
            m.queuedPlaybackEvent = invalid
            sendPlaybackEvent(queued)
        end if
        return
    end if

    ' Player preferences are best effort and must never knock the viewer out
    ' of the settings screen -- a failed fetch leaves the "Loading…" detail
    ' text in place (still invalid, so the next section revisit retries) and
    ' a failed save just leaves the previous preferred_audio_language shown.
    if action = "playerPrefs" or action = "playerPrefsSave"
        return
    end if

    ' Profile lock is best effort exactly like player preferences above -- a
    ' failed fetch leaves the "Loading…" detail text in place (still invalid,
    ' so revisiting the section retries), a failed save just leaves the PIN
    ' dialog open with an inline error instead of closing it.
    if action = "profilePin"
        return
    end if
    if action = "profilePinSave"
        if m.top.dialog <> invalid
            m.top.dialog.message = ["Could not save that PIN. Try again."]
        end if
        return
    end if

    ' Playlist item hydration is best effort per item, exactly like
    ' Continue Watching's homeWorkDetail below: one failed
    ' GET /api/v1/catalog/{work_id} just skips that item and continues the
    ' chain rather than blocking the whole playlist behind a hard error.
    ' The playlist directory (`playlists`) and its item listing
    ' (`playlistItems`) are deliberately NOT best-effort here, same as
    ' browseCatalog/search above: a failed top-level fetch falls through to
    ' the generic retry-status screen below.
    if action = "playlistItemWork"
        processNextPlaylistItem()
        return
    end if

    ' Catalog kinds filter is best-effort: if it fails, keep Sites hidden
    ' (applyNavDockKindFilter default) and still load home rails.
    if action = "catalogKinds"
        applyNavDockKindFilter()
        loadWatchProgress()
        return
    end if

    ' Product surfaces stay in-shell on API failure — never a fullscreen
    ' status wall mid-navigation (that is not how Playarr looks).
    if action = "browseCatalog" or action = "browseCatalogMore"
        if m.browseCountLabel <> invalid then m.browseCountLabel.text = "UNAVAILABLE"
        showOnly("browse")
        m.top.screenState = "browse"
        m.browseGrid.SetFocus(true)
        return
    end if
    if action = "search"
        showSearchEmptyState(true)
        showOnly("search")
        m.top.screenState = "search"
        m.searchGrid.SetFocus(true)
        return
    end if
    if action = "playlists"
        m.playlists = []
        buildPlaylistDirectoryContent()
        m.playlistsTitle.text = "Playlists  •  unavailable"
        showOnly("playlists")
        m.top.screenState = "playlists"
        m.playlistsGrid.SetFocus(true)
        return
    end if
    if action = "playlistItems"
        m.playlistItems = []
        buildGridContent(m.playlistItemsGrid, m.playlistItems)
        showOnly("playlists")
        m.top.screenState = "playlists"
        m.playlistItemsGrid.SetFocus(true)
        return
    end if
    if action = "catalog" or action = "catalogMore"
        m.libraryTitle.text = "Library  •  unavailable"
        showOnly("library")
        m.top.screenState = "library"
        m.library.SetFocus(true)
        return
    end if
    if action = "detail"
        showOnly("home")
        m.top.screenState = "home"
        focusCurrentHomeRail()
        return
    end if
    if action = "playback"
        showOnly("detail")
        m.top.screenState = "detail"
        m.detailActions.SetFocus(true)
        return
    end if

    ' Home screen data is best effort per rail: one failed step degrades that
    ' rail to empty (or skips a hydration candidate) and continues the chain
    ' rather than blocking the whole home screen behind a hard error.
    if action = "watchProgress"
        m.homeWorkQueue = []
        finishContinueWatching()
        return
    else if action = "homeWorkDetail"
        m.pendingHomeProgress = invalid
        processNextHomeWork()
        return
    else if action = "homeFallback"
        m.homeFallbackItems = []
        sendApi("homeFallbackSeries", "GET", "/api/v1/catalog?kind=series&available_only=true&sort=recent&limit=8&offset=0", invalid, true)
        return
    else if action = "homeFallbackSeries"
        m.homeFallbackItems = takeFirstWorks(m.homeFallbackItems, 8)
        loadHomeMovies()
        return
    else if action = "homeMovies"
        m.homeMovies = []
        loadHomeSeries()
        return
    else if action = "homeSeries"
        m.homeSeries = []
        loadHomeMoreMovies()
        return
    else if action = "homeMoreMovies"
        m.homeMoreMovies = []
        loadHomeMoreSeries()
        return
    else if action = "homeMoreSeries"
        m.homeMoreSeries = []
        finishHomeLoad()
        return
    end if

    ' Chapters/Similar Titles are best-effort embellishments on the detail
    ' screen, not core to it (the real page functions fine without them,
    ' e.g. /similar 404ing is an expected, handled case there too): a
    ' failed fetch just leaves that rail hidden and continues the chain
    ' rather than blocking the whole detail screen behind a hard error.
    ' Suggestions on the end screen are best effort: no row on failure.
    if action = "endSimilar" then return
    if action = "chapters"
        loadSimilarTitles(m.selectedDetail.work)
        return
    else if action = "similarPrimary"
        ' Expected/normal for a catalog with no cached embeddings (confirmed
        ' live: 404s every time against this test account's own catalog) --
        ' the genre-based fallback below is the real, working path for
        ' viewers on a catalog like that, not an error state.
        startSimilarGenreFallback()
        return
    else if action = "similarGenre"
        m.similarIndex += 1
        loadNextSimilarGenrePage()
        return
    end if

    m.lastFailedAction = action
    ' Pre-auth: stay on pairing chrome. Never a fullscreen Loading wall mid-link.
    if m.accessToken = invalid or m.accessToken = ""
        showPairingBusy("Couldn’t continue", result.error + Chr(10) + "Press OK to retry.")
    else
        showStatus("Couldn’t continue", result.error + Chr(10) + "Press OK to retry.", false)
    end if
    flushPendingPlaybackRequest()
end sub

sub refreshSession()
    if m.refreshToken = "" or m.deviceId = ""
        beginPairing()
        return
    end if
    ' Stay off the fullscreen status wall for session restore; profiles shell
    ' appears as soon as the refresh succeeds (loadProfiles is in-shell).
    sendApi("refresh", "POST", "/api/v1/auth/refresh", {
        device_id: m.deviceId
        refresh_token: m.refreshToken
    }, false)
end sub

sub beginPairing()
    ' Match web `/login/qr`: always use the hosted playarr.app device-link
    ' broker so the viewer gets a scanable QR (verification URI complete is
    ' always https://playarr.app/link?…). Direct POST /oauth/device/code to
    ' a remembered relay URL only shows a typed code and cannot use the
    ' hosted `/api/link/qr` renderer (it only encodes playarr.app links).
    m.pairingTimer.control = "stop"
    m.hostedLinkTimer.control = "stop"
    beginHostedLink()
end sub

function pairingHasSession() as Boolean
    if m.accessToken <> invalid and m.accessToken <> "" then return true
    if m.refreshToken <> invalid and m.refreshToken <> "" then return true
    return false
end function

' Web LoginShell always exposes onBack → /profiles. Chrome back + remote Back
' always return to Who's watching (empty list + Sign in when no session).
sub returnFromPairingToProfiles()
    m.hostedLinkTimer.control = "stop"
    m.pairingTimer.control = "stop"
    m.pairingCodeExpiresAt = 0
    if m.accessToken <> invalid and m.accessToken <> ""
        loadProfiles()
        return
    end if
    if m.refreshToken <> invalid and m.refreshToken <> "" and m.deviceId <> invalid and m.deviceId <> ""
        refreshSession()
        return
    end if
    ' No live token: still show profiles shell (cached avatars or Sign in only).
    if m.profiles = invalid then m.profiles = []
    buildProfileAvatarContent(m.profiles)
    showOnly("profiles")
    m.top.screenState = "profiles"
    m.profilesRow.SetFocus(true)
end sub

' Pairing chrome in place of fullscreen statusGroup (no Loading wall).
' Matches web /login/qr panel (kicker + title + message) with theme/lang chrome.
sub showPairingBusy(title as String, message as String)
    applyPairingChrome()
    strings = PairingUiStrings(ResolvePairingLanguage(m.languagePreference))
    if m.pairingKicker <> invalid then m.pairingKicker.text = UCase(strings.kicker)
    if m.pairingTitle <> invalid then m.pairingTitle.text = title
    if m.pairingDescription <> invalid
        m.pairingDescription.text = message
        m.pairingDescription.visible = true
    end if
    if m.pairingScan <> invalid then m.pairingScan.visible = false
    if m.pairingUrl <> invalid then m.pairingUrl.visible = false
    if m.pairingEnter <> invalid then m.pairingEnter.visible = false
    m.pairingCode.text = ""
    m.pairingStatus.text = ""
    if m.pairingTimerLabel <> invalid then m.pairingTimerLabel.text = ""
    if m.pairingManualLabel <> invalid then m.pairingManualLabel.text = strings.manualBtn
    m.pairingCodeExpiresAt = 0
    hidePairingQr()
    showOnly("pairing")
    m.top.screenState = "pairing"
    if m.pairingThemeHit <> invalid
        m.pairingThemeHit.SetFocus(true)
    else
        m.top.SetFocus(true)
    end if
    applyPairingChromeFocus()
end sub

' Apply theme wash + ink colours + chrome labels for current prefs.
' Chrome matches web .language-dropdown-trigger / .device-login-manual.
sub applyPairingChrome()
    theme = ResolvePairingTheme(m.themePreference)
    lang = ResolvePairingLanguage(m.languagePreference)
    isLight = theme = "light"
    if m.pairingAuthBg <> invalid
        if isLight
            m.pairingAuthBg.uri = "pkg:/images/pairing-auth-bg-light.png"
        else
            m.pairingAuthBg.uri = "pkg:/images/pairing-auth-bg.png"
        end if
    end if
    m.pairingChromeIsLight = isLight
    iconTheme = "pkg:/images/pairing-icon-theme.png"
    iconLang = "pkg:/images/pairing-icon-lang.png"
    iconChev = "pkg:/images/pairing-icon-chevron.png"
    if isLight
        iconTheme = "pkg:/images/pairing-icon-theme-light.png"
        iconLang = "pkg:/images/pairing-icon-lang-light.png"
        iconChev = "pkg:/images/pairing-icon-chevron-light.png"
    end if
    if m.pairingThemeIcon <> invalid then m.pairingThemeIcon.uri = iconTheme
    if m.pairingLangIcon <> invalid then m.pairingLangIcon.uri = iconLang
    if m.pairingThemeChevron <> invalid then m.pairingThemeChevron.uri = iconChev
    if m.pairingLangChevron <> invalid then m.pairingLangChevron.uri = iconChev
    ink = &hF4F0F1FF
    inkSoft = &hC5B8BDFF
    inkMuted = &h887A82FF
    if isLight
        ink = &h382621FF
        inkSoft = &h675961FF
        inkMuted = &hA5969EFF
    end if
    if m.pairingKicker <> invalid then m.pairingKicker.color = inkMuted
    if m.pairingTitle <> invalid then m.pairingTitle.color = ink
    if m.pairingDescription <> invalid then m.pairingDescription.color = inkSoft
    if m.pairingScan <> invalid then m.pairingScan.color = inkSoft
    if m.pairingUrl <> invalid then m.pairingUrl.color = ink
    if m.pairingEnter <> invalid then m.pairingEnter.color = inkSoft
    if m.pairingCode <> invalid then m.pairingCode.color = ink
    if m.pairingStatus <> invalid then m.pairingStatus.color = inkSoft
    if m.pairingTimerLabel <> invalid then m.pairingTimerLabel.color = inkMuted
    if m.pairingManualLabel <> invalid
        m.pairingManualLabel.color = inkSoft
        m.pairingManualLabel.text = PairingUiStrings(lang).manualBtn
    end if
    if m.pairingThemeLabel <> invalid
        m.pairingThemeLabel.color = ink
        m.pairingThemeLabel.text = PairingThemeChromeLabel(m.themePreference, lang)
    end if
    if m.pairingLangLabel <> invalid
        m.pairingLangLabel.color = ink
        m.pairingLangLabel.text = PairingLanguageChromeLabel(m.languagePreference)
    end if
    if m.pairingManualHint <> invalid
        m.pairingManualHint.visible = false
        m.pairingManualHint.text = ""
    end if
    ' Always show chrome back (web LoginShell onBack → profiles).
    if m.pairingBackBtn <> invalid then m.pairingBackBtn.visible = true
    if m.pairingBackHit <> invalid
        m.pairingBackHit.visible = true
        m.pairingBackHit.focusable = true
    end if
    applyPairingChromeFocus()
end sub

' Rest vs focus posters: web trigger border goes accent when focused/expanded.
function pairingChromeUri(kind as String, focused as Boolean) as String
    isLight = m.pairingChromeIsLight = true
    if kind = "theme"
        if focused
            if isLight then return "pkg:/images/pairing-chrome-dd-theme-focus-light.png"
            return "pkg:/images/pairing-chrome-dd-theme-focus.png"
        end if
        if isLight then return "pkg:/images/pairing-chrome-dd-theme-light.png"
        return "pkg:/images/pairing-chrome-dd-theme.png"
    else if kind = "lang"
        if focused
            if isLight then return "pkg:/images/pairing-chrome-dd-focus-light.png"
            return "pkg:/images/pairing-chrome-dd-focus.png"
        end if
        if isLight then return "pkg:/images/pairing-chrome-dd-light.png"
        return "pkg:/images/pairing-chrome-dd.png"
    else if kind = "manual"
        if focused
            if isLight then return "pkg:/images/pairing-manual-pill-focus-light.png"
            return "pkg:/images/pairing-manual-pill-focus.png"
        end if
        if isLight then return "pkg:/images/pairing-manual-pill-light.png"
        return "pkg:/images/pairing-manual-pill.png"
    else if kind = "back"
        if focused
            if isLight then return "pkg:/images/pairing-back-btn-focus-light.png"
            return "pkg:/images/pairing-back-btn-focus.png"
        end if
        if isLight then return "pkg:/images/pairing-back-btn-light.png"
        return "pkg:/images/pairing-back-btn.png"
    end if
    return ""
end function

sub applyPairingChromeFocus()
    themeF = m.pairingThemeHit <> invalid and m.pairingThemeHit.IsInFocusChain()
    langF = m.pairingLangHit <> invalid and m.pairingLangHit.IsInFocusChain()
    manualF = m.pairingManualHit <> invalid and m.pairingManualHit.IsInFocusChain()
    backF = m.pairingBackHit <> invalid and m.pairingBackHit.IsInFocusChain()
    if m.pairingThemePill <> invalid then m.pairingThemePill.uri = pairingChromeUri("theme", themeF)
    if m.pairingLangPill <> invalid then m.pairingLangPill.uri = pairingChromeUri("lang", langF)
    if m.pairingManualPill <> invalid then m.pairingManualPill.uri = pairingChromeUri("manual", manualF)
    if m.pairingBackBtn <> invalid then m.pairingBackBtn.uri = pairingChromeUri("back", backF)
end sub

sub refreshPairingCopy()
    strings = PairingUiStrings(ResolvePairingLanguage(m.languagePreference))
    if m.pairingKicker <> invalid then m.pairingKicker.text = UCase(strings.kicker)
    if m.pairingTitle <> invalid then m.pairingTitle.text = strings.title
    if m.pairingDescription <> invalid and m.pairingDescription.visible
        ' Keep busy message if QR hidden; otherwise description.
        if m.pairingQr = invalid or not m.pairingQr.visible
            ' leave busy message
        else
            m.pairingDescription.text = strings.description
        end if
    end if
    if m.pairingScan <> invalid and m.pairingScan.visible then m.pairingScan.text = strings.scan
    if m.pairingEnter <> invalid and m.pairingEnter.visible then m.pairingEnter.text = strings.enter
    if m.pairingStatus <> invalid and m.pairingStatus.text <> "" then m.pairingStatus.text = strings.waiting
    if m.pairingManualLabel <> invalid then m.pairingManualLabel.text = strings.manualBtn
    applyPairingChrome()
    updatePairingCountdown()
end sub

sub openPairingThemePicker()
    lang = ResolvePairingLanguage(m.languagePreference)
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = "Theme"
    dialog.buttons = PairingThemeOptionLabels(lang)
    dialog.ObserveField("buttonSelected", "onPairingThemeDialogButton")
    m.top.dialog = dialog
end sub

sub openPairingLanguagePicker()
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = "Language"
    dialog.buttons = PairingLanguageOptionLabels()
    dialog.ObserveField("buttonSelected", "onPairingLanguageDialogButton")
    m.top.dialog = dialog
end sub

sub onPairingThemeDialogButton(event as Object)
    index = event.GetData()
    if m.top.dialog <> invalid then m.top.dialog.close = true
    m.themePreference = PairingThemePreferenceFromIndex(index)
    SavePairingThemePreference(m.themePreference)
    applyPairingChrome()
    applyProfilesChrome()
    if m.top.screenState = "profiles"
        if m.profilesThemeHit <> invalid then m.profilesThemeHit.SetFocus(true)
        applyProfilesChromeFocus()
    else if m.pairingThemeHit <> invalid
        m.pairingThemeHit.SetFocus(true)
    end if
end sub

sub onPairingLanguageDialogButton(event as Object)
    index = event.GetData()
    if m.top.dialog <> invalid then m.top.dialog.close = true
    m.languagePreference = PairingLanguagePreferenceFromIndex(index)
    SavePairingLanguagePreference(m.languagePreference)
    refreshPairingCopy()
    applyProfilesChrome()
    if m.top.screenState = "profiles"
        if m.profilesLangHit <> invalid then m.profilesLangHit.SetFocus(true)
        applyProfilesChromeFocus()
    else if m.pairingLangHit <> invalid
        m.pairingLangHit.SetFocus(true)
    end if
end sub

sub hidePairingQr()
    if m.pairingQr <> invalid then m.pairingQr.visible = false
    if m.pairingQrBg <> invalid then m.pairingQrBg.visible = false
    if m.pairingQrFrame <> invalid then m.pairingQrFrame.visible = false
end sub

' Web device-login-timer: "Code refreshes in m:ss".
sub updatePairingCountdown()
    if m.pairingTimerLabel = invalid then return
    if m.pairingCodeExpiresAt = invalid or m.pairingCodeExpiresAt <= 0
        m.pairingTimerLabel.text = ""
        return
    end if
    now = CreateObject("roDateTime").AsSeconds()
    remaining = m.pairingCodeExpiresAt - now
    if remaining < 0 then remaining = 0
    minutes = Int(remaining / 60)
    seconds = remaining - (minutes * 60)
    minStr = minutes.ToStr()
    secStr = seconds.ToStr()
    if seconds < 10 then secStr = "0" + secStr
    strings = PairingUiStrings(ResolvePairingLanguage(m.languagePreference))
    m.pairingTimerLabel.text = strings.refreshesPrefix + minStr + ":" + secStr
    ' Auto-renew once when the code expires (same as web renewCode).
    if remaining = 0 and m.top.screenState = "pairing"
        m.pairingCodeExpiresAt = 0
        beginHostedLink()
    end if
end sub

sub acceptDeviceCode(data as Object)
    if data = invalid
        showPairingBusy("Couldn’t continue", "The server returned an invalid device code.")
        return
    end if
    m.deviceCode = data.device_code
    m.pollInterval = data.interval
    if m.pollInterval < 5 then m.pollInterval = 5
    if m.pairingKicker <> invalid then m.pairingKicker.text = "WELCOME HOME"
    if m.pairingTitle <> invalid then m.pairingTitle.text = "Sign in to Playarr"
    if m.pairingDescription <> invalid
        m.pairingDescription.text = "Scan the QR code with your phone or another browser to sign in on this device."
        m.pairingDescription.visible = true
    end if
    if m.pairingScan <> invalid
        m.pairingScan.text = "Scan the QR code, or visit"
        m.pairingScan.visible = true
    end if
    if m.pairingUrl <> invalid
        uri = data.verification_uri
        if uri = invalid then uri = ""
        m.pairingUrl.text = uri
        m.pairingUrl.visible = true
    end if
    if m.pairingEnter <> invalid
        m.pairingEnter.text = "and enter this code"
        m.pairingEnter.visible = true
    end if
    m.pairingCode.text = data.user_code
    m.pairingStatus.text = "Waiting for approval…"
    if m.pairingManualHint <> invalid
        m.pairingManualHint.visible = false
        m.pairingManualHint.text = ""
    end if
    applyPairingChrome()
    expiresIn = data.expires_in
    if expiresIn = invalid then expiresIn = 300
    if expiresIn > 300 then expiresIn = 300
    m.pairingCodeExpiresAt = CreateObject("roDateTime").AsSeconds() + expiresIn
    updatePairingCountdown()
    ' Prefer hosted QR when the complete URI is a playarr.app link; otherwise
    ' hide the tile (hosted /api/link/qr refuses non-playarr.app values).
    qrTarget = data.verification_uri_complete
    if qrTarget = invalid then qrTarget = ""
    if qrTarget = "" and data.verification_uri <> invalid and data.user_code <> invalid
        qrTarget = data.verification_uri + "?user_code=" + data.user_code
    end if
    if Left(qrTarget, 25) = "https://playarr.app/link?"
        m.pairingQr.uri = AppConfig().hostedLinkOrigin + "/api/link/qr?value=" + UrlEncode(qrTarget)
        m.pairingQr.visible = true
        if m.pairingQrBg <> invalid then m.pairingQrBg.visible = true
        if m.pairingQrFrame <> invalid then m.pairingQrFrame.visible = true
    else
        hidePairingQr()
    end if
    showOnly("pairing")
    m.top.screenState = "pairing"
    m.pairingTimer.duration = m.pollInterval
    m.pairingTimer.control = "start"
end sub

sub pollDeviceToken()
    if m.requestBusy or m.deviceCode = "" then return
    sendApi("deviceToken", "POST", "/api/v1/oauth/token", {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        device_code: m.deviceCode
    }, false)
end sub

sub acceptTokenResponse(data as Object)
    m.accessToken = data.access_token
    m.refreshToken = data.refresh_token
    deviceId = DecodeJwtDeviceId(m.accessToken)
    if deviceId <> "" then m.deviceId = deviceId
    SaveTokens(m.accessToken, m.refreshToken, m.deviceId)
    publishArtAuthHeaders()
end sub

' Global art auth for PosterCard: MarkupGrid/RowList itemContent binding does
' not reliably preserve custom ContentNode fields, so cards read headers from
' GetGlobalAA().playarrArtHeaders instead of per-item artHeaders alone.
sub publishArtAuthHeaders()
    g = GetGlobalAA()
    if m.accessToken = invalid or m.accessToken = ""
        g.playarrArtHeaders = invalid
        return
    end if
    g.playarrArtHeaders = ClientHeaders(m.accessToken)
end sub

sub loadProfiles()
    ' In-shell profiles chrome while the list loads (no fullscreen Loading wall).
    if m.profiles = invalid then m.profiles = []
    buildProfileAvatarContent(m.profiles)
    applyProfilesChrome()
    showOnly("profiles")
    m.top.screenState = "profiles"
    focusProfilesRowOnCurrent()
    updateProfileActionsLayout()
    sendApi("profiles", "GET", "/api/v1/users/profiles", invalid, true)
end sub

' ---------------------------------------------------------------------------
' Profiles screen (real-screenshot correction pass)
'
' Renders each profile as a large circular gradient avatar button (a
' ProfileAvatar RowList item, see components/ProfileAvatar.xml) in a
' horizontal row, replacing the old vertical LabelList("profilesList") text
' list -- see MainScene.xml's profilesGroup comment for the full visual
' rationale against the real tv-web screenshot this pass was driven by.
'
' GET /api/v1/users/profiles (ProfileResponse) carries no avatar field at
' all (confirmed against tv-web's generated schema.ts), so this client has
' no way to know which of tv-web's six fixed mascot-icon presets (or a
' viewer-uploaded photo) a given profile actually has chosen server-side.
' profileAvatarPresetId() below reimplements the same deterministic
' id-hash tv-web's defaultProfileAvatarPreset() uses (profileAvatar.ts) as a
' best-effort visual approximation -- it lands on the same preset tv-web
' would show for a profile that has never set an explicit preference, but
' cannot reflect an explicit preset choice or an uploaded photo, since
' neither is exposed by this endpoint. ProfileAvatar.xml draws the chosen
' preset's pre-rendered gradient-circle PNG plus an initial-letter overlay
' standing in for tv-web's SVG mascot icon (Roku has no SVG renderer -- see
' that component's header comment).
' ---------------------------------------------------------------------------

sub showProfiles(data as Dynamic)
    if data = invalid then data = []
    m.profiles = data
    buildProfileAvatarContent(data)
    applyProfilesChrome()
    showOnly("profiles")
    m.top.screenState = "profiles"
    focusProfilesRowOnCurrent()
    updateProfileActionsLayout()
end sub

sub focusProfilesRowOnCurrent()
    if m.profilesRow = invalid then return
    idx = profilesCurrentIndex()
    m.profilesFocusIndex = idx
    ' Jump before SetFocus so the first paint is under the current avatar.
    m.profilesRow.jumpToRowItem = [0, idx]
    m.profilesRow.SetFocus(true)
end sub

' Web TvStageChrome + profile-actions under the focused avatar.
sub applyProfilesChrome()
    theme = ResolvePairingTheme(m.themePreference)
    lang = ResolvePairingLanguage(m.languagePreference)
    isLight = theme = "light"
    if m.profilesAuthBg <> invalid
        if isLight
            m.profilesAuthBg.uri = "pkg:/images/pairing-auth-bg-light.png"
        else
            m.profilesAuthBg.uri = "pkg:/images/pairing-auth-bg.png"
        end if
    end if
    ink = &hF4F0F1FF
    inkSoft = &hC5B8BDFF
    if isLight
        ink = &h382621FF
        inkSoft = &h675961FF
    end if
    if m.profilesThemeLabel <> invalid
        m.profilesThemeLabel.color = ink
        m.profilesThemeLabel.text = PairingThemeChromeLabel(m.themePreference, lang)
    end if
    if m.profilesLangLabel <> invalid
        m.profilesLangLabel.color = ink
        m.profilesLangLabel.text = PairingLanguageChromeLabel(m.languagePreference)
    end if
    if m.profilesTitle <> invalid then m.profilesTitle.color = ink
    if m.profilesThemeIcon <> invalid
        if isLight
            m.profilesThemeIcon.uri = "pkg:/images/pairing-icon-theme-light.png"
            m.profilesLangIcon.uri = "pkg:/images/pairing-icon-lang-light.png"
            m.profilesThemeChevron.uri = "pkg:/images/pairing-icon-chevron-light.png"
            m.profilesLangChevron.uri = "pkg:/images/pairing-icon-chevron-light.png"
        else
            m.profilesThemeIcon.uri = "pkg:/images/pairing-icon-theme.png"
            m.profilesLangIcon.uri = "pkg:/images/pairing-icon-lang.png"
            m.profilesThemeChevron.uri = "pkg:/images/pairing-icon-chevron.png"
            m.profilesLangChevron.uri = "pkg:/images/pairing-icon-chevron.png"
        end if
    end if
    m.pairingChromeIsLight = isLight
    applyProfilesChromeFocus()
    updateProfileActionsLayout()
end sub

sub applyProfilesChromeFocus()
    themeF = m.profilesThemeHit <> invalid and m.profilesThemeHit.IsInFocusChain()
    langF = m.profilesLangHit <> invalid and m.profilesLangHit.IsInFocusChain()
    settingsF = m.profilesSettingsHit <> invalid and m.profilesSettingsHit.IsInFocusChain()
    signOutF = m.profilesSignOutHit <> invalid and m.profilesSignOutHit.IsInFocusChain()
    if m.profilesThemePill <> invalid then m.profilesThemePill.uri = pairingChromeUri("theme", themeF)
    if m.profilesLangPill <> invalid then m.profilesLangPill.uri = pairingChromeUri("lang", langF)
    if m.profilesSettingsBtn <> invalid
        if settingsF
            m.profilesSettingsBtn.uri = "pkg:/images/profiles-gear-focus.png"
        else
            m.profilesSettingsBtn.uri = "pkg:/images/profiles-gear.png"
        end if
    end if
    if m.profilesSignOutBtn <> invalid
        if signOutF
            m.profilesSignOutBtn.uri = "pkg:/images/profiles-signout-focus.png"
        else
            m.profilesSignOutBtn.uri = "pkg:/images/profiles-signout.png"
        end if
    end if
end sub

' Web .profile-actions: gear + Sign out under the active profile avatar.
' Always show when any real profile exists (park under current if focus is
' on the synthetic Sign in (+) avatar so the controls never disappear).
sub updateProfileActionsLayout()
    if m.profileActionsGroup = invalid then return
    if m.profiles = invalid then m.profiles = []
    if m.profiles.Count() = 0
        m.profileActionsGroup.visible = false
        return
    end if
    m.profileActionsGroup.visible = true
    if m.profilesSettingsBtn <> invalid
        m.profilesSettingsBtn.visible = true
        m.profilesSettingsBtn.opacity = 1
    end if
    if m.profilesSignOutBtn <> invalid
        m.profilesSignOutBtn.visible = true
        m.profilesSignOutBtn.opacity = 1
    end if
    if m.profilesSettingsHit <> invalid
        m.profilesSettingsHit.visible = true
        m.profilesSettingsHit.focusable = true
    end if
    if m.profilesSignOutHit <> invalid
        m.profilesSignOutHit.visible = true
        m.profilesSignOutHit.focusable = true
    end if

    targetIndex = m.profilesFocusIndex
    if targetIndex = invalid then targetIndex = 0
    if targetIndex < 0 or targetIndex >= m.profiles.Count()
        ' Focus on Sign in (+): still show under current / first profile.
        targetIndex = 0
        for i = 0 to m.profiles.Count() - 1
            p = m.profiles[i]
            if p <> invalid and p.is_current = true
                targetIndex = i
                exit for
            end if
        end for
    end if

    itemWidth = 280
    spacing = 32
    rowX = 0
    rowY = 300
    if m.profilesRow <> invalid and m.profilesRow.translation <> invalid
        rowX = m.profilesRow.translation[0]
        rowY = m.profilesRow.translation[1]
    end if
    centerX = rowX + targetIndex * (itemWidth + spacing) + Int(itemWidth / 2)
    actionsW = 232 ' 48 gear + 12 gap + 172 pill
    x = centerX - Int(actionsW / 2)
    if x < 40 then x = 40
    if x > 1920 - actionsW - 40 then x = 1920 - actionsW - 40
    ' Sit just under name/status (circle+labels ~ 328px from row top).
    y = rowY + 340
    if y > 980 then y = 980
    m.profileActionsGroup.translation = [x, y]
    m.profileActionsGroup.opacity = 1
end sub

sub onProfilesRowFocused(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    m.profilesFocusIndex = position[1]
    updateProfileActionsLayout()
end sub

function profilesCurrentIndex() as Integer
    if m.profiles = invalid or m.profiles.Count() = 0 then return 0
    for i = 0 to m.profiles.Count() - 1
        p = m.profiles[i]
        if p <> invalid and p.is_current = true then return i
    end for
    return 0
end function

sub signOutFromProfiles()
    ClearSession(true)
    m.accessToken = ""
    m.refreshToken = ""
    m.deviceId = ""
    m.profiles = []
    publishArtAuthHeaders()
    if m.profileLabel <> invalid then m.profileLabel.text = ""
    beginPairing()
end sub

' Builds profilesRow's flat-per-row ContentNode content (single row, one
' ProfileAvatar item per profile -- same nested root/rowNode/item shape
' buildRailContent uses for every other single-row RowList in this app) and
' centers the row's translation.x by hand, since a RowList has no native
' "center this row's total content width" layout mode and the total width
' varies with how many profiles the server returns.
sub buildProfileAvatarContent(profiles as Object)
    root = CreateObject("roSGNode", "ContentNode")
    rowNode = root.CreateChild("ContentNode")
    ' A real independent copy, NOT `list = profiles`: BrightScript arrays
    ' are reference types, so that alias would make this sub's own
    ' list.Push(addItem) below silently mutate the CALLER's m.profiles too
    ' (showProfiles passes the exact same array reference to both
    ' m.profiles and here) -- confirmed live as a real crash: m.profiles
    ' ended up with the synthetic "+" item appended onto the real profile
    ' list, corrupting m.profiles.Count() and, once a viewer selected that
    ' extra avatar, handing onProfileSelected a profile-shaped object with
    ' none of a real profile's fields (is_current came back Invalid, which
    ' Roku's IF-clause cannot evaluate at all: "Type Mismatch" runtime
    ' error, not a graceful false).
    list = []
    for each p in profiles
        list.Push(p)
    end for
    if list.Count() = 0
        list = [{ id: "", display_name: "Linked viewer", is_current: true, pin_locked: false }]
    end if
    for each profile in list
        name = profile.display_name
        if name = invalid or name = "" then name = "Viewer"
        ' Web statusCurrent / statusReady / statusPinRequired (uppercase small).
        suffix = "READY"
        if profile.is_current then suffix = "WATCHING NOW"
        if profile.pin_locked and not profile.is_current then suffix = "PIN REQUIRED"
        item = rowNode.CreateChild("ContentNode")
        item.title = name
        item.AddField("presetId", "string", false)
        item.presetId = profileAvatarPresetId(profile.id)
        item.AddField("initial", "string", false)
        ' Empty initial: avatar-*.png assets carry the full mascot art (no letter
        ' overlay), matching tv-web's illustrated presets rather than "R".
        item.initial = ""
        item.AddField("statusText", "string", false)
        item.statusText = suffix
    end for

    ' Real tv-web's own "+" circle (confirmed live: Profiles.tsx renders it
    ' as a genuine extra avatar-shaped button in the same row, titled "Sign
    ' in" / "ADD ANOTHER PROFILE"), not a separate text menu item -- this
    ' was "Link another profile" in profileActions below until this pass;
    ' onProfileSelected (below) detects this by index = list.Count().
    addItem = rowNode.CreateChild("ContentNode")
    addItem.title = "Sign in"
    addItem.AddField("presetId", "string", false)
    addItem.presetId = "add"
    addItem.AddField("initial", "string", false)
    addItem.initial = "+"
    addItem.AddField("statusText", "string", false)
    addItem.statusText = "ADD ANOTHER PROFILE"
    ' Keep full status line (was truncating as "ADD ANOTHER…").
    list.Push(addItem)

    ' Equal item boxes 280×360 (240 circle + ring pad + labels). Gap 32.
    ' Circles centre on a shared baseline; focus scales from circle centre.
    itemWidth = 280
    spacing = 32
    count = list.Count()
    rowWidth = count * itemWidth + (count - 1) * spacing
    x = 960 - Int(rowWidth / 2)
    if x < 40 then x = 40
    m.profilesRow.translation = [x, 300]
    m.profilesRow.rowItemSize = [[itemWidth, 360]]
    m.profilesRow.rowItemSpacing = [[spacing, 0]]
    m.profilesRow.rowHeights = [360]
    m.profilesRow.itemSize = [1800, 360]
    m.profilesRow.content = root
    ' Prefer current profile for under-avatar actions on first paint.
    m.profilesFocusIndex = 0
    for i = 0 to list.Count() - 1
        p = list[i]
        if type(p) = "roAssociativeArray" and p.is_current = true
            m.profilesFocusIndex = i
            exit for
        end if
    end for
    updateProfileActionsLayout()
end sub

' Reimplements tv-web's defaultProfileAvatarPreset() hash (profileAvatar.ts:
' `hash = (hash * 31 + charCode) >>> 0` per character, then `hash % 6`) as
' closely as BrightScript's signed-Integer arithmetic allows -- see this
' section's header comment for why this is a best-effort visual
' approximation, not a guaranteed cross-client match.
' Must match tv-web's defaultProfileAvatarPreset() (profileAvatar.ts), or the
' same profile picks a different avatar preset on Roku than on every other
' client: `hash = (hash*31 + charCode) >>> 0` on every loop iteration.
' BrightScript's Integer is 32-bit and wraps via standard two's-complement
' overflow on arithmetic, same bit pattern JS's `>>> 0` truncation produces
' each step (only the signed/unsigned *interpretation* differs, not the
' underlying bits) -- so accumulating with plain Integer math and
' normalising the sign once at the end, via `((hash mod n) + n) mod n`,
' lands on the same preset index. (The previous `mod 2147483647` + abs()
' approach here computed a genuinely different hash, not just a
' differently-signed one, and has been removed.)
function profileAvatarPresetId(id as String) as String
    presets = ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"]
    value = id
    if value = invalid or value = "" then value = "viewer"
    hash = 0
    for i = 1 to Len(value)
        code = Asc(Mid(value, i, 1))
        hash = hash * 31 + code
    end for
    n = presets.Count()
    presetIndex = ((hash mod n) + n) mod n
    return presets[presetIndex]
end function

' First non-space character of `name`, upper-cased, for ProfileAvatar's
' initial-letter overlay (see its header comment for why: Roku has no SVG
' renderer to draw tv-web's actual mascot icon set).
function profileAvatarInitial(name as String) as String
    trimmed = name.Trim()
    if trimmed = "" then return "?"
    return UCase(Left(trimmed, 1))
end function

' RowList's rowItemSelected fires [row, col]; this row is always row 0
' (numRows="1"), so only the column identifies which profile was chosen --
' mirrors onLibraryItemSelected's position[1] unpacking elsewhere in this
' file.
sub onProfileSelected(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    index = position[1]
    ' The row's last item is always the synthetic "+" / Sign in avatar (see
    ' buildProfileAvatarContent's addItem), never a real profile -- matches
    ' tv-web's own Profiles.tsx, which renders that circle as a genuine
    ' extra avatar-shaped button in the same row, not a separate text menu
    ' item (this used to be profileActions' "Link another profile").
    if index = m.profiles.Count()
        beginPairing()
        return
    end if
    if m.profiles.Count() = 0
        enterHome("Viewer")
        return
    end if
    if index < 0 or index >= m.profiles.Count() then return
    profile = m.profiles[index]
    if profile.is_current
        enterHome(profile.display_name)
    else
        ' Same bug class fixed above for onProfileActionSelected's "Link
        ' another profile" -- selecting a non-current profile avatar starts
        ' a fresh device-link for THAT profile, but the still-valid current
        ' session must not be destroyed just to begin that attempt (only
        ' once a new link actually succeeds does SaveTokens overwrite it).
        beginPairing()
    end if
end sub


' ---------------------------------------------------------------------------
' Settings (phase 7, v1 stub)
'
' Reached from profilesGroup's profileActions LabelList ("Settings", index 3
' above). Confirmed live the real Preferences page has 8 sections, in this
' order: Appearance, Profile avatar, Language, Player, Server connection,
' Profile lock, Invite a friend, Request latency. Only 3 of those 8 exist
' here (renamed to match the real labels exactly, "Server"->"Server
' connection"); the other 5 (Appearance's theme+home-artwork-mode toggle,
' Profile avatar picker, Language, Invite a friend, Request latency
' diagnostic) are deliberately not built this phase rather than added as
' dead menu items that do nothing when selected -- Language needs full i18n
' infrastructure this app doesn't have, and Request latency is
' AdminUser-gated server-side (403s for the non-admin test account, so even
' a correct implementation could only ever show an "Admins only" empty
' state) -- both real, documented gaps, not UI omissions.
'
' Mirrors profilesGroup's original two-column master/detail layout (now
' superseded there by the horizontal avatar row, see MainScene.xml's
' profilesGroup comment): settingsSectionList (left column, section names)
' drives what settingsDetail/settingsActionList (right column) show. Three
' sections exist:
'   0 Server connection -- lists m.serverAddresses (already loaded via LoadSession() at
'     init) and one "Add another server" action that reuses openServerDialog
'     (the exact same StandardKeyboardDialog/onServerDialogButton pair the
'     pairing screen's "*" shortcut and profileActions' "Change server" use).
'   1 Player -- the one cheap field on GET/PATCH
'     /api/v1/users/me/player-preferences (PlayerPreferencesResponse is just
'     `{ preferred_audio_language: string }`, confirmed against tv-web's
'     generated schema.ts and mirrors tv-web's own fixed
'     AUDIO_LANGUAGE_OPTIONS list in settings/Player.tsx); the rest of
'     tv-web's Player settings page (quality/subtitle defaults) is a
'     client-local localStorage preference with no server endpoint at all,
'     so it is out of scope for this server-preferences-only v1 pass.
'   2 Profile lock -- GET/PATCH /api/v1/users/me/profile-pin
'     (ProfilePinSettingResponse is `{ pin_locked: boolean }`,
'     UpdateProfilePinRequest is `{ pin: string | null }`, confirmed against
'     the generated schema; matches tv-web's own ProfileLock.tsx exactly:
'     "Set PIN" when unlocked, "Replace PIN"/"Remove PIN" once one exists,
'     `pin: null` removes it).
' ---------------------------------------------------------------------------

' Section list matches tv-web Preferences (Settings.tsx) order and labels.
function settingsSectionLabels() as Object
    return [
        "01  Appearance",
        "02  Profile avatar",
        "03  Language",
        "04  Player",
        "05  Server connection",
        "06  Profile lock",
        "07  Invite a friend",
        "08  Request latency"
    ]
end function

sub openSettings()
    setListContent(m.settingsSectionList, settingsSectionLabels())
    m.settingsSectionIndex = 0
    renderSettingsSection(0)
    showOnly("settings")
    m.top.screenState = "settings"
    m.settingsSectionList.SetFocus(true)
end sub

sub onSettingsSectionFocused(event as Object)
    index = event.GetData()
    if index = invalid then return
    m.settingsSectionIndex = index
    renderSettingsSection(index)
end sub

' Repaints settingsDetail/settingsActionList for the focused Preferences
' section (indices match settingsSectionLabels / tv-web Settings.tsx).
sub renderSettingsSection(index as Integer)
    m.settingsSectionIndex = index
    if index = 0
        renderAppearanceSettings()
    else if index = 1
        m.settingsDetail.text = "Profile avatar" + Chr(10) + "Avatar presets match your other Playarr apps. Upload is not available on Roku."
        setListContent(m.settingsActionList, [])
    else if index = 2
        m.settingsDetail.text = "Language" + Chr(10) + "App language follows the Roku system language."
        setListContent(m.settingsActionList, [])
    else if index = 3
        renderPlayerSettings()
        if m.preferredAudioLanguage = invalid then loadPlayerPreferences()
    else if index = 4
        renderServerSettings()
    else if index = 5
        renderProfileLockSettings()
        if m.profilePinLocked = invalid then loadProfilePinSetting()
    else if index = 6
        m.settingsDetail.text = "Invite a friend" + Chr(10) + "Invite links are managed on the web or mobile app."
        setListContent(m.settingsActionList, [])
    else if index = 7
        m.settingsDetail.text = "Request latency" + Chr(10) + "Latency diagnostics are available to admins on the web app."
        setListContent(m.settingsActionList, [])
    end if
end sub

sub renderAppearanceSettings()
    m.settingsDetail.text = "Colour theme" + Chr(10) + "Dark (Roku)" + Chr(10) + Chr(10) + "Home screen artwork" + Chr(10) + "Thumbnails"
    setListContent(m.settingsActionList, ["Theme: Dark", "Artwork: Thumbnails"])
end sub

sub renderServerSettings()
    if m.serverAddresses.Count() = 0
        m.settingsDetail.text = "No server is currently remembered."
    else
        m.settingsDetail.text = "Connected server"
        if m.serverAddresses.Count() <> 1 then m.settingsDetail.text += "s"
        m.settingsDetail.text += ":" + Chr(10) + joinStrings(m.serverAddresses, Chr(10))
    end if
    setListContent(m.settingsActionList, ["Add another server"])
end sub

' Appends " • Current" onto whichever language matches m.preferredAudioLanguage,
' the same suffix convention showProfiles already uses for "is_current".
sub renderPlayerSettings()
    if m.preferredAudioLanguage = invalid
        m.settingsDetail.text = "Preferred audio language" + Chr(10) + "Loading…"
    else
        label = audioLanguageLabel(m.preferredAudioLanguage)
        m.settingsDetail.text = "Preferred audio language" + Chr(10) + label
    end if
    labels = []
    for i = 0 to m.audioLanguageLabels.Count() - 1
        text = m.audioLanguageLabels[i]
        if m.audioLanguageCodes[i] = m.preferredAudioLanguage then text += "  •  Current"
        labels.Push(text)
    end for
    setListContent(m.settingsActionList, labels)
end sub

function audioLanguageLabel(code as String) as String
    for i = 0 to m.audioLanguageCodes.Count() - 1
        if m.audioLanguageCodes[i] = code then return m.audioLanguageLabels[i]
    end for
    return code
end function

' Matches the real ProfileLock.tsx: a boolean status ("PIN is set" / "No PIN
' is set") plus one or two actions depending on state -- "Set PIN" alone
' when unlocked, or "Replace PIN"/"Remove PIN" once one exists.
sub renderProfileLockSettings()
    if m.profilePinLocked = invalid
        m.settingsDetail.text = "Profile lock" + Chr(10) + "Loading…"
        setListContent(m.settingsActionList, [])
        return
    end if
    if m.profilePinLocked
        m.settingsDetail.text = "Profile lock" + Chr(10) + "A PIN is set for this profile."
        setListContent(m.settingsActionList, ["Replace PIN", "Remove PIN"])
    else
        m.settingsDetail.text = "Profile lock" + Chr(10) + "No PIN is set for this profile."
        setListContent(m.settingsActionList, ["Set PIN"])
    end if
end sub

sub loadProfilePinSetting()
    sendApi("profilePin", "GET", "/api/v1/users/me/profile-pin", invalid, true)
end sub

sub acceptProfilePinSetting(data as Object)
    if data = invalid or data.pin_locked = invalid then return
    m.profilePinLocked = data.pin_locked
    if m.settingsSectionIndex = 5 then renderProfileLockSettings()
    if m.top.dialog <> invalid then m.top.dialog.close = true
end sub

' Exactly four ASCII decimal digits, matching UpdateProfilePinRequest's own
' documented contract ("Exactly four ASCII decimal digits. `null` removes the
' profile lock.").
function isFourDigitPin(text as String) as Boolean
    if text = invalid or Len(text) <> 4 then return false
    for i = 1 to 4
        ch = Mid(text, i, 1)
        if ch < "0" or ch > "9" then return false
    end for
    return true
end function

sub openProfilePinDialog()
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    if m.profilePinLocked
        dialog.title = "Replace PIN"
    else
        dialog.title = "Set PIN"
    end if
    dialog.message = ["Enter a 4-digit PIN."]
    dialog.text = ""
    dialog.buttons = ["Save"]
    dialog.ObserveField("buttonSelected", "onProfilePinDialogButton")
    m.top.dialog = dialog
end sub

sub onProfilePinDialogButton(event as Object)
    if event.GetData() <> 0 then return
    pin = m.top.dialog.text
    if not isFourDigitPin(pin)
        m.top.dialog.message = ["Enter exactly 4 digits."]
        return
    end if
    sendApi("profilePinSave", "PATCH", "/api/v1/users/me/profile-pin", { pin: pin }, true)
end sub

sub removeProfilePin()
    sendApi("profilePinSave", "PATCH", "/api/v1/users/me/profile-pin", { pin: invalid }, true)
end sub

sub onSettingsActionSelected(event as Object)
    index = event.GetData()
    if index = invalid or index < 0 then return
    ' Indices match settingsSectionLabels / tv-web Preferences order.
    if m.settingsSectionIndex = 3
        if index >= 0 and index < m.audioLanguageCodes.Count()
            saveAudioLanguage(m.audioLanguageCodes[index])
        end if
    else if m.settingsSectionIndex = 4
        if index = 0 then openServerDialog()
    else if m.settingsSectionIndex = 5
        if m.profilePinLocked
            if index = 0 then openProfilePinDialog()
            if index = 1 then removeProfilePin()
        else
            if index = 0 then openProfilePinDialog()
        end if
    end if
end sub

sub loadPlayerPreferences()
    sendApi("playerPrefs", "GET", "/api/v1/users/me/player-preferences", invalid, true)
end sub

sub saveAudioLanguage(code as String)
    sendApi("playerPrefsSave", "PATCH", "/api/v1/users/me/player-preferences", {
        preferred_audio_language: code
    }, true)
end sub

sub acceptPlayerPreferences(data as Object)
    if data = invalid or data.preferred_audio_language = invalid then return
    m.preferredAudioLanguage = data.preferred_audio_language
    if m.settingsSectionIndex = 3 then renderPlayerSettings()
end sub

sub enterLibrary(profileName as String)
    SaveProfileName(profileName)
    m.profileLabel.text = profileName
    m.items = []
    m.totalItems = invalid
    ' Stay in the library shell while the catalogue loads (no fullscreen status).
    m.libraryTitle.text = "Library  •  …"
    buildRailContent(m.library, m.items, true)
    showOnly("library")
    m.top.screenState = "library"
    m.library.SetFocus(true)
    loadCatalog(false)
end sub

sub loadCatalog(append as Boolean)
    offset = 0
    action = "catalog"
    if append
        offset = m.items.Count()
        action = "catalogMore"
    end if
    config = AppConfig()
    path = "/api/v1/catalog?available_only=true&sort=title&limit=" + config.catalogPageSize.ToStr() + "&offset=" + offset.ToStr()
    sendApi(action, "GET", path, invalid, true)
end sub

sub acceptCatalog(data as Object, append as Boolean)
    if data = invalid or data.items = invalid
        ' Stay in library shell — never replace signed-in chrome with a
        ' fullscreen status wall (that is not how Playarr looks).
        m.libraryTitle.text = "Library  •  unavailable"
        showOnly("library")
        m.top.screenState = "library"
        m.library.SetFocus(true)
        return
    end if
    if append
        for each item in data.items
            m.items.Push(item)
        end for
    else
        m.items = data.items
    end if
    m.totalItems = data.total
    rebuildLibraryContent()
    showOnly("library")
    m.top.screenState = "library"
    m.library.SetFocus(true)
end sub

sub rebuildLibraryContent()
    buildRailContent(m.library, m.items, true)
    if m.totalItems <> invalid
        m.libraryTitle.text = "Library  •  " + m.items.Count().ToStr() + " of " + m.totalItems.ToStr()
    else
        m.libraryTitle.text = "Library  •  " + m.items.Count().ToStr()
    end if
end sub

' ---------------------------------------------------------------------------
' Library grid (phase 3)
'
' Kind-filtered (movie/series/site/artist) grid browser reached from the
' homeShortcuts row (see enterHomeShortcuts/selectHomeShortcut below). Mirrors
' loadCatalog/acceptCatalog/rebuildLibraryContent's shape but against a flat
' MarkupGrid (m.browseGrid) instead of the legacy single-row RowList, and adds
' a `kind` query param. See MainScene.xml's browseGroup comment for why this
' is a MarkupGrid rather than a repurposed libraryList RowList.
' ---------------------------------------------------------------------------

sub openBrowse(kind as String, label as String)
    m.browseKind = kind
    m.browseLabel = label
    m.browseItems = []
    m.browseTotal = invalid
    m.browseSort = "title"
    m.browseOrder = "asc"
    m.browseArtworkSize = "medium"
    applyBrowseArtworkSize()
    m.browseAlphabetMode = false
    m.browseFiltersButtonFocused = false
    m.browseFiltersMode = false
    m.browseFiltersPanel.visible = false
    m.browseFiltersButton.color = &hA9B7C9FF
    renderBrowseAlphabetFocus()
    ' Stay inside the browse shell while fetching (no fullscreen Loading UI).
    m.browseTitle.text = label
    if m.browseCountLabel <> invalid then m.browseCountLabel.text = "…"
    m.browseItems = []
    buildGridContent(m.browseGrid, m.browseItems, browseCardScale())
    showOnly("browse")
    m.top.screenState = "browse"
    m.browseGrid.SetFocus(true)
    loadBrowseCatalog(false)
end sub

sub loadBrowseCatalog(append as Boolean)
    offset = 0
    action = "browseCatalog"
    if append
        offset = m.browseItems.Count()
        action = "browseCatalogMore"
    end if
    config = AppConfig()
    path = "/api/v1/catalog?kind=" + m.browseKind + "&available_only=true&sort=" + m.browseSort + "&order=" + m.browseOrder + "&limit=" + config.catalogPageSize.ToStr() + "&offset=" + offset.ToStr()
    sendApi(action, "GET", path, invalid, true)
end sub

sub acceptBrowseCatalog(data as Object, append as Boolean)
    if data = invalid or data.items = invalid
        ' Stay in browse shell (no fullscreen Loading / status wall).
        if m.browseCountLabel <> invalid then m.browseCountLabel.text = "UNAVAILABLE"
        showOnly("browse")
        m.top.screenState = "browse"
        m.browseGrid.SetFocus(true)
        return
    end if
    if append
        for each item in data.items
            m.browseItems.Push(item)
        end for
    else
        m.browseItems = data.items
    end if
    m.browseTotal = data.total
    rebuildBrowseContent()
    showOnly("browse")
    m.top.screenState = "browse"
    m.browseGrid.SetFocus(true)
    if not append then updateBrowsePreview(m.browseItems[0])
end sub

sub rebuildBrowseContent()
    ' Web Library.tsx orderWorks: title sort uses numeric localeCompare on
    ' sort_title/title. Server sort is stringy ("10" before "2"); re-order
    ' client-side so the first page matches web freezes.
    if m.browseSort = "title"
        m.browseItems = sortWorksByTitleNumeric(m.browseItems, m.browseOrder)
    end if
    buildGridContent(m.browseGrid, m.browseItems, browseCardScale())
    ' Web heading: h1 = "Movies", span = "1,730 TITLES" (not "50 of 1730").
    m.browseTitle.text = m.browseLabel
    if m.browseCountLabel <> invalid
        total = m.browseItems.Count()
        if m.browseTotal <> invalid then total = Int(m.browseTotal)
        noun = "TITLES"
        if m.browseKind = "artist" then noun = "ARTISTS"
        m.browseCountLabel.text = formatCountWithCommas(total) + " " + noun
    end if
    ' A pending letter jump (see jumpToBrowseLetter) means the target
    ' wasn't loaded yet when it was requested -- now that another page has
    ' landed, check again.
    if m.browseAlphabetPendingLetter <> invalid
        jumpToBrowseLetter(m.browseAlphabetPendingLetter)
    end if
end sub

function formatCountWithCommas(n as Dynamic) as String
    if n = invalid then return "0"
    s = Int(n).ToStr()
    if Len(s) <= 3 then return s
    out = ""
    while Len(s) > 3
        out = "," + Right(s, 3) + out
        s = Left(s, Len(s) - 3)
    end while
    return s + out
end function

' Approximate web localeCompare({numeric:true}) for title sort.
function sortWorksByTitleNumeric(items as Object, order as String) as Object
    result = []
    if items = invalid then return result
    for each work in items
        result.Push(work)
    end for
    direction = 1
    if order = "desc" then direction = -1
    for i = 0 to result.Count() - 2
        bestIndex = i
        for j = i + 1 to result.Count() - 1
            a = sortTitleKey(result[j])
            b = sortTitleKey(result[bestIndex])
            cmp = 0
            if a < b then cmp = -1
            if a > b then cmp = 1
            if cmp * direction < 0 then bestIndex = j
        end for
        if bestIndex <> i
            temp = result[i]
            result[i] = result[bestIndex]
            result[bestIndex] = temp
        end if
    end for
    return result
end function

function sortTitleKey(work as Object) as String
    if work = invalid then return ""
    t = ""
    if work.sort_title <> invalid and work.sort_title <> "" then t = LCase(work.sort_title)
    if t = "" and work.title <> invalid then t = LCase(work.title)
    ' Pad digit runs so "2 kites" sorts before "10 brambleford" (web numeric).
    key = ""
    i = 1
    while i <= Len(t)
        ch = Mid(t, i, 1)
        if ch >= "0" and ch <= "9"
            num = ""
            while i <= Len(t)
                ch2 = Mid(t, i, 1)
                if ch2 < "0" or ch2 > "9" then exit while
                num = num + ch2
                i = i + 1
            end while
            while Len(num) < 10
                num = "0" + num
            end while
            key = key + num
        else
            key = key + ch
            i = i + 1
        end if
    end while
    return key
end function

' ---------------------------------------------------------------------------
' Library/Movies/Series/Sites alphabet jump strip (from: .tv-alphabet,
' confirmed live: "#" then A-Z on the real page's right edge). Built once
' (the same 27 entries every time) rather than per-screen-entry.
' ---------------------------------------------------------------------------

function alphabetLetterList() as Object
    letters = ["#"]
    for i = 0 to 25
        letters.Push(Chr(65 + i))
    end for
    return letters
end function

sub buildAlphabetStrip()
    letters = alphabetLetterList()
    m.alphabetLabels = []
    y = 0
    for each letter in letters
        label = CreateObject("roSGNode", "Label")
        label.translation = [0, y]
        label.width = 40
        label.height = 24
        label.text = letter
        label.horizAlign = "center"
        label.scale = [0.42, 0.42]
        label.scaleRotateCenter = [20, 12]
        label.color = &hA9B7C9FF
        m.browseAlphabet.AppendChild(label)
        m.alphabetLabels.Push(label)
        y += 26
    end for
end sub

sub enterBrowseAlphabet()
    m.browseGrid.SetFocus(false)
    m.browseAlphabetMode = true
    m.browseAlphabetIndex = 0
    renderBrowseAlphabetFocus()
    m.top.SetFocus(true)
end sub

sub exitBrowseAlphabet()
    m.browseAlphabetMode = false
    renderBrowseAlphabetFocus()
    m.browseGrid.SetFocus(true)
end sub

function moveBrowseAlphabetFocus(delta as Integer) as Boolean
    newIndex = m.browseAlphabetIndex + delta
    if newIndex < 0 or newIndex >= m.alphabetLabels.Count() then return true
    m.browseAlphabetIndex = newIndex
    renderBrowseAlphabetFocus()
    return true
end function

sub renderBrowseAlphabetFocus()
    for i = 0 to m.alphabetLabels.Count() - 1
        if m.browseAlphabetMode and i = m.browseAlphabetIndex
            m.alphabetLabels[i].color = &hCF3157FF
        else
            m.alphabetLabels[i].color = &hA9B7C9FF
        end if
    end for
end sub

sub selectBrowseAlphabetLetter()
    letters = alphabetLetterList()
    letter = letters[m.browseAlphabetIndex]
    exitBrowseAlphabet()
    jumpToBrowseLetter(letter)
end sub

' "#" jumps to the first item whose sort_title doesn't start with a letter
' at all (a leading digit/symbol, matching the real strip's own "#" entry);
' any other letter jumps to the first item whose sort_title starts with it
' (case-insensitive; sort_title is already the server's own
' article-stripped, lowercased sort key -- confirmed live it drives this
' same grid's own alphabetical order, since loadBrowseCatalog always fetches
' sort=title). If no loaded item matches yet, keeps paginating
' (loadBrowseCatalog(true), the same near-the-end fetch onBrowseItemFocused
' already uses) until one does or the catalogue is exhausted.
sub jumpToBrowseLetter(letter as String)
    for i = 0 to m.browseItems.Count() - 1
        first = ""
        if m.browseItems[i].sort_title <> invalid and m.browseItems[i].sort_title.Len() > 0
            first = UCase(m.browseItems[i].sort_title.Left(1))
        end if
        matches = false
        if letter = "#"
            if first = "" or first < "A" or first > "Z" then matches = true
        else if first = letter
            matches = true
        end if
        if matches
            m.browseAlphabetPendingLetter = invalid
            m.browseGrid.jumpToItem = i
            return
        end if
    end for
    moreAvailable = m.browseTotal = invalid or m.browseItems.Count() < m.browseTotal
    if moreAvailable and not m.requestBusy
        m.browseAlphabetPendingLetter = letter
        loadBrowseCatalog(true)
    else
        m.browseAlphabetPendingLetter = invalid
    end if
end sub

' ---------------------------------------------------------------------------
' Filters button + panel (from: .tv-filter-launcher / the real Filters
' drawer). Sort By (Title/Date Added) and Order (A-Z/Z-A) trigger a real
' refetch (loadBrowseCatalog); Artwork Size (Small/Medium/Large) is a pure
' client-side reflow of browseGrid's numColumns/itemSize/itemSpacing
' (applyBrowseArtworkSize) against the already-loaded items, matching
' tv-web's own tv-artwork-small/medium/large classes exactly. View
' (List/Screen/Cover) is not wired -- each is a genuinely distinct
' SceneGraph layout (row-list vs grid vs large single-column carousel), not
' a parameter of this one MarkupGrid, so it stays a real, documented gap.
' ---------------------------------------------------------------------------

sub focusBrowseFiltersButton()
    m.browseAlphabetMode = false
    renderBrowseAlphabetFocus()
    m.browseFiltersButtonFocused = true
    m.browseFiltersButton.color = &hCF3157FF
end sub

sub focusBrowseAlphabetFromButton()
    m.browseFiltersButtonFocused = false
    m.browseFiltersButton.color = &hA9B7C9FF
    m.browseAlphabetMode = true
    m.browseAlphabetIndex = 0
    renderBrowseAlphabetFocus()
end sub

sub openBrowseFiltersPanel()
    m.browseFiltersMode = true
    m.browseFiltersIndex = 0
    if m.browseSort = "title" then m.browseFiltersIndex = 0
    if m.browseSort = "date_added" then m.browseFiltersIndex = 1
    m.browseFiltersPanel.visible = true
    renderBrowseFiltersOptionsFocus()
end sub

' Kept out of the shared browseFilterOptions/isSelected loop below since
' small/medium/large are radio-style and each has its own item index
' (4/5/6), same convention as the sort/order pairs above it.
function browseArtworkSizeOptionIndex() as Integer
    if m.browseArtworkSize = "small" then return 4
    if m.browseArtworkSize = "large" then return 6
    return 5
end function

sub closeBrowseFiltersPanel()
    m.browseFiltersMode = false
    m.browseFiltersPanel.visible = false
end sub

function moveBrowseFiltersFocus(delta as Integer) as Boolean
    newIndex = m.browseFiltersIndex + delta
    if newIndex < 0 or newIndex >= m.browseFilterOptions.Count() then return true
    m.browseFiltersIndex = newIndex
    renderBrowseFiltersOptionsFocus()
    return true
end function

' Selected values (not just focus) always stay highlighted (real tv-web's
' own pressed-state pill), the currently-focused option additionally shows
' the accent colour even if not yet the active value, mirroring the same
' "selected vs focused can differ" pattern renderSettingsSection already
' uses.
sub renderBrowseFiltersOptionsFocus()
    selectedSizeIndex = browseArtworkSizeOptionIndex()
    for i = 0 to m.browseFilterOptions.Count() - 1
        isSelected = (i = 0 and m.browseSort = "title") or (i = 1 and m.browseSort = "date_added") or (i = 2 and m.browseOrder = "asc") or (i = 3 and m.browseOrder = "desc") or (i = selectedSizeIndex)
        if i = m.browseFiltersIndex or isSelected
            m.browseFilterOptions[i].color = &hCF3157FF
        else
            m.browseFilterOptions[i].color = &hA9B7C9FF
        end if
    end for
end sub

sub selectBrowseFilterOption()
    if m.browseFiltersIndex = 0
        m.browseSort = "title"
    else if m.browseFiltersIndex = 1
        m.browseSort = "date_added"
    else if m.browseFiltersIndex = 2
        m.browseOrder = "asc"
    else if m.browseFiltersIndex = 3
        m.browseOrder = "desc"
    else if m.browseFiltersIndex = 4
        m.browseArtworkSize = "small"
    else if m.browseFiltersIndex = 5
        m.browseArtworkSize = "medium"
    else if m.browseFiltersIndex = 6
        m.browseArtworkSize = "large"
    end if
    renderBrowseFiltersOptionsFocus()
    if m.browseFiltersIndex >= 4
        ' Artwork size is a pure client-side reflow of the same already-loaded
        ' items -- no refetch, unlike Sort/Order which change what the server
        ' returns.
        applyBrowseArtworkSize()
        rebuildBrowseContent()
        return
    end if
    m.browseItems = []
    m.browseTotal = invalid
    loadBrowseCatalog(false)
end sub

' Reflows browseGrid's column count/item box/spacing in place to match
' tv-web's tv-artwork-small/medium/large classes (Library.tsx's own
' ArtworkSize toggle) -- keeps the same left edge (x=560) and roughly the
' same total grid footprint the medium/default layout already used, just
' with more/fewer, smaller/larger columns.
sub applyBrowseArtworkSize()
    if m.browseArtworkSize = "small"
        m.browseGrid.numColumns = 4
        m.browseGrid.numRows = 3
        m.browseGrid.itemSize = [240, 157]
        m.browseGrid.itemSpacing = [24, 24]
    else if m.browseArtworkSize = "large"
        m.browseGrid.numColumns = 2
        m.browseGrid.numRows = 2
        m.browseGrid.itemSize = [480, 314]
        m.browseGrid.itemSpacing = [30, 30]
    else
        m.browseGrid.numColumns = 3
        m.browseGrid.numRows = 3
        m.browseGrid.itemSize = [330, 216]
        m.browseGrid.itemSpacing = [27, 27]
    end if
end sub

' PosterCard is authored at a fixed 220x165 (see buildGridContent's own
' comment) and scaled uniformly via cardScale -- keep that scale in lockstep
' with whatever box applyBrowseArtworkSize just picked (box width / 220), so
' small/large re-renders stay proportioned exactly like medium already was.
function browseCardScale() as Float
    if m.browseArtworkSize = "small" then return 240.0 / 220.0
    if m.browseArtworkSize = "large" then return 480.0 / 220.0
    return 1.5
end function

' Mirrors web Library.tsx aside.tv-library-preview + TvStageShell key art.
sub updateBrowsePreview(work as Object)
    if work = invalid then return
    ' Provider line is first genre (or kind singular), not the page plural.
    kicker = UCase(m.browseLabel)
    if m.browseLabel = "Movies" then kicker = "MOVIE"
    if m.browseLabel = "Series" then kicker = "SERIES"
    if m.browseLabel = "Music" then kicker = "ARTIST"
    if m.browseLabel = "Sites" then kicker = "SITE"
    if work.genres <> invalid and work.genres.Count() > 0
        kicker = UCase(work.genres[0])
    end if
    m.browsePreviewKind.text = kicker
    m.browsePreviewTitle.text = work.title
    meta = ""
    ' Web uses added_at year, not release_date.
    if work.added_at <> invalid and work.added_at.Len() >= 4
        meta = work.added_at.Left(4)
    else if work.release_date <> invalid and work.release_date.Len() >= 4
        meta = work.release_date.Left(4)
    end if
    if work.genres <> invalid and work.genres.Count() > 0
        genreLine = joinStrings(work.genres, " · ")
        if work.genres.Count() > 2
            genreLine = work.genres[0] + " · " + work.genres[1]
        end if
        if meta <> "" then meta += "  "
        meta += genreLine
    end if
    m.browsePreviewMeta.text = meta
    overview = work.overview
    if overview = invalid or overview = "" then overview = "No synopsis available."
    m.browsePreviewOverview.text = overview
    ' Defer key-art download so acceptBrowseCatalog paints the grid first.
    ' Home hero uses sync GetToFile successfully; here it must not block paint.
    if m.browseKeyArt <> invalid
        uri = heroArtworkUrl(work)
        m.browseKeyArtPendingUri = uri
        if uri = ""
            m.browseKeyArt.uri = ""
            m.browseKeyArt.visible = false
        else if m.browseKeyArtTimer <> invalid
            m.browseKeyArtTimer.control = "stop"
            m.browseKeyArtTimer.control = "start"
        else
            onBrowseKeyArtTimer()
        end if
    end if
end sub

sub onBrowseKeyArtTimer()
    uri = m.browseKeyArtPendingUri
    if m.browseKeyArt = invalid then return
    if uri = invalid or uri = ""
        m.browseKeyArt.uri = ""
        m.browseKeyArt.visible = false
        return
    end if
    xfer = CreateObject("roUrlTransfer")
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
    xfer.SetUrl(uri)
    xfer.SetHeaders(ClientHeaders(m.accessToken))
    tmpPath = "tmp:/playarr-browse-keyart.jpg"
    if xfer.GetToFile(tmpPath)
        m.browseKeyArt.uri = tmpPath
        m.browseKeyArt.visible = true
    end if
end sub

' Flat-content counterpart to buildRailContent() below: MarkupGrid takes one
' flat list of item ContentNodes (it auto-wraps them into numColumns-wide
' rows itself), unlike RowList's nested per-row ContentNode structure.
sub buildGridContent(grid as Object, works as Object, cardScale = 1.5 as Float)
    root = CreateObject("roSGNode", "ContentNode")
    headers = ClientHeaders(m.accessToken)
    for each work in works
        item = root.CreateChild("ContentNode")
        item.id = work.id
        item.title = work.title
        item.AddField("kind", "string", false)
        item.kind = work.kind
        item.AddField("year", "string", false)
        if work.release_date <> invalid and work.release_date.Len() >= 4 then item.year = work.release_date.Left(4)
        item.description = JsonString(work.overview)
        item.hdPosterUrl = artworkUrl(work)
        item.AddField("artHeaders", "assocarray", false)
        item.artHeaders = artworkHeaders(item.hdPosterUrl, headers)
        ' Grid screens (Library/Search/Playlists) render the real, larger
        ' .tv-title-card (330x216 at medium, confirmed live via
        ' getComputedStyle), not Home's smaller .tv-home-card (220x165)
        ' PosterCard is authored at -- see PosterCard.xml's cardScale
        ' comment. 330/220 = 1.5, the default when a caller (e.g. Search,
        ' Playlists) doesn't pass its own scale. browseGrid instead derives
        ' this from m.browseArtworkSize via applyBrowseArtworkSize/
        ' rebuildBrowseContent, since its item box size changes with it.
        ' Real .tv-title-card also never shows a kind line under the title.
        item.AddField("cardScale", "float", false)
        item.cardScale = cardScale
        item.AddField("showKind", "boolean", false)
        item.showKind = false
    end for
    grid.content = root
end sub

' MarkupGrid's itemFocused/itemSelected fields are plain integers (an index
' into the flat content list), unlike RowList's rowItemFocused/rowItemSelected
' [row,col] arrays -- no position[1] unpacking needed here.
sub onBrowseItemFocused(event as Object)
    itemIndex = event.GetData()
    if itemIndex = invalid then return
    if itemIndex >= 0 and itemIndex < m.browseItems.Count()
        updateBrowsePreview(m.browseItems[itemIndex])
    end if
    moreAvailable = m.browseTotal = invalid or m.browseItems.Count() < m.browseTotal
    if moreAvailable and itemIndex >= m.browseItems.Count() - 10 and not m.requestBusy
        loadBrowseCatalog(true)
    end if
end sub

sub onBrowseItemSelected(event as Object)
    index = event.GetData()
    if index = invalid or index < 0 or index >= m.browseItems.Count() then return
    openWorkDetail(m.browseItems[index], "browse")
end sub

' ---------------------------------------------------------------------------
' Search (phase 6)
'
' Reached from homeShortcuts' 5th entry (shortcutSearch, see
' selectHomeShortcut). Text entry mirrors openServerDialog's exact
' StandardKeyboardDialog construction pattern below. Unlike browseGroup's
' catalog listing endpoint, GET /api/v1/catalog/search takes only `q` and
' `limit` -- no `offset`, no `available_only`, no `total` in its response
' (SearchResponse is `{ items, remote_only }`, confirmed against tv-web's
' generated schema.ts) -- so this is a single one-shot fetch per submitted
' query into m.searchGrid, not a paginated/near-the-end-triggered load like
' loadBrowseCatalog/loadCatalog. `remote_only` (partial-cache-node
' RemoteOnlyWork results) is out of scope for this phase, same as every
' other partial-cache-node concern elsewhere in this client.
' ---------------------------------------------------------------------------

' Web /search empty shell first (Start typing to search). OK opens keyboard.
sub openSearch()
    m.searchQuery = ""
    m.searchItems = []
    m.searchDisplayItems = []
    m.searchTitle.text = "Search"
    if m.searchFieldLabel <> invalid
        m.searchFieldLabel.text = "Search your libraries and playlists"
        m.searchFieldLabel.color = &h887A82FF
    end if
    showSearchEmptyState(true)
    buildGridContent(m.searchGrid, m.searchDisplayItems, 1.5)
    showOnly("search")
    m.top.screenState = "search"
    m.top.SetFocus(true)
end sub

sub showSearchEmptyState(empty as Boolean)
    if m.searchEmptyState <> invalid then m.searchEmptyState.visible = empty
    if m.searchEmptyHint <> invalid then m.searchEmptyHint.visible = empty
    if m.searchGrid <> invalid then m.searchGrid.visible = not empty
    if m.searchPreviewKind <> invalid then m.searchPreviewKind.visible = not empty
    if m.searchPreviewTitle <> invalid then m.searchPreviewTitle.visible = not empty
    if m.searchPreviewMeta <> invalid then m.searchPreviewMeta.visible = not empty
    if m.searchPreviewOverview <> invalid then m.searchPreviewOverview.visible = not empty
    ' Empty shell: Filters summary label; after results, type-filter Labels.
    chip = m.top.findNode("searchFiltersChip")
    if chip <> invalid then chip.visible = empty
    if m.searchFilterLabels <> invalid
        for each lab in m.searchFilterLabels
            if lab <> invalid then lab.visible = not empty
        end for
    end if
    filters = m.top.findNode("searchFilters")
    if filters <> invalid then filters.visible = not empty
    if m.searchHint <> invalid then m.searchHint.visible = false
end sub

sub openSearchDialog()
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = "Search Playarr"
    dialog.message = ["Find any available movie, series, artist or playlist."]
    dialog.text = m.searchQuery
    dialog.buttons = ["Search"]
    dialog.ObserveField("buttonSelected", "onSearchDialogButton")
    m.top.dialog = dialog
end sub

sub onSearchDialogButton(event as Object)
    if event.GetData() <> 0 then return
    query = m.top.dialog.text
    if query = ""
        m.top.dialog.message = ["Enter one or more search words."]
        return
    end if
    m.searchQuery = query
    m.top.dialog.close = true
    performSearch(query)
end sub

sub performSearch(query as String)
    m.searchItems = []
    m.searchDisplayItems = []
    m.searchTitle.text = "Search"
    if m.searchFieldLabel <> invalid
        m.searchFieldLabel.text = query
        m.searchFieldLabel.color = &hF4F0F1FF
    end if
    showSearchEmptyState(false)
    buildGridContent(m.searchGrid, m.searchDisplayItems, 1.5)
    showOnly("search")
    m.top.screenState = "search"
    m.searchGrid.SetFocus(true)
    config = AppConfig()
    path = "/api/v1/catalog/search?q=" + UrlEncode(query) + "&limit=" + config.catalogPageSize.ToStr()
    sendApi("search", "GET", path, invalid, true)
end sub

sub acceptSearchResults(data as Object)
    if data = invalid or data.items = invalid
        ' Stay in Search shell (no fullscreen status wall).
        m.searchTitle.text = "Search"
        showSearchEmptyState(true)
        showOnly("search")
        m.top.screenState = "search"
        m.searchGrid.SetFocus(true)
        return
    end if
    m.searchItems = data.items
    m.searchFilterKind = ""
    m.searchFilterIndex = 0
    m.searchFilterMode = false
    showOnly("search")
    m.top.screenState = "search"
    applySearchFilter()
    m.searchGrid.SetFocus(true)
end sub

' MarkupGrid's itemSelected is a plain integer index, same shape as
' onBrowseItemSelected above.
sub onSearchItemSelected(event as Object)
    index = event.GetData()
    if index = invalid or index < 0 or index >= m.searchDisplayItems.Count() then return
    openWorkDetail(m.searchDisplayItems[index], "search")
end sub

' Mirrors updateBrowsePreview: tv-web's real Search page
' (Search.tsx's aside.tv-search-preview) shows the currently-focused
' result's kind, title, year, and synopsis, updated live as focus moves.
sub onSearchItemFocused(event as Object)
    index = event.GetData()
    if index = invalid or index < 0 or index >= m.searchDisplayItems.Count() then return
    updateSearchPreview(m.searchDisplayItems[index])
end sub

' ---------------------------------------------------------------------------
' Search type filter row (see MainScene.xml's searchFilters comment)
' ---------------------------------------------------------------------------

' Matches the real Search page's own filter chips exactly (confirmed live:
' All/Movies/Series/Music/Playlists -- there is no "Sites" filter type there
' at all, and Playlists genuinely is one, contrary to this codebase's
' earlier, unverified assumption that no playlist-name-match search pass
' existed here).
function searchFilterKindList() as Object
    return ["", "movie", "series", "artist", "playlist"]
end function

' Re-filters the already-fetched m.searchItems client-side (the search
' endpoint itself takes no type param, confirmed against tv-web's generated
' schema.ts -- tv-web's own SEARCH_TYPES filter works the exact same way, in
' the browser after the one fetch) and rebuilds the grid from the result.
' "playlist" is a special case: it has no catalog `kind` at all (playlists
' aren't catalog works), so it matches m.playlists by name instead -- the
' real app's own /api/v1/playlists fetch has no search-by-name endpoint
' either (confirmed live via the network panel: only /api/v1/catalog/search
' fires when typing), so tv-web itself must do this exact same client-side
' name match. Only matches if the viewer has already visited Playlists at
' least once this session (m.playlists gets populated there); there is no
' proactive fetch here yet, a real but narrow gap versus a background fetch
' every time Search opens regardless of whether it's ever used.
sub applySearchFilter()
    kind = searchFilterKindList()[m.searchFilterIndex]
    m.searchFilterKind = kind
    if kind = ""
        m.searchDisplayItems = m.searchItems
    else if kind = "playlist"
        filtered = []
        query = LCase(m.searchQuery)
        for each playlist in m.playlists
            name = playlist.name
            if name <> invalid and Instr(1, LCase(name), query) > 0
                filtered.Push({ id: playlist.id, title: name, kind: "playlist", overview: "", images: invalid })
            end if
        end for
        m.searchDisplayItems = filtered
    else
        filtered = []
        for each work in m.searchItems
            if work.kind = kind then filtered.Push(work)
        end for
        m.searchDisplayItems = filtered
    end if
    buildGridContent(m.searchGrid, m.searchDisplayItems)
    if m.searchDisplayItems.Count() = 0
        m.searchTitle.text = "Search  •  “" + m.searchQuery + "”  •  no results"
    else
        m.searchTitle.text = "Search  •  “" + m.searchQuery + "”  •  " + m.searchDisplayItems.Count().ToStr()
        updateSearchPreview(m.searchDisplayItems[0])
    end if
end sub

sub enterSearchFilters()
    m.searchGrid.SetFocus(false)
    m.searchFilterMode = true
    renderSearchFilterFocus()
    m.top.SetFocus(true)
end sub

sub exitSearchFilters()
    m.searchFilterMode = false
    renderSearchFilterFocus()
    m.searchGrid.SetFocus(true)
end sub

function moveSearchFilterFocus(delta as Integer) as Boolean
    newIndex = m.searchFilterIndex + delta
    if newIndex < 0 or newIndex >= m.searchFilterLabels.Count() then return true
    m.searchFilterIndex = newIndex
    renderSearchFilterFocus()
    return true
end function

sub renderSearchFilterFocus()
    for i = 0 to m.searchFilterLabels.Count() - 1
        label = m.searchFilterLabels[i]
        if i = m.searchFilterIndex
            label.color = &hCF3157FF
        else
            label.color = &hA9B7C9FF
        end if
    end for
end sub

sub selectSearchFilter()
    applySearchFilter()
    exitSearchFilters()
end sub

sub updateSearchPreview(work as Object)
    if work = invalid then return
    m.searchPreviewKind.text = UCase(work.kind)
    m.searchPreviewTitle.text = work.title
    meta = ""
    if work.release_date <> invalid and work.release_date.Len() >= 4
        meta = work.release_date.Left(4)
    end if
    if work.genres <> invalid and work.genres.Count() > 0
        if meta <> "" then meta += "  •  "
        meta += joinStrings(work.genres, ", ")
    end if
    m.searchPreviewMeta.text = meta
    overview = work.overview
    if overview = invalid or overview = "" then overview = "No synopsis available."
    m.searchPreviewOverview.text = overview
end sub

' ---------------------------------------------------------------------------
' Playlists (phase 10)
'
' Reached from homeShortcuts' 6th entry (shortcutPlaylists, see
' selectHomeShortcut). One screenState ("playlists") covers two sub-views --
' a flat directory grid of every playlist visible to the caller, and (once
' one is opened) that playlist's items -- toggled via m.playlistDetailOpen
' exactly like Home's m.homeShortcutMode overlay, rather than being split
' into two separate screenStates. See MainScene.xml's playlistsGroup comment
' for the full layout rationale.
'
' PlaylistResponse (GET /api/v1/playlists) carries no cover-art field at all
' (confirmed against tv-web's generated schema.ts -- unlike Work, which has
' an `images` array), so the directory grid's PosterCards render with an
' empty poster (their existing "no image" look) and just the playlist name;
' a documented fallback, not a missing feature. PlaylistItemResponse (GET
' /api/v1/playlists/{id}/items) is also thin -- just `work_id` (+ optional
' `track_id` for an audio playlist's individual track) in position order,
' no embedded Work -- so each item's full Work is hydrated one at a time via
' the same GET /api/v1/catalog/{id} detail endpoint openWorkDetail() uses,
' chained exactly like Continue Watching's processNextHomeWork() above
' (there is no batch-by-ids catalog endpoint to fan these out in parallel).
'
' Explicitly out of scope this phase (see the top-level task brief): the
' create-playlist drawer, filter/sort drawer, long-press context menu
' (add/remove items, rename/delete), nested child playlists
' (parent_playlist_id is read off each PlaylistResponse but never acted on
' -- every playlist is listed flat in the directory grid), and
' Personal/Shared visibility filtering (both are always shown together,
' distinguished only in the detail meta line).
' ---------------------------------------------------------------------------

sub openPlaylists()
    ' Show the playlists shell immediately; directory fills when the API returns.
    m.playlistsTitle.text = "Playlists"
    m.playlistDetailOpen = false
    m.playlistDetailGroup.visible = false
    m.playlistsDirectoryGroup.visible = true
    showPlaylistsEmptyShell(true)
    showOnly("playlists")
    m.top.screenState = "playlists"
    m.top.SetFocus(true)
    sendApi("playlists", "GET", "/api/v1/playlists", invalid, true)
end sub

sub acceptPlaylists(data as Object)
    if data = invalid
        ' Stay in playlists shell (no fullscreen status wall).
        m.playlists = []
        buildPlaylistDirectoryContent()
        m.playlistsTitle.text = "Playlists  •  unavailable"
        m.playlistDetailOpen = false
        m.playlistDetailGroup.visible = false
        m.playlistsDirectoryGroup.visible = true
        showPlaylistsEmptyShell(true)
        showOnly("playlists")
        m.top.screenState = "playlists"
        m.top.SetFocus(true)
        return
    end if
    m.playlists = data
    buildPlaylistDirectoryContent()
    m.playlistDetailOpen = false
    m.playlistDetailGroup.visible = false
    m.playlistsDirectoryGroup.visible = true
    showPlaylistsEmptyShell(m.playlists.Count() = 0)
    showOnly("playlists")
    m.top.screenState = "playlists"
    if m.playlists.Count() > 0
        m.playlistsGrid.SetFocus(true)
    else
        m.top.SetFocus(true)
    end if
end sub

' Empty shell: native labels. Populated directory shows the grid.
sub showPlaylistsEmptyShell(empty as Boolean)
    emptyState = m.top.findNode("playlistsEmptyState")
    if emptyState <> invalid then emptyState.visible = empty
    kicker = m.top.findNode("playlistsKicker")
    if kicker <> invalid then kicker.visible = true
    if m.playlistsTitle <> invalid then m.playlistsTitle.opacity = 1
    if m.playlistsGrid <> invalid then m.playlistsGrid.visible = not empty
end sub

' Flat-content grid builder, mirroring buildGridContent's shape but against
' PlaylistResponse rows instead of catalog Works -- no hdPosterUrl since
' playlists have no artwork of their own (see this section's header
' comment). httpHeaders is still explicitly set to an empty associative
' array: ContentNode has a *built-in* httpHeaders field that defaults to an
' empty roArray (not invalid), so PosterCard.brs's `content.httpHeaders <>
' invalid` guard doesn't catch it, and roHttpAgent.SetHeaders throws
' "Object does not implement ifAssociativeArray" on the stray array --
' confirmed live on-device.
sub buildPlaylistDirectoryContent()
    root = CreateObject("roSGNode", "ContentNode")
    for each playlist in m.playlists
        item = root.CreateChild("ContentNode")
        item.id = playlist.id
        item.title = playlist.name
        item.hdPosterUrl = ""
        item.AddField("artHeaders", "assocarray", false)
        item.artHeaders = {}
    end for
    m.playlistsGrid.content = root
    m.playlistsTitle.text = "Playlists  •  " + m.playlists.Count().ToStr()
end sub

' MarkupGrid's itemSelected is a plain integer index, same shape as
' onBrowseItemSelected/onSearchItemSelected above.
sub onPlaylistDirectoryItemSelected(event as Object)
    index = event.GetData()
    if index = invalid or index < 0 or index >= m.playlists.Count() then return
    openPlaylistDetail(m.playlists[index])
end sub

sub openPlaylistDetail(playlist as Object)
    m.selectedPlaylist = playlist
    m.playlistDetailStage.stageTitle = playlist.name
    m.playlistDetailStage.stageKicker = "PLAYLIST"
    kindLabel = "Video"
    if playlist.media_type = "audio" then kindLabel = "Audio"
    visibilityLabel = "Personal"
    if playlist.is_system then visibilityLabel = "Shared"
    m.playlistDetailStage.stageMeta = kindLabel + "  •  " + visibilityLabel
    ' No cover art of its own -- filled in from the first hydrated item's
    ' own backdrop/poster once items resolve, see finishPlaylistDetail().
    setStageKeyArt(m.playlistDetailStage, "")
    m.playlistItems = []
    m.playlistItemQueue = []
    ' Stay in the playlists shell while items hydrate (no fullscreen status).
    m.playlistDetailOpen = true
    m.playlistsDirectoryGroup.visible = false
    m.playlistDetailGroup.visible = true
    buildGridContent(m.playlistItemsGrid, m.playlistItems)
    showOnly("playlists")
    m.top.screenState = "playlists"
    m.playlistItemsGrid.SetFocus(true)
    sendApi("playlistItems", "GET", "/api/v1/playlists/" + UrlEncode(playlist.id) + "/items", invalid, true)
end sub

sub acceptPlaylistItems(data as Object)
    if data = invalid
        ' Stay in playlist detail shell (no fullscreen status wall).
        m.playlistItems = []
        buildGridContent(m.playlistItemsGrid, m.playlistItems)
        m.playlistDetailOpen = true
        m.playlistsDirectoryGroup.visible = false
        m.playlistDetailGroup.visible = true
        showOnly("playlists")
        m.top.screenState = "playlists"
        m.playlistItemsGrid.SetFocus(true)
        return
    end if
    ' Already position-ordered per the endpoint's own contract (confirmed
    ' against tv-web's generated schema.ts doc comment: "This playlist's
    ' items, position-ordered"), so no client-side sort is needed before
    ' hydrating.
    m.playlistItemQueue = data
    m.playlistItems = []
    processNextPlaylistItem()
end sub

' Hydrates one playlist item's Work at a time via the same
' /api/v1/catalog/{id} detail endpoint openWorkDetail/processNextHomeWork
' use, then moves to the next queued item. A missing/failed work is simply
' skipped (see handleApiFailure's "playlistItemWork" best-effort branch)
' rather than aborting the whole playlist.
sub processNextPlaylistItem()
    if m.playlistItemQueue.Count() = 0
        finishPlaylistDetail()
        return
    end if
    item = m.playlistItemQueue.Shift()
    m.pendingPlaylistItem = item
    sendApi("playlistItemWork", "GET", "/api/v1/catalog/" + UrlEncode(item.work_id), invalid, true)
end sub

sub acceptPlaylistItemWork(data as Object)
    if data <> invalid and data.work <> invalid then m.playlistItems.Push(data.work)
    processNextPlaylistItem()
end sub

' Every queued item has resolved (or been skipped) -- paint the items grid,
' backfill the hero key-art from the first resolved item, append the
' "X items" count onto the meta line, and show the detail sub-view.
sub finishPlaylistDetail()
    buildGridContent(m.playlistItemsGrid, m.playlistItems)
    if m.playlistItems.Count() > 0
        setStageKeyArt(m.playlistDetailStage, heroArtworkUrl(m.playlistItems[0]))
    end if
    itemSuffix = m.playlistItems.Count().ToStr() + " item"
    if m.playlistItems.Count() <> 1 then itemSuffix += "s"
    m.playlistDetailStage.stageMeta = m.playlistDetailStage.stageMeta + "  •  " + itemSuffix
    m.playlistDetailOpen = true
    m.playlistsDirectoryGroup.visible = false
    m.playlistDetailGroup.visible = true
    showOnly("playlists")
    m.top.screenState = "playlists"
    m.playlistDetailStage.callFunc("playEntrance")
    if m.playlistItems.Count() > 0 then m.playlistItemsGrid.SetFocus(true)
end sub

' MarkupGrid's itemSelected is a plain integer index into m.playlistItems
' (already-resolved Works, in playlist order); routes to the same
' openWorkDetail() every other rail/grid uses, with a dedicated "playlists"
' origin so the detail screen's Back key returns here (see onKeyEvent's
' `state = "detail"` branch) instead of Home.
sub onPlaylistItemSelected(event as Object)
    index = event.GetData()
    if index = invalid or index < 0 or index >= m.playlistItems.Count() then return
    openWorkDetail(m.playlistItems[index], "playlists")
end sub

' Shared RowList content builder: `row` is any single-row RowList node
' (m.library or one of the home screen's rail RowLists), `works` an array of
' catalog Work objects. Used by both the legacy flat library screen and the
' home screen's rails.
' isActive bakes each item's activeRailFactor field at build time (read by
' PosterCard.onContentChanged, see that file's onFocusChanged comment): a
' freshly created RowList that has never actually held real remote focus does
' NOT lazily compute its selected item's own focusPercent down to 0 on its
' own -- confirmed live, an explicit SetFocus(false) on an already-unfocused
' rail doesn't do it either -- so Home's non-initial rails must never be
' allowed to inherit RowList's default "selected item looks focused" state in
' the first place. Content is rebuilt with the correct flag both at initial
' finishHomeLoad() (only rail 0 active) and on every moveHomeFocus() rail
' switch (old rail rebuilt false, new rail rebuilt true).
sub buildRailContent(row as Object, works as Object, isActive as Boolean, cardScale = 1.0 as Float)
    root = CreateObject("roSGNode", "ContentNode")
    rowNode = root.CreateChild("ContentNode")
    headers = ClientHeaders(m.accessToken)
    activeRailFactor = 0.0
    if isActive then activeRailFactor = 1.0
    for each work in works
        item = rowNode.CreateChild("ContentNode")
        item.id = work.id
        item.title = work.title
        item.AddField("kind", "string", false)
        item.kind = work.kind
        item.AddField("year", "string", false)
        if work.release_date <> invalid and work.release_date.Len() >= 4 then item.year = work.release_date.Left(4)
        item.description = JsonString(work.overview)
        ' Real catalog posters (same path as buildGridContent). Empty tiles
        ' were a residual-budget shortcut and made Home look unfinished.
        item.hdPosterUrl = artworkUrl(work)
        item.AddField("artHeaders", "assocarray", false)
        item.artHeaders = artworkHeaders(item.hdPosterUrl, headers)
        item.AddField("activeRailFactor", "float", false)
        item.activeRailFactor = activeRailFactor
        ' Similar Titles (detailSimilar) passes 1.5 to match the real,
        ' larger .tv-title-card sizing used there -- see PosterCard.xml's
        ' cardScale comment. Home's rails never pass this, so it defaults
        ' to a no-op 1.
        item.AddField("cardScale", "float", false)
        item.cardScale = cardScale
    end for
    row.content = root
end sub

' Most catalog images (movies/series, TMDB-sourced) carry a plain fetchable
' https:// URL, but *arr-integration-sourced images (confirmed live: every
' music/artist image) instead carry an internal-only "playarr-arr://..."
' reference scheme that isn't a real fetchable URL at all -- feeding it
' straight to AbsoluteUrl() (which only special-cases http/https, otherwise
' treats the value as a server-relative path) produced a mangled URL that
' 404s, confirmed live as the reason every artist card in this channel
' rendered with no artwork at all despite the catalog genuinely having a
' poster image for it. tv-web itself never fetches these URLs directly
' either (confirmed live via the network panel: it loads a blob: URL
' instead), resolving them through a dedicated
' GET /api/v1/artwork/work/{id}/{kind} proxy endpoint on the server, which
' is what any non-http(s) image.url must go through here too.
function resolveImageUrl(work as Object, image as Object) as String
    ' Always use the Playarr artwork proxy — never fetch TMDB/CDN hosts
    ' directly from the stick. Confirmed live: catalog returns public
    ' https://image.tmdb.org/... poster URLs that work from a browser, but
    ' Roku Poster loads stay on surface-soft placeholders; chapter thumbs
    ' from the same server (/api/v1/media/.../thumbnail) load fine. Proxying
    ' keeps one TLS path (the linked server) and carries auth via httpHeaders.
    if image = invalid or image.kind = invalid or image.kind = "" then return ""
    if work = invalid or work.id = invalid or work.id = "" then return ""
    return m.serverUrl + "/api/v1/artwork/work/" + UrlEncode(work.id) + "/" + UrlEncode(image.kind)
end function

function artworkUrl(work as Object) as String
    if work.images = invalid then return ""
    fallback = ""
    for each image in work.images
        if fallback = "" then fallback = resolveImageUrl(work, image)
        if image.kind = "poster" then return resolveImageUrl(work, image)
    end for
    return fallback
end function

' Prefers a wide "backdrop" image for the TvStage hero key-art (poster art is
' too narrow/tall to read well behind the title panel); falls back to the
' same poster-first logic as artworkUrl() when no backdrop is available.
' Stage key-art always requests the server-side `style=stage` bake (greyscale
' + contrast/brightness + right fade + opacity) so this client does not
' re-implement CSS filters that SceneGraph cannot express.
function heroArtworkUrl(work as Object) as String
    url = ""
    if work.images <> invalid
        for each image in work.images
            if image.kind = "backdrop"
                url = resolveImageUrl(work, image)
                exit for
            end if
        end for
    end if
    if url = "" then url = artworkUrl(work)
    if url = "" then return ""
    return withArtworkStyle(url, "stage")
end function

function withArtworkStyle(url as String, style as String) as String
    if url = "" or style = "" then return url
    if Instr(1, url, "?") > 0 then return url + "&style=" + UrlEncode(style)
    return url + "?style=" + UrlEncode(style)
end function

function artworkHeaders(url as String, headers as Object) as Object
    serverPrefix = m.serverUrl + "/"
    if url.Left(serverPrefix.Len()) = serverPrefix then return headers
    return {}
end function

function contentHeadersForUrl(url as String) as Object
    serverPrefix = m.serverUrl + "/"
    if url.Left(serverPrefix.Len()) = serverPrefix
        return ClientContentHeaders(m.accessToken)
    end if
    return []
end function

sub onLibraryItemFocused(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    itemIndex = position[1]
    moreAvailable = m.totalItems = invalid or m.items.Count() < m.totalItems
    if moreAvailable and itemIndex >= m.items.Count() - 10 and not m.requestBusy
        loadCatalog(true)
    end if
end sub

sub onLibraryItemSelected(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    index = position[1]
    if index < 0 or index >= m.items.Count() then return
    openWorkDetail(m.items[index], "library")
end sub

' Shared by the legacy flat library screen and every home-screen rail:
' fetches full details for `work` and transitions to the detail screen.
' `originState` ("library" or "home") is remembered so the detail screen's
' Back key returns to wherever the viewer actually came from.
sub openWorkDetail(work as Object, originState as String)
    m.selectedWork = work
    m.detailOrigin = originState
    ' Stay in the detail shell while WorkDetail loads (matches tv-web: route
    ' changes first, body fills when the request returns).
    if work <> invalid and work.title <> invalid
        m.detailStage.stageTitle = work.title
        if work.kind <> invalid then m.detailStage.stageKicker = UCase(work.kind)
    end if
    m.detailOverview.text = ""
    showOnly("detail")
    m.top.screenState = "detail"
    sendApi("detail", "GET", "/api/v1/catalog/" + UrlEncode(work.id), invalid, true)
end sub

' ---------------------------------------------------------------------------
' Home screen
'
' Replaces the flat single-row library as the post-profile-select landing
' screen. Composed on top of TvStage: a hero (title/kicker/meta/key-art) that
' tracks whichever rail item currently has focus, plus up to four rails built
' in this fixed order (any rail with zero items is omitted entirely, exactly
' like tv-web's Home page):
'   1. Continue Watching (durable in-progress rows) or, if none, a
'      Start Watching fallback (recent items across all kinds).
'   2. New Movies   - GET /api/v1/catalog?kind=movie&sort=recent&limit=12
'   3. New Series   - GET /api/v1/catalog?kind=series&sort=recent&limit=12
'   4. New Sites    - GET /api/v1/catalog?kind=site&sort=recent&limit=12
'
' The requests are chained one at a time (onApiResult below) because
' MainScene only ever has one ApiTask in flight (see m.requestBusy in
' startApiRequest) -- there is no fan-out/parallel request path here.
' ---------------------------------------------------------------------------

' Builds one rail's Group (title Label + single-row RowList) and appends it
' into homeStage's contentTarget. Called once per rail at scene init() time;
' rails are toggled visible/positioned later in finishHomeLoad() rather than
' being created/destroyed on every home screen visit.
function createHomeRail(contentTarget as Object) as Object
    group = CreateObject("roSGNode", "Group")
    group.visible = false

    title = CreateObject("roSGNode", "Label")
    title.translation = [0, 0]
    title.width = 800
    title.height = 30
    ' size 18 -> scale 0.56 (Theme.type.subtitle); left-aligned, so no
    ' scaleRotateCenter compensation is needed (top-left pivot already
    ' matches a left-aligned box's origin).
    title.scale = [0.56, 0.56]
    title.color = &hF4F0F1FF
    group.AppendChild(title)

    row = CreateObject("roSGNode", "RowList")
    row.itemComponentName = "PosterCard"
    row.numRows = 1
    ' itemSize is the ROW's own viewport box (the whole horizontal strip
    ' RowList renders/clips into), NOT one item's size -- confirmed live
    ' twice: set to one card's own dimensions [220,340], it clipped the
    ' whole row down to a single visible card; omitted outright (Roku's
    ' documented default [0,0]), it clipped the row to nothing, hiding every
    ' card, in both cases despite every item genuinely existing with its
    ' image already loaded (confirmed via debug-console texture-load
    ' traces). 860 matches TvStage's contentPanel width (864, see
    ' TvStage.xml) these rails render into. rowItemSize is the separate
    ' field that actually sizes each individual item.
    ' Card dimensions rebuilt against the real live .tv-home-card (16:9
    ' landscape thumbnail, 220x124 art + 220x165 total card, 24px gap) --
    ' see PosterCard.xml's header comment for the full measurement notes.
    row.itemSize = [860, 185]
    row.rowItemSize = [[220, 165]]
    row.rowItemSpacing = [[24, 0]]
    row.rowHeights = [185]
    row.showRowLabel = false
    row.focusXOffset = [0]
    row.rowFocusAnimationStyle = "fixedFocusWrap"
    ' Fully transparent: tv-web's real focus treatment is PosterCard's own
    ' lift+zoom (see PosterCard.xml/.brs), not RowList's native default
    ' focus-ring bitmap, which would otherwise draw an unwanted white
    ' outline with no basis in tv-web's actual CSS.
    row.focusBitmapBlendColor = &h00000000
    row.translation = [0, 34]
    group.AppendChild(row)

    contentTarget.AppendChild(group)
    return { group: group, title: title, row: row }
end function

sub enterHome(profileName as String)
    SaveProfileName(profileName)
    m.profileLabel.text = profileName
    m.currentProfileName = profileName
    m.homeContinueEntries = []
    m.homeWorkQueue = []
    m.homeFallbackItems = []
    m.homeMovies = []
    m.homeSeries = []
    m.homeMoreMovies = []
    m.homeMoreSeries = []
    ' Authenticated shell stays up while rails load (no fullscreen Loading UI).
    ' Reveal settled stage chrome immediately so the viewer never sits on
    ' opacity-0 content (left nav only) while catalogKinds → rails chain runs.
    showOnly("home")
    m.top.screenState = "home"
    if m.homeStage <> invalid
        m.homeStage.stageTitle = "Home"
        m.homeStage.stageKicker = "PLAYARR"
        m.homeStage.stageMeta = "Loading your library…"
        m.homeStage.stageOverview = ""
        m.homeStage.callFunc("revealStage")
    end if
    ' Filter Sites / other library kinds against GET /api/v1/catalog/kinds,
    ' then load home rails (chained one request at a time).
    sendApi("catalogKinds", "GET", "/api/v1/catalog/kinds", invalid, true)
end sub

sub loadWatchProgress()
    sendApi("watchProgress", "GET", "/api/v1/playback/progress", invalid, true)
end sub

function itemsFromCatalog(data as Object) as Object
    if data = invalid then return []
    ' Catalog list endpoints return { items: [...] }. Recommendation /
    ' similar endpoints return a bare array (confirmed live against
    ' GET /api/v1/catalog/{id}/similar). Accessing .items on a roArray
    ' is a BrightScript runtime error and suspends the channel in the
    ' micro debugger, so check GetInterface before field access.
    if GetInterface(data, "ifArray") <> invalid then return data
    if data.items = invalid then return []
    return data.items
end function

' `data` is a bare array of WatchProgress rows (media_file_id, position_ms,
' duration_ms, state, updated_at, work_id) -- see
' list_watch_progress_handler's 200 response in tv-web's generated
' schema.ts (no wrapping object). Keeps only "part_watched" rows, newest
' updated_at first, de-duplicated by work_id (a work can have more than one
' in-progress row across episodes), capped at 10 candidates.
sub acceptWatchProgress(data as Dynamic)
    rows = data
    if rows = invalid then rows = []
    resumable = []
    for each row in rows
        if row.state = "part_watched" then resumable.Push(row)
    end for
    resumable = SortWatchProgressDesc(resumable)
    seen = {}
    queue = []
    for each row in resumable
        if queue.Count() >= 10 then exit for
        if seen[row.work_id] = invalid
            seen[row.work_id] = true
            queue.Push(row)
        end if
    end for
    m.homeWorkQueue = queue
    processNextHomeWork()
end sub

' Simple stable insertion sort by updated_at (ISO 8601 strings compare
' lexically in chronological order), newest first. Roku's roArray has no
' Sort(comparator) overload, so this is hand-rolled.
' Selection sort, swapping array elements by index -- NOT the Insert()-based
' approach this used to use: confirmed live (see finishSimilarTitles's own
' near-identical fix/comment) that Insert() is not actually available on
' this device's roArray, a latent bug this function had carried
' unexercised the whole session, since this test account's Continue
' Watching has simply never had more than one real row to sort.
function SortWatchProgressDesc(rows as Object) as Object
    result = []
    for each row in rows
        result.Push(row)
    end for
    for i = 0 to result.Count() - 2
        bestIndex = i
        for j = i + 1 to result.Count() - 1
            if compareUpdatedAt(result[j], result[bestIndex]) > 0 then bestIndex = j
        end for
        if bestIndex <> i
            temp = result[i]
            result[i] = result[bestIndex]
            result[bestIndex] = temp
        end if
    end for
    return result
end function

function compareUpdatedAt(a as Object, b as Object) as Integer
    av = a.updated_at
    bv = b.updated_at
    if av = invalid then av = ""
    if bv = invalid then bv = ""
    if av > bv then return 1
    if av < bv then return -1
    return 0
end function

' Hydrates one Continue Watching candidate at a time via the same
' /api/v1/catalog/{id} detail endpoint the detail screen uses (there is no
' batch-by-ids catalog endpoint), then moves to the next queued row.
sub processNextHomeWork()
    if m.homeWorkQueue.Count() = 0
        finishContinueWatching()
        return
    end if
    row = m.homeWorkQueue.Shift()
    ' Keep progress row so acceptHomeWorkDetail can apply web's on-deck rules
    ' (episodic must resolve the progress media_file_id; artists are skipped).
    m.pendingHomeProgress = row
    sendApi("homeWorkDetail", "GET", "/api/v1/catalog/" + UrlEncode(row.work_id), invalid, true)
end sub

' Mirrors tv-web Home.tsx on-deck resolution: skip artist/author; for series/
' site require the progress media_file_id to exist in the children tree; movies
' need any playable media_file_id.
sub acceptHomeWorkDetail(data as Object)
    progress = m.pendingHomeProgress
    m.pendingHomeProgress = invalid
    if data <> invalid and data.work <> invalid
        kind = data.work.kind
        if kind <> "artist" and kind <> "author"
            accept = false
            if isEpisodicKind(kind)
                ' Prefer web rule (progress media_file_id must resolve in the
                ' season/episode tree). Fall back to any playable id so a
                ' renamed/missing episode does not empty the whole on-deck rail.
                if findFirstMediaFileId(data) <> ""
                    if progress = invalid or progress.media_file_id = invalid or progress.media_file_id = ""
                        accept = true
                    else if mediaFileIdInDetail(data, progress.media_file_id)
                        accept = true
                    else
                        accept = true
                    end if
                end if
            else if kind = "movie"
                if findFirstMediaFileId(data) <> "" then accept = true
            end if
            if accept then m.homeContinueEntries.Push(data.work)
        end if
    end if
    processNextHomeWork()
end sub

' True when mediaFileId appears anywhere under a WorkDetail response tree.
' Iterative stack walk (not recursive): deep series trees must not overflow
' BrightScript's call stack and stall the home load chain.
function mediaFileIdInDetail(root as Dynamic, mediaFileId as String) as Boolean
    if root = invalid or mediaFileId = "" then return false
    stack = []
    stack.Push(root)
    while stack.Count() > 0
        value = stack.Pop()
        if value <> invalid
            valueType = type(value)
            if valueType = "roAssociativeArray"
                if value.media_file_id <> invalid and value.media_file_id = mediaFileId then return true
                for each key in value
                    stack.Push(value[key])
                end for
            else if valueType = "roArray"
                for each child in value
                    stack.Push(child)
                end for
            end if
        end if
    end while
    return false
end function

sub finishContinueWatching()
    if m.homeContinueEntries.Count() > 0
        loadHomeMovies()
        return
    end if
    ' Start Watching fallback: recent movies only first page; series merge
    ' happens after both load (web uses mergeRecent series+movie+site, no artists).
    sendApi("homeFallback", "GET", "/api/v1/catalog?kind=movie&available_only=true&sort=recent&limit=8&offset=0", invalid, true)
end sub

sub loadHomeMovies()
    sendApi("homeMovies", "GET", "/api/v1/catalog?kind=movie&sort=recent&limit=12&offset=0&available_only=true", invalid, true)
end sub

sub loadHomeSeries()
    sendApi("homeSeries", "GET", "/api/v1/catalog?kind=series&sort=recent&limit=12&offset=0&available_only=true", invalid, true)
end sub

' "More movies"/"More series": confirmed live against the real app's own
' Home page (5 rails total: Continue/Start watching, New movies, New series,
' More movies, More series -- no "New Sites" rail exists there at all), a
' second page (offset=12, past the "New movies"/"New series" rails' own
' first 12) of the same catalog query.
sub loadHomeMoreMovies()
    sendApi("homeMoreMovies", "GET", "/api/v1/catalog?kind=movie&sort=recent&limit=12&offset=12&available_only=true", invalid, true)
end sub

sub loadHomeMoreSeries()
    sendApi("homeMoreSeries", "GET", "/api/v1/catalog?kind=series&sort=recent&limit=12&offset=12&available_only=true", invalid, true)
end sub

' Drop artist/author from home rails (web primary merge is series+movie+site).
function filterHomePrimaryKinds(items as Object) as Object
    out = []
    if items = invalid then return out
    for each work in items
        if work <> invalid and work.kind <> "artist" and work.kind <> "author"
            out.Push(work)
        end if
    end for
    return out
end function

' Web Home takeUnused: skip work ids already used on earlier rails.
function takeUnusedWorks(source as Object, usedIds as Object, count as Integer) as Object
    selected = []
    if source = invalid then return selected
    for each work in source
        if work <> invalid and work.id <> invalid and usedIds.Lookup(work.id) = invalid
            usedIds.AddReplace(work.id, true)
            selected.Push(work)
            if selected.Count() >= count then exit for
        end if
    end for
    return selected
end function

function takeFirstWorks(source as Object, count as Integer) as Object
    selected = []
    if source = invalid then return selected
    for each work in source
        selected.Push(work)
        if selected.Count() >= count then exit for
    end for
    return selected
end function

' Web mergeRecent sorts by added_at descending across kinds.
function sortWorksByAddedAtDesc(items as Object) as Object
    result = []
    if items = invalid then return result
    for each work in items
        result.Push(work)
    end for
    for i = 0 to result.Count() - 2
        bestIndex = i
        for j = i + 1 to result.Count() - 1
            av = ""
            bv = ""
            if result[j].added_at <> invalid then av = result[j].added_at
            if result[bestIndex].added_at <> invalid then bv = result[bestIndex].added_at
            if av > bv then bestIndex = j
        end for
        if bestIndex <> i
            temp = result[i]
            result[i] = result[bestIndex]
            result[bestIndex] = temp
        end if
    end for
    return result
end function

' All rail data sources have arrived (or come back empty) -- assemble
' whichever rails ended up with items, stack them top-to-bottom, hide the
' rest, and show the screen. The TvStage entrance animation only plays the
' first time the viewer lands on home (m.homeShown); returning here later
' (e.g. Back from detail) just refreshes the hero/rail content in place.
' Rail membership matches tv-web Home.tsx takeUnused (on-deck/start first,
' then new/more movies and series without repeating ids).
sub finishHomeLoad()
    usedIds = CreateObject("roAssociativeArray")
    primaryWorks = []
    primaryLabel = "Start watching"
    if m.homeContinueEntries.Count() > 0
        primaryWorks = takeUnusedWorks(m.homeContinueEntries, usedIds, 10)
        primaryLabel = "Continue watching"
    else if m.homeFallbackItems.Count() > 0
        primaryWorks = takeUnusedWorks(m.homeFallbackItems, usedIds, 8)
        primaryLabel = "Start watching"
    end if
    newMovies = takeUnusedWorks(m.homeMovies, usedIds, 12)
    newSeries = takeUnusedWorks(m.homeSeries, usedIds, 12)
    moreMovies = takeUnusedWorks(m.homeMoreMovies, usedIds, 12)
    moreSeries = takeUnusedWorks(m.homeMoreSeries, usedIds, 12)

    candidates = []
    if primaryWorks.Count() > 0
        candidates.Push({ group: m.continueRailGroup, title: m.continueTitle, row: m.continueRow, label: primaryLabel, works: primaryWorks })
    end if
    if newMovies.Count() > 0
        candidates.Push({ group: m.moviesRailGroup, title: m.moviesTitle, row: m.moviesRow, label: "New movies", works: newMovies })
    end if
    if newSeries.Count() > 0
        candidates.Push({ group: m.seriesRailGroup, title: m.seriesTitle, row: m.seriesRow, label: "New series", works: newSeries })
    end if
    if moreMovies.Count() > 0
        candidates.Push({ group: m.moreMoviesRailGroup, title: m.moreMoviesTitle, row: m.moreMoviesRow, label: "More movies", works: moreMovies })
    end if
    if moreSeries.Count() > 0
        candidates.Push({ group: m.moreSeriesRailGroup, title: m.moreSeriesTitle, row: m.moreSeriesRow, label: "More series", works: moreSeries })
    end if

    if candidates.Count() = 0
        ' Every rail source came back empty -- fall back to the legacy flat
        ' library screen rather than showing a blank home screen.
        enterLibrary(m.currentProfileName)
        return
    end if

    allGroups = [m.continueRailGroup, m.moviesRailGroup, m.seriesRailGroup, m.moreMoviesRailGroup, m.moreSeriesRailGroup]
    for each group in allGroups
        group.visible = false
    end for

    m.visibleRails = []
    m.currentContinueWorks = []
    y = 0
    railIndex = 0
    for each rail in candidates
        rail.group.visible = true
        rail.group.translation = [0, y]
        rail.title.text = rail.label
        isActiveRail = false
        if railIndex = 0 then isActiveRail = true
        buildRailContent(rail.row, rail.works, isActiveRail)
        m.visibleRails.Push({ row: rail.row, works: rail.works })
        if rail.row.isSameNode(m.continueRow) then m.currentContinueWorks = rail.works
        ' 400 matched the OLD 220x340 tall-poster card's much taller row; the
        ' rebuilt 220x165 16:9 card (see PosterCard.xml) needs proportionally
        ' less vertical rhythm per rail, confirmed live that leaving this at
        ' 400 left huge dead gaps and pushed the 4th/5th rails off the
        ' bottom of the screen entirely with no way to scroll to them.
        y += 210
        railIndex = railIndex + 1
    end for

    m.homeFocusIndex = 0
    ' Reset any vertical scroll left over from a previous visit (see
    ' scrollHomeToFocusedRail) -- the entrance animation only plays once
    ' ever (m.homeShown below), so a return trip to Home would otherwise
    ' keep whatever scroll position Back left it at.
    m.homeContent.translation = [983, 259]
    showOnly("home")
    m.top.screenState = "home"
    ' Reveal rails/hero first, then load key-art. Key-art used to block the
    ' SceneGraph thread (sync GetToFile) before playEntrance, so Home painted
    ' as left-nav-only dark stage forever when art was slow or hung.
    if not m.homeShown
        ' Dot-call syntax (m.homeStage.playEntrance()) reliably throws "Member
        ' function not found" on this device/OS despite the interface field
        ' and backing sub both being correctly declared (confirmed live via
        ' the on-device BrightScript debugger REPL) -- callFunc() is the
        ' robust invocation path for custom interface <function> members.
        m.homeStage.callFunc("playEntrance")
        m.homeShown = true
    else
        m.homeStage.callFunc("revealStage")
    end if
    updateHeroFromWork(m.visibleRails[0].works[0])
    m.visibleRails[0].row.SetFocus(true)
end sub

sub updateHeroFromWork(work as Object)
    if work = invalid then return
    m.homeStage.stageTitle = work.title
    ' Web hero kicker is "SERIES · CRIME" (kind + first genre), not bare kind.
    kicker = UCase(work.kind)
    if work.genres <> invalid and work.genres.Count() > 0
        kicker = kicker + "  ·  " + UCase(work.genres[0])
    end if
    m.homeStage.stageKicker = kicker
    meta = ""
    if work.release_date <> invalid and work.release_date.Len() >= 4
        meta = work.release_date.Left(4)
    end if
    if work.genres <> invalid and work.genres.Count() > 0
        if meta <> "" then meta += "  •  "
        meta += joinStrings(work.genres, ", ")
    end if
    m.homeStage.stageMeta = meta
    overview = ""
    if work.overview <> invalid then overview = work.overview
    m.homeStage.stageOverview = overview
    setStageKeyArt(m.homeStage, heroArtworkUrl(work))
end sub

' Authenticated artwork proxy for TvStage key-art Posters (Bearer required).
' Headers use the assocarray form PosterCard/roHttpAgent.SetHeaders expects.
sub setStageKeyArt(stage as Object, uri as String)
    if stage = invalid then return
    stage.keyArtHeaders = ClientHeaders(m.accessToken)
    stage.keyArtUri = uri
end sub

' Maps a rail's RowList node back to its backing works array so
' onHomeItemFocused/onHomeItemSelected can resolve "row 0 of this RowList" to
' an actual Work. Only 4 rail RowLists ever exist, so a simple identity
' comparison chain is clearer here than a node-keyed lookup table (Roku's
' roAssociativeArray keys must be strings, not nodes).
function worksForRow(row as Object) as Dynamic
    if row.isSameNode(m.continueRow) then return m.currentContinueWorks
    if row.isSameNode(m.moviesRow) then return m.homeMovies
    if row.isSameNode(m.seriesRow) then return m.homeSeries
    if row.isSameNode(m.moreMoviesRow) then return m.homeMoreMovies
    if row.isSameNode(m.moreSeriesRow) then return m.homeMoreSeries
    return invalid
end function

sub onHomeItemFocused(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    itemIndex = position[1]
    works = worksForRow(event.GetRoSGNode())
    if works = invalid or itemIndex < 0 or itemIndex >= works.Count() then return
    m.homeColIndex = itemIndex
    updateHeroFromWork(works[itemIndex])
    ' Column 0: hand focus to homeLeftProxy so Left can enter the dock
    ' (RowList never bubbles Left/Right to Scene onKeyEvent).
    if itemIndex = 0 and m.homeLeftProxy <> invalid and not m.navDockMode
        m.homeLeftProxy.SetFocus(true)
    end if
end sub

sub onHomeItemSelected(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    itemIndex = position[1]
    works = worksForRow(event.GetRoSGNode())
    if works = invalid or itemIndex < 0 or itemIndex >= works.Count() then return
    openWorkDetail(works[itemIndex], "home")
end sub

' Restores focus to whichever rail was focused before navigating away (e.g.
' returning from the detail screen) without replaying the entrance animation
' or rebuilding rail content.
sub focusCurrentHomeRail()
    if m.visibleRails.Count() = 0 then return
    idx = m.homeFocusIndex
    if idx < 0 or idx >= m.visibleRails.Count() then idx = 0
    m.visibleRails[idx].row.SetFocus(true)
end sub

' Up/Down between rails. Roku has no native "focus the vertically-nearest
' list" behaviour, so this is implemented by hand: SetFocus(true) on the
' neighbouring rail's RowList (which restores that RowList's own remembered
' column position automatically). Bounds-checked with no wraparound, matching
' tv-web's "stop at the top/bottom rail" behaviour.
function moveHomeFocus(delta as Integer) as Boolean
    newIndex = m.homeFocusIndex + delta
    if newIndex < 0 or newIndex >= m.visibleRails.Count() then return true
    ' Home's rail RowLists are separate sibling nodes (not rows within one
    ' shared RowList). SetFocus(false)/(true) alone is not enough to move the
    ' focus lift/zoom between them -- confirmed live that a RowList's
    ' selected item does not lazily recompute its own focusPercent down to 0
    ' just because SetFocus(false) was called on it. buildRailContent()'s
    ' isActive flag is what actually drives it (see its own and
    ' PosterCard.onContentChanged's comments), so both the departing and
    ' arriving rail's content must be rebuilt here with the flag flipped.
    ' SetFocus is still needed alongside it for genuine remote-control input
    ' routing (which RowList receives Up/Down/Left/Right/OK).
    oldIndex = m.homeFocusIndex
    if oldIndex >= 0 and oldIndex < m.visibleRails.Count()
        oldRail = m.visibleRails[oldIndex]
        oldRail.row.SetFocus(false)
        buildRailContent(oldRail.row, oldRail.works, false)
    end if
    m.homeFocusIndex = newIndex
    newRail = m.visibleRails[newIndex]
    buildRailContent(newRail.row, newRail.works, true)
    newRail.row.SetFocus(true)
    scrollHomeToFocusedRail()
    return true
end function

' Real tv-web Home is a normal scrolling web page, so a viewer there can
' just scroll down to reach "More movies"/"More series". Roku's homeContent
' rails are laid out at fixed y-offsets (210px apart, see finishHomeLoad)
' inside TvStage's fixed-size contentPanel, so with 5 rails that stack
' extends well past the bottom of the screen with nothing to pan it back
' into view -- confirmed live the 4th/5th rails were completely
' unreachable. Pans homeContent up once focus moves past the 3rd rail,
' keeping the focused rail as the 3rd visible slot; unwound back to 0 once
' focus returns to the first 3 rails.
sub scrollHomeToFocusedRail()
    ' homeContent IS TvStage's own contentPanel node (see TvStage.xml's
    ' contentTarget field), whose settled post-entrance translation is a
    ' fixed [983,259] (TvStage.xml's own documented contentPanel geometry),
    ' NOT [0,0] -- overwriting it outright rather than preserving that base
    ' would yank all of Home's rail content to the screen's top-left corner.
    keepVisible = 2
    scrollOffset = 0
    if m.homeFocusIndex > keepVisible then scrollOffset = (m.homeFocusIndex - keepVisible) * 210
    m.homeContent.translation = [983, 259 - scrollOffset]
end sub

' ---------------------------------------------------------------------------
' Global left-edge nav dock (real-CSS-audit correction pass)
'
' MainScene.xml's navDock Group declares 7 flat-indexed icon+label buttons:
' [Search], [Home, Series, Movies, Sites, Music], [Playlists]. Downloads is
' deliberately omitted on this platform -- Roku has no local file-storage /
' download-queue infrastructure at all, so there is nothing for a Downloads
' tab to lead to here (see git history for the removed downloadsGroup stub's
' full rationale). Everywhere else this mirrors tv-web's real App.tsx
' NAV_GROUPS order. Not a real SGDEX focusable list -- "focus" is
' hand-simulated by toggling each item's highlight Rectangle/icon
' opacity/label color and routing keys through onKeyEvent while
' m.navDockMode is true, the same pattern the old Home-only homeShortcuts
' row used, now generalised to a real (though still only Home-entered --
' see below) global dock.
'
' Scope note: entry into the dock (Up from Home's topmost rail, see
' onKeyEvent's "home"+"up" branch -- NOT Left, see that branch's own comment
' for why) is currently only wired from Home's rails. Every dock destination
' is reachable from Home already, and Back still works normally from every
' other screen, so nothing is unreachable -- but Home is the only screen this
' pass wired an entry point from. Left as a follow-up rather than guessed at
' without on-device verification for each screen.
' ---------------------------------------------------------------------------

function navDockKindList() as Object
    return ["search", "home", "series", "movie", "site", "artist", "playlist"]
end function

function navDockLabelList() as Object
    return ["Search", "Home", "Series", "Movies", "Sites", "Music", "Playlists"]
end function

' Map dock kind strings to WorkKind values from GET /api/v1/catalog/kinds.
' search / home / playlist are always shown (not library-kind gated).
function navDockWorkKindForSlot(kind as String) as String
    if kind = "series" then return "series"
    if kind = "movie" then return "movie"
    if kind = "site" then return "site"
    if kind = "artist" then return "artist"
    return ""
end function

' Residual freeze Posters were removed from MainScene.xml. Keep these entry
' points as no-ops so any stale call site cannot reintroduce dual-UI paint.
sub hideAllResiduals()
end sub

sub showResidualForScreen(name as String)
end sub

sub acceptCatalogKinds(data as Object)
    m.availableWorkKinds = CreateObject("roAssociativeArray")
    kindsList = data
    ' Accept bare array or { kinds: [...] } / { items: [...] } shapes.
    if data <> invalid and GetInterface(data, "ifArray") = invalid
        if data.kinds <> invalid and GetInterface(data.kinds, "ifArray") <> invalid
            kindsList = data.kinds
        else if data.items <> invalid and GetInterface(data.items, "ifArray") <> invalid
            kindsList = data.items
        else
            kindsList = invalid
        end if
    end if
    if kindsList <> invalid and GetInterface(kindsList, "ifArray") <> invalid
        for each kind in kindsList
            if kind <> invalid and kind <> ""
                m.availableWorkKinds.AddReplace(kind, true)
            end if
        end for
    end if
    applyNavDockKindFilter()
    loadWatchProgress()
end sub

' Hide library nav slots the viewer has no source for (same rule as tv-web
' App.tsx: item.workKind must be in availableWorkKinds from catalog/kinds).
' Sites is the common case: no Whisparr-style source => no Sites tab.
' Also reflows enabled items so hidden slots do not leave empty gaps.
sub applyNavDockKindFilter()
    kinds = navDockKindList()
    if m.navEnabled = invalid then m.navEnabled = [true, true, true, true, false, true, true]
    for i = 0 to kinds.Count() - 1
        workKind = navDockWorkKindForSlot(kinds[i])
        enabled = true
        if workKind <> ""
            if m.availableWorkKinds = invalid
                ' Until kinds load, hide Sites only (safest default for this user base).
                enabled = workKind <> "site"
            else
                enabled = m.availableWorkKinds.Lookup(workKind) <> invalid
            end if
        end if
        ' Hard gate: Sites never shows unless kinds explicitly includes "site".
        if workKind = "site" and (m.availableWorkKinds = invalid or m.availableWorkKinds.Lookup("site") = invalid)
            enabled = false
        end if
        m.navEnabled[i] = enabled
        if m.navIcons[i] <> invalid then m.navIcons[i].visible = enabled
        if m.navLabels[i] <> invalid then m.navLabels[i].visible = enabled
        if m.navHighlights[i] <> invalid and not enabled then m.navHighlights[i].visible = false
    end for
    layoutNavDock()
    if m.navDockIndex < 0 or m.navDockIndex >= m.navEnabled.Count() or not m.navEnabled[m.navDockIndex]
        m.navDockIndex = firstEnabledNavIndex()
    end if
    renderNavDockFocus()
end sub

' Pack enabled dock items tightly (Search, library kinds, Playlists) so hiding
' Sites/Music does not leave a blank slot mid-dock like the old fixed layout.
' Metrics match tv-web TV .app-nav / .app-nav-group / .app-nav-link at 1920×1080:
'   --tv-nav-edge ≈ 32–42, item 64×64, group pad 8, item gap 10, group gap 14,
'   group radius 22 (pre-rendered PNG), link radius 16 (pre-rendered chip).
' Group PNGs include an 8px soft-shadow pad around the solid rounded face.
sub layoutNavDock()
    if m.navIcons = invalid or m.navIcons.Count() = 0 then return
    itemSize = 64
    itemGap = 10
    itemStep = itemSize + itemGap ' 74
    groupPad = 8
    groupGap = 14
    shadowPad = 8
    dockLeft = 32
    contentLeft = dockLeft + groupPad ' face origin inside shadow pad
    iconInset = 16 ' centres 32×32 icon in 64 cell
    ' Three visual groups match tv-web NAV_GROUPS: search | libraries | playlists.
    groupRanges = [[0, 0], [1, 5], [6, 6]]
    ' Measure total dock height so we can vertically centre like
    ' .app-nav { top:50%; transform:translateY(-50%) }.
    totalH = 0
    visibleGroups = 0
    for g = 0 to groupRanges.Count() - 1
        range = groupRanges[g]
        n = 0
        for i = range[0] to range[1]
            if m.navEnabled <> invalid and m.navEnabled[i] then n = n + 1
        end for
        if n > 0
            if visibleGroups > 0 then totalH = totalH + groupGap
            totalH = totalH + groupPad * 2 + n * itemSize + (n - 1) * itemGap
            visibleGroups = visibleGroups + 1
        end if
    end for
    y = int((1080 - totalH) / 2)
    if y < 160 then y = 160

    for g = 0 to groupRanges.Count() - 1
        range = groupRanges[g]
        groupStartY = y
        groupHasVisible = false
        visibleCount = 0
        itemY = y + groupPad
        for i = range[0] to range[1]
            if m.navEnabled <> invalid and m.navEnabled[i]
                groupHasVisible = true
                visibleCount = visibleCount + 1
                ' Highlight chip sits on the 64×64 cell; focus PNG is 80×80 with
                ' 8px shadow pad and is offset in renderNavDockFocus.
                if m.navHighlights[i] <> invalid
                    m.navHighlights[i].translation = [contentLeft, itemY]
                    m.navHighlights[i].width = 64
                    m.navHighlights[i].height = 64
                end if
                if m.navIcons[i] <> invalid
                    m.navIcons[i].translation = [contentLeft + iconInset, itemY + iconInset]
                    m.navIcons[i].width = 32
                    m.navIcons[i].height = 32
                end if
                if m.navLabels[i] <> invalid
                    ' Label centred under icon. Pivot at local x=100
                    ' (scaleRotateCenter); keep that pivot on the icon centre.
                    m.navLabels[i].translation = [contentLeft + 32 - 100, itemY + 42]
                end if
                itemY = itemY + itemStep
            end if
        end for
        bg = m.top.findNode("navGroupBg" + g.ToStr())
        if bg <> invalid
            if groupHasVisible
                bg.visible = true
                ' Pre-rendered nav-group-N.png: content + 8px shadow pad each side.
                n = visibleCount
                if n < 1 then n = 1
                if n > 5 then n = 5
                faceH = groupPad * 2 + n * itemSize + (n - 1) * itemGap
                bg.uri = "pkg:/images/nav-group-" + n.ToStr() + ".png"
                bg.width = 80 + shadowPad * 2
                bg.height = faceH + shadowPad * 2
                bg.translation = [dockLeft - shadowPad, groupStartY - shadowPad]
                y = groupStartY + faceH
            else
                bg.visible = false
            end if
        end if
        if groupHasVisible and g < groupRanges.Count() - 1
            y = y + groupGap
        end if
    end for
end sub

function firstEnabledNavIndex() as Integer
    if m.navEnabled = invalid then return 0
    for i = 0 to m.navEnabled.Count() - 1
        if m.navEnabled[i] then return i
    end for
    return 0
end function

' SetFocus(true) on the Scene alone does not reliably strip focus away from
' the previously-focused rail RowList (confirmed on-device: pressing OK
' right after entering dock mode still triggered the still-focused rail's
' own rowItemSelected, opening that item's detail page instead of calling
' selectNavDockItem() -- RowList is a native component with its own built-in
' OK handling that runs before a Scene-level onKeyEvent branch ever sees the
' key). Explicitly SetFocus(false) on the rail row first so it genuinely
' relinquishes focus.
sub enterNavDock()
    if m.visibleRails.Count() > 0
        idx = m.homeFocusIndex
        if idx < 0 or idx >= m.visibleRails.Count() then idx = 0
        m.visibleRails[idx].row.SetFocus(false)
    end if
    m.navDockReturnState = m.top.screenState
    m.navDockMode = true
    m.navDockIndex = 0
    renderNavDockFocus()
    m.top.SetFocus(true)
end sub

sub exitNavDock()
    m.navDockMode = false
    renderNavDockFocus()
    focusCurrentHomeRail()
end sub

function moveNavDockFocus(delta as Integer) as Boolean
    newIndex = m.navDockIndex + delta
    while newIndex >= 0 and newIndex < m.navLabels.Count()
        if m.navEnabled = invalid or m.navEnabled[newIndex]
            m.navDockIndex = newIndex
            renderNavDockFocus()
            return true
        end if
        newIndex = newIndex + delta
    end while
    return true
end function

' Which dock slot matches the current screen (web .app-nav-link.is-active).
function activeNavDockIndex() as Integer
    state = m.top.screenState
    if state = "search" then return 0
    if state = "home" then return 1
    if state = "playlists" then return 6
    if state = "browse"
        if m.browseKind = "series" then return 2
        if m.browseKind = "movie" then return 3
        if m.browseKind = "site" then return 4
        if m.browseKind = "artist" then return 5
    end if
    return -1
end function

sub renderNavDockFocus()
    activeIdx = activeNavDockIndex()
    for i = 0 to m.navLabels.Count() - 1
        enabled = true
        if m.navEnabled <> invalid then enabled = m.navEnabled[i]
        if not enabled
            if m.navHighlights[i] <> invalid then m.navHighlights[i].visible = false
            if m.navIcons[i] <> invalid then m.navIcons[i].visible = false
            if m.navLabels[i] <> invalid then m.navLabels[i].visible = false
        else
            if m.navIcons[i] <> invalid then m.navIcons[i].visible = true
            if m.navLabels[i] <> invalid then m.navLabels[i].visible = true
            isFocused = false
            if m.navDockMode = true and i = m.navDockIndex then isFocused = true
            isActive = false
            if i = activeIdx then isActive = true
            showChip = false
            if isFocused or isActive then showChip = true
            if m.navHighlights[i] <> invalid
                m.navHighlights[i].visible = showChip
                if showChip
                    ' Focus chip is 80×80 with 8px shadow pad; active is exact 64×64.
                    ' Icon is inset 16px inside the 64 cell; chip top-left = icon - 16.
                    if m.navIcons[i] <> invalid
                        iconPos = m.navIcons[i].translation
                        if isFocused
                            m.navHighlights[i].uri = "pkg:/images/nav-item-focus.png"
                            m.navHighlights[i].width = 80
                            m.navHighlights[i].height = 80
                            m.navHighlights[i].translation = [iconPos[0] - 24, iconPos[1] - 24]
                        else
                            m.navHighlights[i].uri = "pkg:/images/nav-item-active.png"
                            m.navHighlights[i].width = 64
                            m.navHighlights[i].height = 64
                            m.navHighlights[i].translation = [iconPos[0] - 16, iconPos[1] - 16]
                        end if
                    end if
                end if
            end if
            if isFocused
                m.navIcons[i].opacity = 1
                m.navLabels[i].color = &hF4F0F1FF
            else if isActive
                m.navIcons[i].opacity = 1
                m.navLabels[i].color = &hF4F0F1FF
            else
                m.navIcons[i].opacity = 0.72
                m.navLabels[i].color = &h887A82FF
            end if
        end if
    end for
end sub

sub selectNavDockItem()
    kinds = navDockKindList()
    labels = navDockLabelList()
    idx = m.navDockIndex
    if idx < 0 or idx >= kinds.Count() then return
    if m.navEnabled <> invalid and not m.navEnabled[idx] then return
    m.navDockMode = false
    renderNavDockFocus()
    kind = kinds[idx]
    if kind = "home"
        showOnly("home")
        m.top.screenState = "home"
        focusCurrentHomeRail()
    else if kind = "search"
        openSearch()
    else if kind = "playlist"
        openPlaylists()
    else
        openBrowse(kind, labels[idx])
    end if
end sub

' ---------------------------------------------------------------------------
' Detail screen (phase 4)
'
' Branches on work.kind: a movie keeps the original single-Play-button
' LabelList path (detailActions), driven by WorkDetailSchema's own
' `media_file_id` (only ever populated for WorkKind::Movie -- see
' playarr-catalog's WorkDetail doc comment). A series or site instead
' walks WorkChildrenSchema's `{ Series: SeasonDetailSchema[] }` shape (site
' reuses the series tree server-side, per playarr-catalog::WorkChildren's
' doc comment: "Site reuses the series-shaped tree because Whisparr exposes
' sites and scenes through Sonarr-compatible series and episode resources")
' into detailEpisodes, a RowList with one row per season, so selecting a
' specific episode plays *that* EpisodeDetailSchema's own media_file_id
' instead of findFirstMediaFileId's old "grab the first playable file found
' anywhere in the response" behaviour.
'
' Phase 8 extends the same branch with `kind="artist"`: WorkChildrenSchema's
' third variant, `{ Artist: AlbumDetailSchema[] }` (confirmed against
' tv-web's generated schema.ts -- AlbumDetailSchema is `{ album: Album,
' tracks: TrackDetailSchema[] }`, and TrackDetailSchema is `{ media_file_id,
' runtime_ms, track: Track }`, the exact same doc-mirror shape as
' EpisodeDetailSchema). Rather than a second, near-duplicate
' season/episode-shaped code path, the season/episode and album/track trees
' are generalized behind one set of "grouped detail" helpers
' (renderGroupedDetailActions/buildEpisodeContent/groupLeaves below, plus
' m.detailGroupKind recording which vocabulary is active) since both server
' shapes are structurally identical: a flat array of "group" objects
' (season/album), each holding a leaf array (episodes/tracks) whose items
' all carry their own top-level `media_file_id`. onDetailEpisodeSelected,
' flattenEpisodes and the player's Previous/Next (playAdjacentEpisode) do
' not need to know which vocabulary is active at all -- they only ever touch
' the shared `media_file_id` field.
'
' Deferred out of scope for this phase (tracked for a future pass, not
' attempted here): chapters, cast/crew tracks, similar-titles rail,
' server-choice modal, playback-settings drawer, download drawer, a
' Resume-from-position label for movies (movies always show a plain "Play"
' -- wiring /api/v1/playback/progress into the detail screen itself, beyond
' the existing Home-screen Continue Watching use of it, is left for later),
' and (artist-specific) an album cover-flow 3D carousel, a music visualiser,
' an inline mini-player host, and touch swipe gestures (Roku has no touch
' input anyway) -- tv-web's MusicDetail.tsx has all four, but they need UI
' capabilities well beyond what this phase's condensed RowList-per-album
' list can offer.
' ---------------------------------------------------------------------------

sub showDetail(detail as Object)
    if detail = invalid or detail.work = invalid
        ' Stay in signed-in shell (home) — never a fullscreen status wall.
        showOnly("home")
        m.top.screenState = "home"
        focusCurrentHomeRail()
        return
    end if
    m.selectedDetail = detail
    work = detail.work
    ' Title/kicker/meta now live on detailStage's own title-panel fields
    ' instead of dedicated Labels -- exactly the same fields/shape
    ' updateHeroFromWork() sets for Home's hero, see its own comment for why
    ' the split is kicker=kind, meta=year+genres rather than one combined
    ' string.
    m.detailStage.stageTitle = work.title
    m.detailStage.stageKicker = UCase(work.kind)
    ' Matches the real detail page's own meta line (confirmed live:
    ' "Movie  1h 48m  2003  Released Oct 23, 2003  Action  Crime  Thriller"),
    ' not just "year  •  genres" -- kind + runtime (movies only, from
    ' detail.runtime_ms) + year + genres, joined the same way this app's
    ' other meta lines already are (no pill-chip rendering infrastructure
    ' exists here yet, so plain "  •  " separators stand in for those).
    metaParts = [CapitalizeFirst(work.kind)]
    if detail.runtime_ms <> invalid and detail.runtime_ms > 0
        metaParts.Push(formatRuntime(detail.runtime_ms))
    end if
    if work.release_date <> invalid and work.release_date.Len() >= 4
        metaParts.Push(work.release_date.Left(4))
    end if
    if work.genres <> invalid and work.genres.Count() > 0
        metaParts.Push(joinStrings(work.genres, ", "))
    end if
    m.detailStage.stageMeta = joinStrings(metaParts, "  •  ")
    ' Full-bleed backdrop key-art replaces the old small poster thumbnail
    ' (detailPoster, removed) -- tv-web's real detail page has no separate
    ' poster once there is hero art behind the title panel. Auth headers
    ' required for the artwork proxy (same as home hero).
    setStageKeyArt(m.detailStage, heroArtworkUrl(work))
    overview = JsonString(work.overview)
    if overview = "" then overview = "No description is available."
    m.detailOverview.text = overview

    isSeriesShaped = work.kind = "series" or work.kind = "site"
    isArtistShaped = work.kind = "artist"
    ' Reset before branching: only showMovieDetailActions below sets this
    ' for real, and a stale value from a previously-viewed movie must not
    ' leak into a series/artist detail view (this drives whether the
    ' Chapters rail load fires further down).
    m.currentMediaFileId = ""
    if isSeriesShaped
        m.detailGroupKind = "series"
        m.detailSeasons = seasonsFromDetail(detail)
        showSeriesDetailActions()
    else if isArtistShaped
        m.detailGroupKind = "artist"
        m.detailSeasons = albumsFromDetail(detail)
        showArtistDetailActions()
    else
        m.detailGroupKind = ""
        m.detailSeasons = []
        showMovieDetailActions(detail)
    end if

    ' Chapters + Similar Titles: fetched only once every other detail
    ' response has already landed (see the "detail"/onApiResult chain in
    ' onApiResult) and requests are strictly single-flight on this
    ' platform, so this kicks off a serial fetch chain -- chapters first
    ' (movies only), then similar titles -- rather than firing them
    ' concurrently the way tv-web's own two independent effects do.
    m.detailChapters.visible = false
    m.detailSimilar.visible = false
    if m.currentMediaFileId <> ""
        loadDetailChapters(m.currentMediaFileId)
    else
        loadSimilarTitles(work)
    end if

    showOnly("detail")
    m.top.screenState = "detail"
    ' Unlike Home's one-shot m.homeShown flag, the entrance animation is
    ' replayed on every single detail-screen entry, not just the first.
    ' Home's rails persist their content across focus changes/re-entries
    ' (only the hero swaps), so replaying there would be a jarring, pointless
    ' re-animation of unchanged rail content -- but detail re-enters fresh
    ' with a wholly different work every time openWorkDetail() is called,
    ' mirroring tv-web's actual DetailPage, which remounts per
    ' `key={selected.id}` and replays its own entrance transition for every
    ' newly selected title. callFunc() (not dot-call) per the platform bug
    ' documented on TvStage.xml's playEntrance interface function.
    m.detailStage.callFunc("playEntrance")
    m.detailFocusIndex = 0
    if (isSeriesShaped or isArtistShaped) and m.detailSeasons.Count() > 0 and m.detailEpisodes.visible
        m.detailEpisodes.SetFocus(true)
    else
        m.detailActions.SetFocus(true)
    end if
end sub

' Chapters/Similar Titles load in asynchronously after showDetail already
' handed focus to detailActions/detailEpisodes (see the request chain
' kicked off there), so they're never the initial focus target -- only
' reachable by pressing Down from the top control, exactly like a real
' page where those tracks simply aren't there yet on first paint.
'
' The 3 "slots" here (top control, Chapters, Similar Titles) are separate
' sibling nodes, not rows within one shared list (RowList/LabelList has no
' native "move focus to the vertically-nearest sibling list" behaviour), so
' this is implemented by hand the same way moveHomeFocus is: bounds-checked
' against whichever of the 3 slots actually has visible content, with no
' wraparound, matching every other multi-list focus chain in this file.
function moveDetailFocus(delta as Integer) as Boolean
    slots = [detailFocusTopControl()]
    if m.detailChapters.visible then slots.Push(m.detailChapters)
    if m.detailSimilar.visible then slots.Push(m.detailSimilar)
    newIndex = m.detailFocusIndex + delta
    if newIndex < 0 or newIndex >= slots.Count() then return true
    oldSlot = slots[m.detailFocusIndex]
    if oldSlot.isSameNode(m.detailChapters) then buildDetailChaptersRail(false)
    if oldSlot.isSameNode(m.detailSimilar) then buildDetailSimilarRail(false)
    m.detailFocusIndex = newIndex
    newSlot = slots[newIndex]
    if newSlot.isSameNode(m.detailChapters) then buildDetailChaptersRail(true)
    if newSlot.isSameNode(m.detailSimilar) then buildDetailSimilarRail(true)
    newSlot.SetFocus(true)
    return true
end function

function detailFocusTopControl() as Object
    if m.detailEpisodes.visible then return m.detailEpisodes
    return m.detailActions
end function

' Movie path: unchanged shape from phase 3, just factored out of showDetail
' and reading WorkDetailSchema's own `media_file_id`/`runtime_ms` directly
' instead of scanning the whole response with findFirstMediaFileId.
sub showMovieDetailActions(detail as Object)
    m.detailEpisodes.visible = false
    m.detailActions.visible = true
    mediaFileId = ""
    if detail.media_file_id <> invalid then mediaFileId = detail.media_file_id
    m.currentMediaFileId = mediaFileId
    if mediaFileId = ""
        setListContent(m.detailActions, ["Not available to play"])
    else
        setListContent(m.detailActions, ["Play"])
    end if
end sub

' ---------------------------------------------------------------------------
' Chapters + Similar Titles rails (confirmed live against the real detail
' page's own network calls, see MainScene.xml's detailChapters/detailSimilar
' comment for the full endpoint/algorithm rationale).
' ---------------------------------------------------------------------------

sub loadDetailChapters(mediaFileId as String)
    sendApi("chapters", "GET", "/api/v1/media/" + UrlEncode(mediaFileId) + "/chapters", invalid, true)
end sub

' MediaChapter: { index, title, start_ms, end_ms }. Each card's art is a
' genuine per-timestamp generated thumbnail (GET .../thumbnail?position_ms=),
' not a static image field, so this builds its own ContentNode items rather
' than going through buildRailContent/artworkUrl (which both assume a real
' catalog work's `images` array).
sub acceptDetailChapters(chapters as Object)
    if chapters = invalid or chapters.Count() = 0
        m.detailChapterList = []
        m.detailChapters.visible = false
        loadSimilarTitles(m.selectedDetail.work)
        return
    end if
    m.detailChapterList = chapters
    buildDetailChaptersRail(true)
    m.detailChapters.visible = true
    loadSimilarTitles(m.selectedDetail.work)
end sub

' Split out of acceptDetailChapters so moveDetailFocus (below) can rebuild
' this rail's content with a different isActive flag on every focus
' transition -- the same reason Home's buildRailContent gets called again
' on every moveHomeFocus, RowList always shows its own "currently selected"
' item at focusPercent=1 regardless of whether the RowList itself genuinely
' holds Scene focus, so simultaneously-visible sibling rails (this one and
' detailSimilar both render at once, exactly like Home's 4 rails) need this
' rebuild to suppress the border/lift on whichever one ISN'T really focused.
sub buildDetailChaptersRail(isActive as Boolean)
    root = CreateObject("roSGNode", "ContentNode")
    rowNode = root.CreateChild("ContentNode")
    rowNode.title = "Chapters"
    headers = ClientHeaders(m.accessToken)
    activeRailFactor = 0.0
    if isActive then activeRailFactor = 1.0
    for each chapter in m.detailChapterList
        thumbUrl = m.serverUrl + "/api/v1/media/" + UrlEncode(m.currentMediaFileId) + "/thumbnail?position_ms=" + chapter.start_ms.ToStr()
        item = rowNode.CreateChild("ContentNode")
        item.id = chapter.index.ToStr()
        item.title = chapter.title
        item.AddField("kind", "string", false)
        item.kind = formatPlaybackTime(chapter.start_ms / 1000)
        item.AddField("showKind", "boolean", false)
        item.showKind = true
        item.hdPosterUrl = thumbUrl
        item.AddField("artHeaders", "assocarray", false)
        item.artHeaders = artworkHeaders(thumbUrl, headers)
        item.AddField("activeRailFactor", "float", false)
        item.activeRailFactor = activeRailFactor
        item.AddField("cardScale", "float", false)
        item.cardScale = 1.5
        item.AddField("startMs", "integer", false)
        item.startMs = chapter.start_ms
    end for
    m.detailChapters.content = root
end sub

sub onDetailChapterSelected(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    itemIndex = position[1]
    row = m.detailChapters.content.GetChild(0)
    if row = invalid or itemIndex < 0 or itemIndex >= row.GetChildCount() then return
    chapterItem = row.GetChild(itemIndex)
    ' Starts playback from this chapter's own timestamp: requestPlayback
    ' already exists for the plain "Play from the start" path (see
    ' onDetailActionSelected), this just seeks once the session is live,
    ' the same two-step "request a session, then seek" shape seekPlayback
    ' already uses for the in-player skip controls.
    m.pendingChapterSeekMs = chapterItem.startMs
    requestPlayback(m.currentMediaFileId)
end sub

' Real tv-web's own WorkDetail.tsx (confirmed live): try the real
' recommendation endpoint first (GET /api/v1/catalog/{id}/similar), and only
' on empty/failure fall back to a client-side genre search -- ported
' faithfully rather than skipping straight to the fallback, since a
' catalog with cached embeddings would otherwise never get real
' recommendations here.
sub loadSimilarTitles(work as Object)
    m.similarWork = work
    sendApi("similarPrimary", "GET", "/api/v1/catalog/" + UrlEncode(work.id) + "/similar?limit=20", invalid, true)
end sub

sub acceptSimilarPrimary(data as Object)
    items = itemsFromCatalog(data)
    visible = []
    for each candidate in items
        if candidate.id <> m.similarWork.id and (candidate.kind = "movie" or isEpisodicKind(candidate.kind))
            visible.Push(candidate)
        end if
    end for
    if visible.Count() > 0
        m.similarWorks = []
        for i = 0 to visible.Count() - 1
            if i >= 20 then exit for
            m.similarWorks.Push(visible[i])
        end for
        buildDetailSimilarRail(true)
        m.detailSimilar.visible = true
        return
    end if
    startSimilarGenreFallback()
end sub

' See buildDetailChaptersRail's comment for why moveDetailFocus (below)
' needs to rebuild this rail's content on every focus transition too.
sub buildDetailSimilarRail(isActive as Boolean)
    buildRailContent(m.detailSimilar, m.similarWorks, isActive, 1.5)
    row = m.detailSimilar.content.GetChild(0)
    if row <> invalid then row.title = "Similar Titles"
end sub

sub startSimilarGenreFallback()
    genres = []
    if m.similarWork.genres <> invalid
        for i = 0 to m.similarWork.genres.Count() - 1
            if i >= 3 then exit for
            genres.Push(m.similarWork.genres[i])
        end for
    end if
    m.similarGenres = genres
    m.similarCandidates = {}
    m.similarIndex = 0
    if genres.Count() = 0
        ' Real tv-web's own fallback-of-the-fallback when a work has no
        ' genres at all: browse the same kind, newest first, instead of a
        ' genre search with nothing to search by.
        sendApi("similarGenre", "GET", "/api/v1/catalog?kind=" + UrlEncode(m.similarWork.kind) + "&available_only=true&sort=date_added&order=desc&limit=100", invalid, true)
        return
    end if
    loadNextSimilarGenrePage()
end sub

sub loadNextSimilarGenrePage()
    genres = m.similarGenres
    if m.similarIndex >= genres.Count()
        finishSimilarTitles()
        return
    end if
    genre = genres[m.similarIndex]
    sendApi("similarGenre", "GET", "/api/v1/catalog?genre=" + UrlEncode(genre) + "&available_only=true&limit=100", invalid, true)
end sub

sub acceptSimilarGenrePage(data as Object)
    items = itemsFromCatalog(data)
    for each candidate in items
        if candidate.id <> m.similarWork.id and (candidate.kind = "movie" or isEpisodicKind(candidate.kind))
            m.similarCandidates[candidate.id] = candidate
        end if
    end for
    m.similarIndex += 1
    loadNextSimilarGenrePage()
end sub

' sharedGenres*100 + sameKind*10 + yearProximity(max 5, decaying over 5
' years/point) -- a direct port of tv-web's own relatedWorkScore
' (WorkDetail.tsx), not an approximation.
function scoreSimilarWork(target as Object, candidate as Object) as Float
    targetGenres = {}
    if target.genres <> invalid
        for each g in target.genres
            targetGenres[LCase(g)] = true
        end for
    end if
    sharedGenres = 0
    if candidate.genres <> invalid
        for each g in candidate.genres
            if targetGenres[LCase(g)] <> invalid then sharedGenres = sharedGenres + 1
        end for
    end if
    sameKind = 0
    if target.kind = candidate.kind then sameKind = 1
    yearProximity = 0.0
    targetYear = releaseYearOf(target)
    candidateYear = releaseYearOf(candidate)
    if targetYear <> invalid and candidateYear <> invalid
        diff = Abs(targetYear - candidateYear)
        proximity = 5.0 - (diff / 5.0)
        if proximity > 0 then yearProximity = proximity
    end if
    return (sharedGenres * 100) + (sameKind * 10) + yearProximity
end function

' Direct port of tv-web's own isEpisodicKind (WorkDetail.tsx): "site" reuses
' the series-shaped children tree server-side (see this file's own detail-
' screen header comment), so it counts as episodic here too.
function isEpisodicKind(kind as String) as Boolean
    return kind = "series" or kind = "site"
end function

function releaseYearOf(work as Object) as Dynamic
    if work.release_date = invalid or work.release_date.Len() < 4 then return invalid
    return Val(work.release_date.Left(4))
end function

sub finishSimilarTitles()
    scored = []
    for each id in m.similarCandidates
        work = m.similarCandidates[id]
        scored.Push({ work: work, score: scoreSimilarWork(m.similarWork, work) })
    end for
    ' Selection sort by score desc, then sort_title asc, swapping array
    ' elements by index instead of SortWatchProgressDesc's Insert()-based
    ' approach elsewhere in this file (roArray has no Sort(comparator)
    ' overload either way) -- confirmed live that Insert() is not actually
    ' available on this device's roArray despite that existing pattern
    ' looking identical: Continue Watching (SortWatchProgressDesc's only
    ' caller) has simply never had a non-empty list to sort this session,
    ' so that call was never really exercised before. Index swaps only use
    ' Push/bracket access, both already proven live elsewhere.
    for i = 0 to scored.Count() - 2
        bestIndex = i
        for j = i + 1 to scored.Count() - 1
            better = false
            if scored[j].score > scored[bestIndex].score
                better = true
            else if scored[j].score = scored[bestIndex].score and scored[j].work.sort_title < scored[bestIndex].work.sort_title
                better = true
            end if
            if better then bestIndex = j
        end for
        if bestIndex <> i
            temp = scored[i]
            scored[i] = scored[bestIndex]
            scored[bestIndex] = temp
        end if
    end for
    m.similarWorks = []
    for i = 0 to scored.Count() - 1
        if i >= 20 then exit for
        m.similarWorks.Push(scored[i].work)
    end for
    if m.similarWorks.Count() = 0
        m.detailSimilar.visible = false
        return
    end if
    buildDetailSimilarRail(true)
    m.detailSimilar.visible = true
end sub

sub onDetailSimilarSelected(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    itemIndex = position[1]
    if itemIndex < 0 or itemIndex >= m.similarWorks.Count() then return
    ' Inherits the current detail screen's own origin (rather than pushing
    ' a new "detail" origin, which this codebase's single-level Back model
    ' has no representation for) -- Back from the new detail screen lands
    ' wherever this one would have, the same simplification already used
    ' everywhere else Back is one level, not a real stack.
    openWorkDetail(m.similarWorks[itemIndex], m.detailOrigin)
end sub

' Series/site path: builds detailEpisodes' season/episode RowList content
' from m.detailSeasons (already parsed by seasonsFromDetail) and appends a
' season/episode count onto the meta line. Falls back to the same
' "Not available to play" LabelList state as a movie with no file when not
' a single episode anywhere has a resolved media_file_id yet. A thin wrapper
' around the shared renderGroupedDetailActions (see its doc comment) --
' kept as its own named sub (rather than inlined at both call sites) so the
' series/site call site reads the same as it did before phase 8.
sub showSeriesDetailActions()
    renderGroupedDetailActions(m.detailSeasons, "series")
end sub

' Artist path (phase 8): same shape as showSeriesDetailActions above, just
' against the `{ Artist: AlbumDetailSchema[] }` children variant instead of
' `{ Series: SeasonDetailSchema[] }`. See renderGroupedDetailActions/
' buildEpisodeContent/groupLeaves for the shared season-or-album,
' episode-or-track handling.
sub showArtistDetailActions()
    renderGroupedDetailActions(m.detailSeasons, "artist")
end sub

' Parses WorkChildrenSchema off a WorkDetailSchema response. `children` is
' either the bare JSON string "Movie" (externally-tagged unit variant) or a
' one-key object such as {"Series": [SeasonDetailSchema, ...]} -- see
' playarr-catalog::WorkChildren and its generated WorkChildrenSchema type
' in tv-web's schema.ts. Only the Series shape is handled here; Artist is
' handled by albumsFromDetail below (Author remains out of scope for this
' phase, same as chapters/cast/crew/similar-titles).
function seasonsFromDetail(detail as Object) as Object
    if detail = invalid or detail.children = invalid then return []
    children = detail.children
    if type(children) = "roAssociativeArray" and children.Series <> invalid
        return children.Series
    end if
    return []
end function

' Artist counterpart to seasonsFromDetail above: unwraps the
' `{ Artist: AlbumDetailSchema[] }` WorkChildrenSchema variant.
function albumsFromDetail(detail as Object) as Object
    if detail = invalid or detail.children = invalid then return []
    children = detail.children
    if type(children) = "roAssociativeArray" and children.Artist <> invalid
        return children.Artist
    end if
    return []
end function

' Shared by showSeriesDetailActions and showArtistDetailActions: computes
' the "X seasons • Y episodes" / "X albums • Y tracks" meta suffix and
' decides whether detailEpisodes (playable groups) or detailActions
' ("Not available to play") is shown, exactly like the phase-4 series-only
' version did, generalized over `kind` ("series" or "artist") instead of
' duplicated per kind. `groups` is either SeasonDetailSchema[] or
' AlbumDetailSchema[]; groupLeaves() below abstracts which nested array
' (.episodes vs .tracks) holds each group's playable leaves.
sub renderGroupedDetailActions(groups as Object, kind as String)
    leafTotal = 0
    playableTotal = 0
    for each group in groups
        for each leaf in groupLeaves(group, kind)
            leafTotal += 1
            if leaf.media_file_id <> invalid and leaf.media_file_id <> "" then playableTotal += 1
        end for
    end for

    if kind = "artist"
        groupWord = "album"
        leafWord = "track"
    else
        groupWord = "season"
        leafWord = "episode"
    end if
    suffix = groups.Count().ToStr() + " " + groupWord
    if groups.Count() <> 1 then suffix += "s"
    suffix += "  •  " + leafTotal.ToStr() + " " + leafWord
    if leafTotal <> 1 then suffix += "s"
    m.detailStage.stageMeta = m.detailStage.stageMeta + "  •  " + suffix

    if playableTotal = 0
        m.detailEpisodes.visible = false
        m.detailActions.visible = true
        m.currentMediaFileId = ""
        setListContent(m.detailActions, ["Not available to play"])
    else
        m.detailActions.visible = false
        m.detailEpisodes.visible = true
        buildEpisodeContent(groups, kind)
    end if
end sub

' Returns `group`'s leaf array (EpisodeDetailSchema[] or TrackDetailSchema[])
' regardless of which grouped-detail vocabulary is active. Both leaf types
' are the same doc-mirror shape (`{ media_file_id, runtime_ms, <episode |
' track> }`, confirmed against tv-web's generated schema.ts), so every
' caller of this (onDetailEpisodeSelected, flattenEpisodes,
' renderGroupedDetailActions, buildEpisodeContent) only ever needs to know
' *which* nested field to read, never a different leaf shape.
function groupLeaves(group as Object, kind as String) as Object
    if kind = "artist" then return group.tracks
    return group.episodes
end function

' Flat-content-per-row builder for detailEpisodes: one row per season or
' album (season.title falls back to "Season N" / an album just uses its own
' title, when the metadata provider didn't supply a season name), each row's
' items one PosterCard per episode or track. Sets detailEpisodes.numRows to
' match the group count since that count differs per title (RowList's
' numRows, like MarkupGrid's numColumns elsewhere in this app, is safe to
' change at runtime). Generalized over `kind` (phase 8) rather than kept as
' a second near-identical function for albums/tracks -- the two shapes only
' differ in row-title vocabulary and which nested schema (Episode vs Track)
' backs each leaf item.
sub buildEpisodeContent(groups as Object, kind as String)
    root = CreateObject("roSGNode", "ContentNode")
    headers = ClientHeaders(m.accessToken)
    for each group in groups
        rowNode = root.CreateChild("ContentNode")
        if kind = "artist"
            album = group.album
            rowNode.title = album.title
            for each trackDetail in group.tracks
                track = trackDetail.track
                item = rowNode.CreateChild("ContentNode")
                item.id = track.id
                label = track.track_number.ToStr() + ". " + track.title
                if trackDetail.runtime_ms <> invalid and trackDetail.runtime_ms > 0
                    label += "  " + formatPlaybackTime(trackDetail.runtime_ms / 1000)
                end if
                item.title = label
                item.description = ""
                item.hdPosterUrl = artworkUrl(album)
                item.AddField("artHeaders", "assocarray", false)
                item.artHeaders = artworkHeaders(item.hdPosterUrl, headers)
            end for
        else
            season = group.season
            rowTitle = "Season " + season.season_number.ToStr()
            if season.title <> invalid and season.title <> "" then rowTitle += "  •  " + season.title
            rowNode.title = rowTitle
            for each epDetail in group.episodes
                ep = epDetail.episode
                item = rowNode.CreateChild("ContentNode")
                item.id = ep.id
                label = "S" + season.season_number.ToStr() + " · E" + ep.episode_number.ToStr()
                if ep.title <> invalid and ep.title <> "" then label += "  " + ep.title
                item.title = label
                item.description = JsonString(ep.overview)
                item.hdPosterUrl = episodeArtworkUrl(ep)
                item.AddField("artHeaders", "assocarray", false)
                item.artHeaders = artworkHeaders(item.hdPosterUrl, headers)
            end for
        end if
    end for
    m.detailEpisodes.numRows = groups.Count()
    m.detailEpisodes.content = root
end sub

function episodeArtworkUrl(ep as Object) as String
    if ep.images = invalid then return ""
    for each image in ep.images
        return AbsoluteUrl(m.serverUrl, image.url)
    end for
    return ""
end function

' Iterative stack walk (not recursive): deep series trees must not overflow
' BrightScript's call stack and stall the home load chain mid homeWorkDetail.
function findFirstMediaFileId(value as Dynamic) as String
    if value = invalid then return ""
    stack = []
    stack.Push(value)
    while stack.Count() > 0
        node = stack.Pop()
        if node <> invalid
            valueType = type(node)
            if valueType = "roAssociativeArray"
                if node.media_file_id <> invalid and node.media_file_id <> ""
                    return node.media_file_id
                end if
                for each key in node
                    stack.Push(node[key])
                end for
            else if valueType = "roArray"
                for each child in node
                    stack.Push(child)
                end for
            end if
        end if
    end while
    return ""
end function

sub onDetailActionSelected(event as Object)
    if event.GetData() <> 0 then return
    if m.currentMediaFileId = invalid or m.currentMediaFileId = "" then return
    ' Movie playback has no adjacent-episode concept, so the player's
    ' Previous/Next buttons must render dimmed/no-op (see
    ' renderPlayerEpisodeNav) rather than carrying over a stale episode list
    ' from a previously-viewed series.
    m.playbackEpisodeList = []
    m.playbackEpisodeIndex = -1
    requestPlayback(m.currentMediaFileId)
end sub

' RowList's rowItemSelected fires [row, col]; row indexes m.detailSeasons
' (one row per season) and col indexes that season's episodes array --
' mirrors onLibraryItemSelected's position[1] unpacking above. A no-op
' (rather than a disabled-looking item) when the selected episode has no
' resolved media_file_id yet, same guard requestPlayback already applies.
'
' Also flattens m.detailSeasons into m.playbackEpisodeList/Index so the
' player's Previous/Next controls (playAdjacentEpisode below) can step to
' the adjacent episode's own media_file_id without re-fetching the detail
' response -- the whole season/episode tree is already in memory here.
sub onDetailEpisodeSelected(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    rowIndex = position[0]
    colIndex = position[1]
    if rowIndex < 0 or rowIndex >= m.detailSeasons.Count() then return
    episodes = groupLeaves(m.detailSeasons[rowIndex], m.detailGroupKind)
    if colIndex < 0 or colIndex >= episodes.Count() then return
    epDetail = episodes[colIndex]
    mediaFileId = epDetail.media_file_id
    if mediaFileId = invalid or mediaFileId = "" then return
    m.playbackEpisodeList = flattenEpisodes(m.detailSeasons)
    flatIndex = 0
    for s = 0 to rowIndex - 1
        flatIndex += groupLeaves(m.detailSeasons[s], m.detailGroupKind).Count()
    end for
    flatIndex += colIndex
    m.playbackEpisodeIndex = flatIndex
    requestPlayback(mediaFileId)
end sub

' Flattens the per-season/album leaf arrays (in season/episode or
' album/track order) into one list so playAdjacentEpisode can walk it with a
' simple +/-1 index, the same order onDetailEpisodeSelected's flatIndex
' computation above assumes. Reads m.detailGroupKind (set by showDetail) to
' resolve each group's leaf array via groupLeaves rather than hardcoding
' `.episodes` -- this is what lets the player's Previous/Next work for album
' tracks exactly like it already does for episodes, with no separate
' "flattenTracks" path.
function flattenEpisodes(seasons as Object) as Object
    flat = []
    for each seasonDetail in seasons
        for each epDetail in groupLeaves(seasonDetail, m.detailGroupKind)
            flat.Push(epDetail)
        end for
    end for
    return flat
end function

sub requestPlayback(mediaFileId as String)
    if mediaFileId = "" then return
    m.currentMediaFileId = mediaFileId
    config = AppConfig()
    path = "/api/v1/playback/" + UrlEncode(mediaFileId)
    path += "?containers=mp4%2Cmkv%2Cm3u8&video_codecs=h264&audio_codecs=aac%2Cac3%2Ceac3"
    path += "&max_bitrate_bps=" + config.maxBitrateBps.ToStr()
    ' Stay on detail (or player chrome) while negotiating; no fullscreen Loading shell.
    sendApi("playback", "GET", path, invalid, true)
end sub

sub startPlayback(data as Object)
    if data = invalid or data.url = invalid
        ' Stay on detail chrome (no fullscreen status wall).
        showOnly("detail")
        m.top.screenState = "detail"
        m.detailActions.SetFocus(true)
        return
    end if
    content = CreateObject("roSGNode", "ContentNode")
    content.url = AbsoluteUrl(m.serverUrl, data.url)
    content.title = m.selectedDetail.work.title
    content.streamFormat = "mp4"
    if data.mode = "hls" then content.streamFormat = "hls"
    content.httpHeaders = contentHeadersForUrl(content.url)
    content.httpCertificatesFile = "common:/certs/ca-bundle.crt"
    m.playbackSessionId = data.session_id
    m.playbackEnded = false
    m.lastVideoState = ""
    m.bufferedSeconds = 0
    m.playerBufferedFill.width = 0
    hideEndScreen()
    m.video.content = content
    m.video.visible = true
    ' NOT m.video.SetFocus(true): a focused Video node swallows remote
    ' keypresses natively before Scene-level onKeyEvent ever sees them --
    ' same axis-ownership pattern already hit twice this session with
    ' RowList (Left/Right) and LabelList (Up/Down). Confirmed live: once the
    ' Video held focus, the custom control bar's initial 3s auto-hide window
    ' (armed below) elapsed and never reappeared no matter what was pressed,
    ' because resetPlayerAutoHide() lives entirely inside onKeyEvent's
    ' "state = playback" branch above, which requires the SCENE to hold
    ' focus. Every control this app needs (OK/play, seek, rewind/ffwd, back)
    ' is already implemented there by driving m.video.control/content
    ' directly, none of it needs the Video node itself focused -- enableUI is
    ' already false, so there is no native trick-play chrome relying on it.
    m.top.SetFocus(true)
    m.video.control = "play"
    ' Chapters rail (see onDetailChapterSelected): starts this same
    ' request-a-session-then-seek path "Play" already uses, just with a
    ' non-zero starting position queued up first.
    if m.pendingChapterSeekMs <> invalid
        m.video.seek = m.pendingChapterSeekMs / 1000
        m.pendingChapterSeekMs = invalid
    end if
    m.heartbeatTimer.control = "start"
    m.top.screenState = "playback"

    ' Phase 5 custom control bar: start the seek-bar repaint timer, paint an
    ' initial frame, and show+arm the auto-hide countdown (matching
    ' tv-web's AUTO_HIDE_MS "show on activity, hide after 3s idle" bar).
    m.playerPlayPauseLabel.text = "Pause"
    renderPlayerEpisodeNav()
    updatePlayerProgress()
    m.controlBarProgressTimer.control = "start"
    resetPlayerAutoHide()

    sendPlaybackEvent({ kind: "start" })
end sub

sub onVideoStateChanged()
    state = m.video.state
    if m.playbackEnded then return
    positionMs = Int(m.video.position * 1000)
    if state = "paused" and m.lastVideoState <> "paused"
        sendPlaybackEvent({ kind: "pause", position_ms: positionMs })
    else if state = "playing" and m.lastVideoState = "paused"
        sendPlaybackEvent({ kind: "resume", position_ms: positionMs })
    else if state = "finished"
        showEndOfPlayback()
    else if state = "error"
        sendPlaybackEvent({ kind: "error", message: "Roku video playback failed" })
        finishPlayback("error")
    end if
    if state = "paused"
        m.playerPlayPauseLabel.text = "Play"
    else if state = "playing"
        m.playerPlayPauseLabel.text = "Pause"
    end if
    m.lastVideoState = state
end sub

' ---------------------------------------------------------------------------
' Custom playback control bar (phase 5)
'
' Roku's native Video enableUI trick-play chrome is a completely different
' visual design from tv-web's custom transport bar, so enableUI="false" (see
' MainScene.xml) and this hand-drawn overlay replaces it: a seek bar (redrawn
' every controlBarProgressTimer tick), a Previous/Play-Pause/Next/time row,
' and a 3s auto-hide timer restarted on every playback key press, mirroring
' tv-web's AUTO_HIDE_MS behaviour. All key handling lives in onKeyEvent's
' `state = "playback"` branch below.
'
' Deliberately NOT attempted this phase (would need additional server-side
' track-list negotiation, e.g. a playbackCapabilities-style response, that is
' out of scope here): volume/mute (Roku remotes already handle system volume
' natively), audio-track switching, subtitle-track switching, quality-tier
' switching, the playlist panel, and fullscreen toggle (Roku video is always
' fullscreen).
' ---------------------------------------------------------------------------

sub togglePlayPause()
    if m.video.state = "paused"
        m.video.control = "play"
    else
        m.video.control = "pause"
    end if
end sub

' +/-10s seek, clamped to [0, duration]. Roku's Video node exposes seeking as
' a write-only `seek` field (seconds); there is no native seek-bar node to
' delegate to since enableUI is off.
sub seekPlayback(deltaSeconds as Integer)
    duration = m.video.duration
    target = m.video.position + deltaSeconds
    if target < 0 then target = 0
    if duration <> invalid and duration > 0 and target > duration then target = duration
    m.video.seek = target
    updatePlayerProgress()
end sub

' Tracks how far ahead of playback the stream has actually downloaded, from
' the Video node's real (documented) downloadedSegment field -- fired once
' per HLS/DASH segment as it finishes downloading, with SegStart (seconds)
' and SegDuration (milliseconds). Video/mux segments only (SegType 0 or 2):
' audio/caption segments (1/3) download on their own schedule and would
' otherwise make the bar visually jump around independent of video buffer.
' Segments can complete out of order (parallel fetches, retries), so this
' only ever advances, never regresses.
sub onDownloadedSegment()
    seg = m.video.downloadedSegment
    if seg = invalid or seg.Status <> 0 then return
    if seg.SegType <> 0 and seg.SegType <> 2 then return
    ' Confirmed live: some segments (container/init segments with no real
    ' timeline position yet) report SegType 0/2 but a genuinely Invalid
    ' SegStart/SegDuration, not just a 0 value -- "Type Mismatch: + can't
    ' be applied to Invalid and Float" crashed real playback the first
    ' time this ever actually ran this session.
    if seg.SegStart = invalid or seg.SegDuration = invalid then return
    segEnd = seg.SegStart + (seg.SegDuration / 1000)
    if segEnd > m.bufferedSeconds then m.bufferedSeconds = segEnd
end sub

' Repaints the seek-bar fill and the elapsed/duration label from the video's
' current position/duration. Runs on controlBarProgressTimer's 500ms tick
' while the control bar is visible; skipped while hidden since there is
' nothing on screen to repaint.
sub updatePlayerProgress()
    if not m.playerControls.visible then return
    duration = m.video.duration
    position = m.video.position
    fraction = 0
    bufferedFraction = 0
    if duration <> invalid and duration > 0
        fraction = position / duration
        if fraction < 0 then fraction = 0
        if fraction > 1 then fraction = 1
        bufferedFraction = m.bufferedSeconds / duration
        if bufferedFraction < fraction then bufferedFraction = fraction
        if bufferedFraction > 1 then bufferedFraction = 1
    end if
    m.playerProgressFill.width = m.playerProgressTrack.width * fraction
    m.playerBufferedFill.width = m.playerProgressTrack.width * bufferedFraction
    m.playerTimeLabel.text = formatPlaybackTime(position) + " / " + formatPlaybackTime(duration)
end sub

' Formats a duration in seconds as "M:SS" or, once an hour is reached,
' "H:MM:SS" -- there is no existing time-formatting helper elsewhere in this
' codebase to reuse.
function formatPlaybackTime(totalSeconds as Dynamic) as String
    if totalSeconds = invalid or totalSeconds < 0 then totalSeconds = 0
    total = Int(totalSeconds)
    hours = total \ 3600
    minutes = (total mod 3600) \ 60
    seconds = total mod 60
    secondsStr = seconds.ToStr()
    if seconds < 10 then secondsStr = "0" + secondsStr
    if hours > 0
        minutesStr = minutes.ToStr()
        if minutes < 10 then minutesStr = "0" + minutesStr
        return hours.ToStr() + ":" + minutesStr + ":" + secondsStr
    end if
    return minutes.ToStr() + ":" + secondsStr
end function

' "movie" -> "Movie" (from: the detail page's own meta line, e.g. "Movie
' 1h 48m 2003 ..."). A separate copy from PosterCard.brs's identical
' function: components have no shared-include mechanism for a plain
' function like this on this platform.
function CapitalizeFirst(value as Dynamic) as String
    if value = invalid or value = "" then return ""
    return UCase(Left(value, 1)) + Right(value, Len(value) - 1)
end function

' "1h 48m" / "48m" (from: the detail page's own meta line). Roku's
' WorkDetailSchema carries runtime_ms (milliseconds), the source real
' tv-web formats down to whole minutes for display, this only ever needs
' hours+minutes precision to match.
function formatRuntime(runtimeMs as Dynamic) as String
    if runtimeMs = invalid or runtimeMs <= 0 then return ""
    totalMinutes = Int(runtimeMs / 60000)
    hours = totalMinutes \ 60
    minutes = totalMinutes mod 60
    if hours > 0 then return hours.ToStr() + "h " + minutes.ToStr() + "m"
    return minutes.ToStr() + "m"
end function

' Shows the control bar and (re)arms the 3s auto-hide countdown. Called on
' every playback-state key press (see onKeyEvent), matching tv-web's
' "any activity shows the bar and resets the idle timer" behaviour.
' playerAutoHideTimer is repeat="false", so it is explicitly stopped then
' started to restart its countdown from zero even if it is already running.
sub resetPlayerAutoHide()
    m.playerControls.visible = true
    m.playerAutoHideTimer.control = "stop"
    m.playerAutoHideTimer.control = "start"
    updatePlayerProgress()
end sub

sub hidePlayerControls()
    m.playerControls.visible = false
end sub

' Dims Previous/Next when there is no adjacent episode to jump to: either
' this playback session didn't start from an episode selection at all (a
' movie -- m.playbackEpisodeList is empty, see onDetailActionSelected), or
' the current episode is the first/last one in m.playbackEpisodeList.
sub renderPlayerEpisodeNav()
    hasPrev = m.playbackEpisodeList.Count() > 0 and m.playbackEpisodeIndex > 0
    hasNext = m.playbackEpisodeList.Count() > 0 and m.playbackEpisodeIndex < m.playbackEpisodeList.Count() - 1
    if hasPrev
        m.playerPreviousLabel.color = &hA9B7C9FF
    else
        m.playerPreviousLabel.color = &h5C6B80FF
    end if
    if hasNext
        m.playerNextLabel.color = &hA9B7C9FF
    else
        m.playerNextLabel.color = &h5C6B80FF
    end if
end sub

' Jumps to the adjacent episode's own media_file_id via the normal
' requestPlayback() negotiation path (same one movie Play / episode-select
' use), reusing m.playbackEpisodeList built by onDetailEpisodeSelected. A
' documented no-op -- not a silent dead button -- when there is nothing to
' jump to (see renderPlayerEpisodeNav for the dimmed-affordance half of this).
sub playAdjacentEpisode(delta as Integer)
    if m.playbackEpisodeList.Count() = 0 then return
    newIndex = m.playbackEpisodeIndex + delta
    if newIndex < 0 or newIndex >= m.playbackEpisodeList.Count() then return
    epDetail = m.playbackEpisodeList[newIndex]
    mediaFileId = epDetail.media_file_id
    if mediaFileId = invalid or mediaFileId = "" then return
    m.playbackEpisodeIndex = newIndex
    requestPlayback(mediaFileId)
end sub

sub sendHeartbeat()
    if m.top.screenState <> "playback" or m.playbackEnded then return
    sendPlaybackEvent({ kind: "heartbeat", position_ms: Int(m.video.position * 1000) })
end sub

sub sendPlaybackEvent(body as Object)
    if m.playbackSessionId = "" then return
    if m.requestBusy
        m.queuedPlaybackEvent = body
        return
    end if
    sendApi("playbackEvent", "POST", "/api/v1/playback/sessions/" + UrlEncode(m.playbackSessionId) + "/events", body, true)
end sub

sub finishPlayback(reason as String)
    if m.playbackEnded then return
    m.playbackEnded = true
    m.heartbeatTimer.control = "stop"
    sendPlaybackEvent({ kind: "stop", position_ms: Int(m.video.position * 1000), reason: reason })
    m.video.control = "stop"
    m.video.visible = false
    m.controlBarProgressTimer.control = "stop"
    m.playerAutoHideTimer.control = "stop"
    m.top.screenState = "detail"
    showOnly("detail")
    m.detailActions.SetFocus(true)
end sub

' ---------------------------------------------------------------------------
' End-of-playback screen (docs/architecture/end-of-playback.md)
'
' Reached from the Video node's "finished" state. Mirrors the spec's states:
'   - next item exists (m.playbackEpisodeList, next episode): "Up next"
'     10 s countdown with Play now / Cancel / Replay / Back to details
'   - album/track queue: the next track starts immediately, no card
'   - nothing follows (or Cancel pressed): ended card, Replay / Back to details
' Both cards show a "More like this" row from /api/v1/catalog/{id}/similar.
' Only explicit actions stop the countdown; moving focus does not. Roku has
' no autoplay-next preference, so autoplay behaves as on.
' ---------------------------------------------------------------------------

function nextPlaybackItem() as Dynamic
    if m.playbackEpisodeList.Count() = 0 then return invalid
    idx = m.playbackEpisodeIndex + 1
    if idx < 0 or idx >= m.playbackEpisodeList.Count() then return invalid
    item = m.playbackEpisodeList[idx]
    if item.media_file_id = invalid or item.media_file_id = "" then return invalid
    return item
end function

' Title and "S1:E2" code of the playback-list entry at flatIndex, found by
' walking m.detailSeasons (the flat list drops the season number).
function playbackItemInfo(flatIndex as Integer) as Object
    info = { title: "", code: "" }
    n = 0
    for each group in m.detailSeasons
        for each leaf in groupLeaves(group, m.detailGroupKind)
            if n = flatIndex
                if m.detailGroupKind = "artist"
                    if leaf.track <> invalid and leaf.track.title <> invalid then info.title = leaf.track.title
                else
                    if leaf.episode <> invalid
                        if leaf.episode.title <> invalid then info.title = leaf.episode.title
                        if group.season <> invalid and group.season.season_number <> invalid and leaf.episode.episode_number <> invalid
                            info.code = "S" + group.season.season_number.ToStr() + ":E" + leaf.episode.episode_number.ToStr()
                        end if
                    end if
                end if
                return info
            end if
            n += 1
        end for
    end for
    return info
end function

function endWorkTitle() as String
    if m.selectedDetail <> invalid and m.selectedDetail.work <> invalid and m.selectedDetail.work.title <> invalid
        return m.selectedDetail.work.title
    end if
    return ""
end function

sub showEndOfPlayback()
    if m.playbackEnded then return
    m.playbackEnded = true
    m.heartbeatTimer.control = "stop"
    ' Progress/watched is reported before any card appears (spec section 2).
    sendPlaybackEvent({ kind: "stop", position_ms: Int(m.video.position * 1000), reason: "completed" })
    m.video.control = "stop"
    m.video.visible = false
    m.controlBarProgressTimer.control = "stop"
    m.playerAutoHideTimer.control = "stop"
    m.playerControls.visible = false
    ' Music queue: chain straight into the next track with no card.
    if m.detailGroupKind = "artist" and nextPlaybackItem() <> invalid
        playAdjacentEpisode(1)
        return
    end if
    m.endSuggestionWorks = []
    m.endSuggestions.visible = false
    m.endScreen.visible = true
    m.top.screenState = "endscreen"
    if nextPlaybackItem() <> invalid
        startEndCountdown()
    else
        showEndCard()
    end if
    if m.selectedDetail <> invalid and m.selectedDetail.work <> invalid and m.selectedDetail.work.id <> invalid
        sendApi("endSimilar", "GET", "/api/v1/catalog/" + UrlEncode(m.selectedDetail.work.id) + "/similar?limit=12", invalid, true)
    end if
end sub

sub startEndCountdown()
    nextInfo = playbackItemInfo(m.playbackEpisodeIndex + 1)
    m.endCountdown = 10
    m.endHeading.text = "Up next"
    m.endTitle.text = nextInfo.title
    subtitle = endWorkTitle()
    if nextInfo.code <> "" then subtitle += "  " + nextInfo.code
    m.endMessage.text = subtitle
    m.endActions = [{ id: "playNow", text: "Play now" }, { id: "cancel", text: "Cancel" }, { id: "replay", text: "Replay" }, { id: "exit", text: "Back to details" }]
    paintEndCountdown()
    m.endCountdownTimer.control = "start"
    focusEndButton(0)
end sub

sub paintEndCountdown()
    m.endCountdownLabel.text = "Playing in " + m.endCountdown.ToStr()
end sub

sub onEndCountdownTick()
    if m.top.screenState <> "endscreen" or m.endCountdown <= 0 then return
    m.endCountdown -= 1
    if m.endCountdown <= 0
        m.endCountdownTimer.control = "stop"
        playNextFromEnd()
    else
        paintEndCountdown()
    end if
end sub

' Ended card for the item that just finished (also the sticky result of
' Cancel: the countdown never restarts without a new playback).
sub showEndCard()
    info = playbackItemInfo(m.playbackEpisodeIndex)
    m.endCountdown = 0
    m.endCountdownTimer.control = "stop"
    m.endCountdownLabel.text = ""
    m.endHeading.text = "Finished"
    if info.title <> ""
        m.endTitle.text = info.title
        subtitle = endWorkTitle()
        if info.code <> "" then subtitle += "  " + info.code
        m.endMessage.text = subtitle
    else
        m.endTitle.text = endWorkTitle()
        m.endMessage.text = ""
    end if
    m.endActions = [{ id: "replay", text: "Replay" }, { id: "exit", text: "Back to details" }]
    focusEndButton(0)
end sub

sub focusEndButton(index as Integer)
    if index >= m.endActions.Count() then index = m.endActions.Count() - 1
    if index < 0 then index = 0
    m.endFocusIndex = index
    for i = 0 to m.endButtons.Count() - 1
        b = m.endButtons[i]
        if i < m.endActions.Count()
            b.bg.visible = true
            b.label.visible = true
            b.label.text = m.endActions[i].text
            if i = index
                b.bg.color = &hCF3157FF
            else
                b.bg.color = &h2A262CFF
            end if
        else
            b.bg.visible = false
            b.label.visible = false
        end if
    end for
    m.top.SetFocus(true)
end sub

sub playNextFromEnd()
    hideEndScreen()
    playAdjacentEpisode(1)
end sub

sub hideEndScreen()
    m.endCountdownTimer.control = "stop"
    m.endCountdown = 0
    m.endScreen.visible = false
    m.endSuggestions.visible = false
end sub

' Back to details of the finished work (also hardware Back).
sub exitEndScreen()
    hideEndScreen()
    m.top.screenState = "detail"
    showOnly("detail")
    m.detailActions.SetFocus(true)
end sub

sub activateEndAction()
    if m.endFocusIndex >= m.endActions.Count() then return
    id = m.endActions[m.endFocusIndex].id
    if id = "playNow"
        playNextFromEnd()
    else if id = "cancel"
        showEndCard()
    else if id = "replay"
        ' The ended session is already closed as completed server-side, so
        ' Replay negotiates a brand new playback session (requestPlayback ->
        ' startPlayback stores the new session id) instead of seeking to 0.
        hideEndScreen()
        requestPlayback(m.currentMediaFileId)
    else
        exitEndScreen()
    end if
end sub

sub acceptEndSuggestions(data as Object)
    if m.top.screenState <> "endscreen" or m.selectedDetail = invalid then return
    workId = m.selectedDetail.work.id
    visible = []
    for each candidate in itemsFromCatalog(data)
        if candidate.id <> workId and (candidate.kind = "movie" or isEpisodicKind(candidate.kind))
            visible.Push(candidate)
            if visible.Count() >= 12 then exit for
        end if
    end for
    m.endSuggestionWorks = visible
    if visible.Count() = 0 then return
    buildRailContent(m.endSuggestions, visible, false, 1.5)
    row = m.endSuggestions.content.GetChild(0)
    if row <> invalid then row.title = "More like this"
    m.endSuggestions.visible = true
end sub

sub onEndSuggestionSelected(event as Object)
    position = event.GetData()
    if position = invalid or position.Count() < 2 then return
    idx = position[1]
    if idx < 0 or idx >= m.endSuggestionWorks.Count() then return
    work = m.endSuggestionWorks[idx]
    hideEndScreen()
    openWorkDetail(work, m.detailOrigin)
end sub

function onEndScreenKey(key as String) as Boolean
    onSuggestions = m.endSuggestions.visible and m.endSuggestions.isInFocusChain()
    if key = "back"
        exitEndScreen()
        return true
    else if onSuggestions
        if key = "up"
            focusEndButton(m.endFocusIndex)
            return true
        end if
        return false
    else if key = "left"
        focusEndButton(m.endFocusIndex - 1)
        return true
    else if key = "right"
        focusEndButton(m.endFocusIndex + 1)
        return true
    else if key = "down"
        if m.endSuggestions.visible then m.endSuggestions.SetFocus(true)
        return true
    else if key = "OK" or key = "play"
        activateEndAction()
        return true
    end if
    return true
end function

sub setListContent(list as Object, labels as Object)
    content = CreateObject("roSGNode", "ContentNode")
    for each label in labels
        child = content.CreateChild("ContentNode")
        child.title = label
    end for
    list.content = content
end sub

function joinStrings(values as Object, separator as String) as String
    result = ""
    for each value in values
        if result <> "" then result += separator
        result += value
    end for
    return result
end function

sub showStatus(title as String, message as String, busy as Boolean)
    m.statusTitle.text = title
    m.statusMessage.text = message
    if busy
        m.spinner.control = "start"
    else
        m.spinner.control = "stop"
    end if
    showOnly("status")
    m.top.screenState = "status"
    m.top.SetFocus(true)
end sub

sub showOnly(name as String)
    ' tv-web Profiles is a full-canvas picker with no left nav dock / clock chrome.
    ' Hide the signed-in shell on pre-auth and profiles so those screens match web.
    m.persistentHeader.visible = name <> "status" and name <> "pairing" and name <> "profiles"
    m.statusGroup.visible = name = "status"
    m.pairingGroup.visible = name = "pairing"
    m.profilesGroup.visible = name = "profiles"
    m.settingsGroup.visible = name = "settings"
    m.libraryGroup.visible = name = "library"
    m.homeGroup.visible = name = "home"
    m.browseGroup.visible = name = "browse"
    m.searchGroup.visible = name = "search"
    m.playlistsGroup.visible = name = "playlists"
    m.detailGroup.visible = name = "detail"
    m.navDockMode = false
    renderNavDockFocus()
    m.searchFilterMode = false
    ' Never paint residual freezes over native SceneGraph (dual stacked UI).
    hideAllResiduals()
    if name <> "playback"
        m.video.visible = false
        m.playerControls.visible = false
        hideEndScreen()
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    state = m.top.screenState
    if state = "endscreen"
        return onEndScreenKey(key)
    else if state = "playback"
        ' Custom control-bar key handling (phase 5) -- see the "Custom
        ' playback control bar" section above. Every branch besides "back"
        ' both performs its action and re-shows/resets the 3s auto-hide
        ' timer, matching tv-web's "any key press during playback surfaces
        ' the bar" behaviour. Up/Down are intentionally non-destructive
        ' no-ops (still re-arm the auto-hide timer) rather than falling
        ' through unhandled.
        if key = "back"
            finishPlayback("user_stopped")
            return true
        else if key = "OK" or key = "play"
            togglePlayPause()
            resetPlayerAutoHide()
            return true
        else if key = "left"
            seekPlayback(-10)
            resetPlayerAutoHide()
            return true
        else if key = "right"
            seekPlayback(10)
            resetPlayerAutoHide()
            return true
        else if key = "rewind"
            playAdjacentEpisode(-1)
            resetPlayerAutoHide()
            return true
        else if key = "fastforward"
            playAdjacentEpisode(1)
            resetPlayerAutoHide()
            return true
        else if key = "up" or key = "down"
            resetPlayerAutoHide()
            return true
        end if
        return false
    else if state = "detail" and key = "down"
        return moveDetailFocus(1)
    else if state = "detail" and key = "up"
        return moveDetailFocus(-1)
    else if state = "detail" and key = "back"
        if m.detailOrigin = "library"
            showOnly("library")
            m.top.screenState = "library"
            m.library.SetFocus(true)
        else if m.detailOrigin = "browse"
            showOnly("browse")
            m.top.screenState = "browse"
            m.browseGrid.SetFocus(true)
        else if m.detailOrigin = "search"
            showOnly("search")
            m.top.screenState = "search"
            m.searchGrid.SetFocus(true)
        else if m.detailOrigin = "playlists"
            showOnly("playlists")
            m.top.screenState = "playlists"
            m.playlistItemsGrid.SetFocus(true)
        else
            showOnly("home")
            m.top.screenState = "home"
            focusCurrentHomeRail()
            ' focusCurrentHomeRail() only calls SetFocus(true) on the rail --
            ' the item it lands on was already logically focused before we
            ' navigated away, so RowList never re-fires itemFocused, and
            ' Home's hero (title/kicker/meta/key-art) is left stuck showing
            ' whatever the detail screen displayed instead of reverting.
            ' Confirmed live: opening a rail item's detail then pressing Back
            ' left Home's hero frozen on the just-closed detail's title.
            ' m.selectedWork is exactly the work Detail was just showing, and
            ' since focus didn't move, it's still the correct hero to show.
            updateHeroFromWork(m.selectedWork)
        end if
        return true
    else if state = "library" and key = "back"
        loadProfiles()
        return true
    else if state = "browse" and m.browseFiltersMode and key = "back"
        closeBrowseFiltersPanel()
        return true
    else if state = "browse" and m.browseFiltersMode and key = "up"
        return moveBrowseFiltersFocus(-1)
    else if state = "browse" and m.browseFiltersMode and key = "down"
        return moveBrowseFiltersFocus(1)
    else if state = "browse" and m.browseFiltersMode and key = "OK"
        selectBrowseFilterOption()
        return true
    else if state = "browse" and m.browseFiltersButtonFocused and key = "back"
        focusBrowseAlphabetFromButton()
        return true
    else if state = "browse" and m.browseFiltersButtonFocused and key = "down"
        focusBrowseAlphabetFromButton()
        return true
    else if state = "browse" and m.browseFiltersButtonFocused and key = "OK"
        openBrowseFiltersPanel()
        return true
    else if state = "browse" and m.browseAlphabetMode and key = "back"
        exitBrowseAlphabet()
        return true
    else if state = "browse" and m.browseAlphabetMode and m.browseAlphabetIndex = 0 and key = "up"
        focusBrowseFiltersButton()
        return true
    else if state = "browse" and m.browseAlphabetMode and key = "up"
        return moveBrowseAlphabetFocus(-1)
    else if state = "browse" and m.browseAlphabetMode and key = "down"
        return moveBrowseAlphabetFocus(1)
    else if state = "browse" and m.browseAlphabetMode and key = "OK"
        selectBrowseAlphabetLetter()
        return true
    else if state = "browse" and not m.browseAlphabetMode and not m.browseFiltersButtonFocused and key = "options"
        ' Right was the first choice here (spatially matches the real
        ' alphabet strip's fixed right-edge position), but confirmed live
        ' via a debug-console key trace that MarkupGrid swallows Right
        ' unconditionally, regardless of column, it never once reached
        ' this far. The "*"/Info remote button (BrightScript key string
        ' "options") isn't claimed by MarkupGrid at all, so it's used as
        ' this screen's secondary-action entry point instead, the same
        ' role this codebase's pairing screen already uses it for
        ' ("Press * to enter a server address").
        enterBrowseAlphabet()
        return true
    else if state = "browse" and key = "back"
        showOnly("home")
        m.top.screenState = "home"
        focusCurrentHomeRail()
        return true
    else if state = "search" and m.searchFilterMode and key = "left"
        return moveSearchFilterFocus(-1)
    else if state = "search" and m.searchFilterMode and key = "right"
        return moveSearchFilterFocus(1)
    else if state = "search" and m.searchFilterMode and key = "down"
        exitSearchFilters()
        return true
    else if state = "search" and m.searchFilterMode and key = "up"
        return true
    else if state = "search" and m.searchFilterMode and key = "OK"
        selectSearchFilter()
        return true
    else if state = "search" and key = "OK" and (m.searchDisplayItems = invalid or m.searchDisplayItems.Count() = 0)
        ' Empty search shell: OK opens the keyboard (web focuses the field).
        openSearchDialog()
        return true
    else if state = "search" and key = "up"
        enterSearchFilters()
        return true
    else if state = "search" and key = "back"
        showOnly("home")
        m.top.screenState = "home"
        focusCurrentHomeRail()
        return true
    else if state = "playlists" and key = "back"
        ' Mirrors browse/search's "Back returns to Home" above, except this
        ' one screenState covers two sub-views (see MainScene.xml's
        ' playlistsGroup comment): Back from the item detail sub-view
        ' returns to the directory grid first; only Back from the directory
        ' grid itself (no playlist open) returns to Home.
        if m.playlistDetailOpen
            m.playlistDetailOpen = false
            m.playlistDetailGroup.visible = false
            m.playlistsDirectoryGroup.visible = true
            m.playlistsGrid.SetFocus(true)
        else
            showOnly("home")
            m.top.screenState = "home"
            focusCurrentHomeRail()
        end if
        return true
    else if state = "home" and key = "back"
        loadProfiles()
        return true
    else if state = "home" and m.navDockMode and key = "up"
        return moveNavDockFocus(-1)
    else if state = "home" and m.navDockMode and key = "down"
        return moveNavDockFocus(1)
    else if state = "home" and m.navDockMode and key = "right"
        exitNavDock()
        return true
    else if state = "home" and m.navDockMode and key = "left"
        return true
    else if state = "home" and m.navDockMode and key = "OK"
        selectNavDockItem()
        return true
    else if state = "home" and key = "left"
        ' homeLeftProxy (col 0) or Scene focus: Left enters nav dock (web parity).
        enterNavDock()
        return true
    else if state = "home" and key = "right" and m.homeLeftProxy <> invalid and m.homeLeftProxy.IsInFocusChain()
        ' From leftmost proxy, Right returns into the focused rail at col 0.
        focusCurrentHomeRail()
        return true
    else if state = "home" and key = "OK" and m.homeLeftProxy <> invalid and m.homeLeftProxy.IsInFocusChain()
        ' Select the leftmost card of the focused rail.
        if m.visibleRails.Count() > 0
            idx = m.homeFocusIndex
            if idx < 0 or idx >= m.visibleRails.Count() then idx = 0
            works = m.visibleRails[idx].works
            if works <> invalid and works.Count() > 0
                openWorkDetail(works[0], "home")
                return true
            end if
        end if
        return true
    else if state = "home" and key = "up"
        ' Up from top rail also enters dock (backup to Left / homeLeftProxy).
        if m.homeFocusIndex = 0
            enterNavDock()
            return true
        end if
        return moveHomeFocus(-1)
    else if state = "home" and key = "down"
        return moveHomeFocus(1)
    else if state = "pairing" and key = "OK"
        if m.pairingThemeHit <> invalid and m.pairingThemeHit.IsInFocusChain()
            openPairingThemePicker()
            return true
        else if m.pairingLangHit <> invalid and m.pairingLangHit.IsInFocusChain()
            openPairingLanguagePicker()
            return true
        else if m.pairingManualHit <> invalid and m.pairingManualHit.IsInFocusChain()
            m.hostedLinkTimer.control = "stop"
            m.pairingTimer.control = "stop"
            openServerDialog()
            return true
        else if m.pairingBackHit <> invalid and m.pairingBackHit.IsInFocusChain()
            returnFromPairingToProfiles()
            return true
        end if
    else if state = "pairing" and key = "back"
        ' Remote Back = chrome back → Who's watching (web LoginShell).
        returnFromPairingToProfiles()
        return true
    else if state = "pairing" and key = "right"
        if m.pairingBackHit <> invalid and m.pairingBackHit.IsInFocusChain()
            if m.pairingThemeHit <> invalid then m.pairingThemeHit.SetFocus(true)
            applyPairingChromeFocus()
            return true
        else if m.pairingThemeHit <> invalid and m.pairingThemeHit.IsInFocusChain()
            if m.pairingLangHit <> invalid then m.pairingLangHit.SetFocus(true)
            applyPairingChromeFocus()
            return true
        else if m.pairingLangHit <> invalid and m.pairingLangHit.IsInFocusChain()
            if m.pairingManualHit <> invalid then m.pairingManualHit.SetFocus(true)
            applyPairingChromeFocus()
            return true
        end if
    else if state = "pairing" and key = "left"
        if m.pairingManualHit <> invalid and m.pairingManualHit.IsInFocusChain()
            if m.pairingLangHit <> invalid then m.pairingLangHit.SetFocus(true)
            applyPairingChromeFocus()
            return true
        else if m.pairingLangHit <> invalid and m.pairingLangHit.IsInFocusChain()
            if m.pairingThemeHit <> invalid then m.pairingThemeHit.SetFocus(true)
            applyPairingChromeFocus()
            return true
        else if m.pairingThemeHit <> invalid and m.pairingThemeHit.IsInFocusChain()
            if m.pairingBackHit <> invalid
                m.pairingBackHit.SetFocus(true)
                applyPairingChromeFocus()
                return true
            end if
        end if
    else if state = "pairing" and key = "down"
        if m.pairingThemeHit <> invalid and m.pairingThemeHit.IsInFocusChain() or (m.pairingLangHit <> invalid and m.pairingLangHit.IsInFocusChain()) or (m.pairingBackHit <> invalid and m.pairingBackHit.IsInFocusChain())
            if m.pairingManualHit <> invalid then m.pairingManualHit.SetFocus(true)
            applyPairingChromeFocus()
            return true
        end if
    else if state = "pairing" and key = "up"
        if m.pairingManualHit <> invalid and m.pairingManualHit.IsInFocusChain()
            if m.pairingThemeHit <> invalid then m.pairingThemeHit.SetFocus(true)
            applyPairingChromeFocus()
            return true
        end if
    else if state = "pairing" and key = "options"
        m.hostedLinkTimer.control = "stop"
        m.pairingTimer.control = "stop"
        openServerDialog()
        return true
    else if state = "settings" and key = "back"
        showOnly("profiles")
        m.top.screenState = "profiles"
        m.profilesRow.SetFocus(true)
        return true
    else if state = "settings"
        if key = "right" and m.settingsSectionList.HasFocus()
            m.settingsActionList.SetFocus(true)
            return true
        else if key = "left" and m.settingsActionList.HasFocus()
            m.settingsSectionList.SetFocus(true)
            return true
        end if
    else if state = "profiles" and key = "OK"
        if m.profilesThemeHit <> invalid and m.profilesThemeHit.IsInFocusChain()
            openPairingThemePicker()
            return true
        else if m.profilesLangHit <> invalid and m.profilesLangHit.IsInFocusChain()
            openPairingLanguagePicker()
            return true
        else if m.profilesSettingsHit <> invalid and m.profilesSettingsHit.IsInFocusChain()
            openSettings()
            return true
        else if m.profilesSignOutHit <> invalid and m.profilesSignOutHit.IsInFocusChain()
            signOutFromProfiles()
            return true
        end if
    else if state = "profiles" and key = "right"
        if m.profilesThemeHit <> invalid and m.profilesThemeHit.IsInFocusChain()
            if m.profilesLangHit <> invalid then m.profilesLangHit.SetFocus(true)
            applyProfilesChromeFocus()
            return true
        else if m.profilesSettingsHit <> invalid and m.profilesSettingsHit.IsInFocusChain()
            if m.profilesSignOutHit <> invalid then m.profilesSignOutHit.SetFocus(true)
            applyProfilesChromeFocus()
            return true
        end if
    else if state = "profiles" and key = "left"
        if m.profilesLangHit <> invalid and m.profilesLangHit.IsInFocusChain()
            if m.profilesThemeHit <> invalid then m.profilesThemeHit.SetFocus(true)
            applyProfilesChromeFocus()
            return true
        else if m.profilesSignOutHit <> invalid and m.profilesSignOutHit.IsInFocusChain()
            if m.profilesSettingsHit <> invalid then m.profilesSettingsHit.SetFocus(true)
            applyProfilesChromeFocus()
            return true
        end if
    else if state = "profiles" and key = "down"
        if m.profilesThemeHit <> invalid and m.profilesThemeHit.IsInFocusChain() or (m.profilesLangHit <> invalid and m.profilesLangHit.IsInFocusChain())
            if m.profilesRow <> invalid then m.profilesRow.SetFocus(true)
            applyProfilesChromeFocus()
            return true
        else if m.profilesRow.HasFocus()
            if m.profileActionsGroup <> invalid and m.profileActionsGroup.visible
                if m.profilesSettingsHit <> invalid then m.profilesSettingsHit.SetFocus(true)
                applyProfilesChromeFocus()
                return true
            end if
        end if
    else if state = "profiles" and key = "up"
        if m.profilesSettingsHit <> invalid and m.profilesSettingsHit.IsInFocusChain() or (m.profilesSignOutHit <> invalid and m.profilesSignOutHit.IsInFocusChain())
            if m.profilesRow <> invalid then m.profilesRow.SetFocus(true)
            applyProfilesChromeFocus()
            return true
        else if m.profilesRow.HasFocus()
            if m.profilesThemeHit <> invalid then m.profilesThemeHit.SetFocus(true)
            applyProfilesChromeFocus()
            return true
        end if
    else if state = "status" and key = "OK" and not m.requestBusy
        if m.lastFailedAction = "detail" and m.selectedWork <> invalid
            sendApi("detail", "GET", "/api/v1/catalog/" + UrlEncode(m.selectedWork.id), invalid, true)
        else if m.lastFailedAction = "playback"
            requestPlayback(m.currentMediaFileId)
        else if m.lastFailedAction = "search"
            performSearch(m.searchQuery)
        else if m.lastFailedAction = "hostedLinkCode" or m.lastFailedAction = "hostedLinkPoll"
            beginHostedLink()
        else
            sendApi("version", "GET", "/api/system/version", invalid, false)
        end if
        return true
    end if
    return false
end function
