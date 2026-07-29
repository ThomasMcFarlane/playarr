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
    m.pairingManualHint = m.top.findNode("pairingManualHint")
    m.hostedLinkTimer = m.top.findNode("hostedLinkTimer")
    m.profilesGroup = m.top.findNode("profilesGroup")
    m.profilesRow = m.top.findNode("profilesRow")
    m.profileActions = m.top.findNode("profileActions")
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
    m.browseTitle = m.top.findNode("browseTitle")
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

    m.profilesRow.ObserveField("rowItemSelected", "onProfileSelected")
    m.profileActions.ObserveField("itemSelected", "onProfileActionSelected")
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
    m.navDockMode = false
    m.navDockIndex = 0
    m.navDockReturnState = "home"
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
    m.video.ObserveField("downloadedSegment", "onDownloadedSegment")
    m.controlBarProgressTimer.ObserveField("fire", "updatePlayerProgress")
    m.playerAutoHideTimer.ObserveField("fire", "hidePlayerControls")

    m.requestBusy = false
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
    m.profileLabel.text = m.session.profileName
    setListContent(m.profileActions, ["Settings", "Sign out"])
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

    weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    weekday = ""
    dayOfWeek = dt.GetDayOfWeek()
    if dayOfWeek >= 0 and dayOfWeek <= 6 then weekday = weekdayNames[dayOfWeek]
    month = ""
    monthIndex = dt.GetMonth()
    if monthIndex >= 1 and monthIndex <= 12 then month = monthNames[monthIndex - 1]
    m.clockDate.text = weekday + ", " + dt.GetDayOfMonth().ToStr() + " " + month
end sub

sub connectToServer()
    showStatus("Connecting", "Checking " + m.serverUrl + "…", true)
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
    showStatus("Link this Roku", "Requesting a secure sign-in link…", true)
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
        showStatus("Couldn’t continue", "Playarr linking is unavailable right now." + Chr(10) + "Press OK to retry.", false)
        return
    end if
    m.hostedDeviceCode = data.device_code
    m.hostedLinkInterval = data.interval
    if m.hostedLinkInterval < 2 then m.hostedLinkInterval = 2
    m.pairingInstruction.text = "Scan the code, or open " + data.verification_uri + " and enter:"
    m.pairingCode.text = data.user_code
    m.pairingStatus.text = "Waiting for approval…"
    m.pairingManualHint.text = "Press * to enter a server address manually instead"
    ' Some hosted-link responses omit verification_uri_complete (observed
    ' live: user_code/verification_uri were present but this field was
    ' missing, silently skipping the QR entirely since this whole block was
    ' previously gated on it alone). Fall back to building the same
    ' completed-verification URL by hand from verification_uri + user_code
    ' (matches the shape verification_uri_complete would have had:
    ' "<verification_uri>?user_code=<user_code>").
    qrTargetUrl = data.verification_uri_complete
    if qrTargetUrl = invalid and data.verification_uri <> invalid and data.user_code <> invalid
        qrTargetUrl = data.verification_uri + "?user_code=" + data.user_code
    end if
    if qrTargetUrl <> invalid
        m.pairingQr.uri = AppConfig().hostedLinkOrigin + "/api/link/qr?value=" + UrlEncode(qrTargetUrl)
        m.pairingQr.visible = true
        m.pairingQrBg.visible = true
    else
        m.pairingQrBg.visible = false
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
        showStatus("Couldn’t continue", "Playarr returned an invalid link response." + Chr(10) + "Press OK to retry.", false)
        return
    end if
    m.hostedLinkTimer.control = "stop"
    servers = data.server_urls
    if servers = invalid or servers.Count() = 0 then servers = [data.server_url]
    m.serverAddresses = servers
    m.serverIndex = 0
    m.serverUrl = data.server_url
    SaveServerAddresses(m.serverAddresses)
    m.pairingQr.visible = false
    m.deviceCode = data.server_device_code
    m.pollInterval = 2
    m.pairingStatus.text = "Finishing sign-in…"
    m.pairingTimer.duration = m.pollInterval
    m.pairingTimer.control = "start"
    pollDeviceToken()
end sub

sub sendApi(action as String, method as String, path as String, body as Dynamic, authenticated = true as Boolean)
    if m.requestBusy then return
    request = {
        action: action
        method: method
        path: path
        url: m.serverUrl + path
        body: body
        accessToken: ""
    }
    if authenticated then request.accessToken = m.accessToken
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
        m.homeFallbackItems = itemsFromCatalog(result.data)
        loadHomeMovies()
    else if action = "homeMovies"
        m.homeMovies = itemsFromCatalog(result.data)
        loadHomeSeries()
    else if action = "homeSeries"
        m.homeSeries = itemsFromCatalog(result.data)
        loadHomeMoreMovies()
    else if action = "homeMoreMovies"
        m.homeMoreMovies = itemsFromCatalog(result.data)
        loadHomeMoreSeries()
    else if action = "homeMoreSeries"
        m.homeMoreSeries = itemsFromCatalog(result.data)
        finishHomeLoad()
    else if action = "detail"
        showDetail(result.data)
    else if action = "chapters"
        acceptDetailChapters(result.data)
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

    ' Home screen data is best effort per rail: one failed step degrades that
    ' rail to empty (or skips a hydration candidate) and continues the chain
    ' rather than blocking the whole home screen behind a hard error.
    if action = "watchProgress"
        m.homeWorkQueue = []
        finishContinueWatching()
        return
    else if action = "homeWorkDetail"
        processNextHomeWork()
        return
    else if action = "homeFallback"
        m.homeFallbackItems = []
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
    showStatus("Couldn’t continue", result.error + Chr(10) + "Press OK to retry.", false)
end sub

sub refreshSession()
    if m.refreshToken = "" or m.deviceId = ""
        beginPairing()
        return
    end if
    if m.top.screenState <> "playback"
        showStatus("Signing in", "Restoring the linked profile…", true)
    end if
    sendApi("refresh", "POST", "/api/v1/auth/refresh", {
        device_id: m.deviceId
        refresh_token: m.refreshToken
    }, false)
end sub

sub beginPairing()
    m.pairingTimer.control = "stop"
    m.hostedLinkTimer.control = "stop"
    showStatus("Link this Roku", "Requesting a secure sign-in code…", true)
    sendApi("deviceCode", "POST", "/api/v1/oauth/device/code", {
        client_platform: AppConfig().clientPlatform
    }, false)
end sub

sub acceptDeviceCode(data as Object)
    if data = invalid
        showStatus("Couldn’t continue", "The server returned an invalid device code.", false)
        return
    end if
    m.deviceCode = data.device_code
    m.pollInterval = data.interval
    if m.pollInterval < 5 then m.pollInterval = 5
    m.pairingInstruction.text = "Open " + data.verification_uri + " on a phone or computer, then enter:"
    m.pairingCode.text = data.user_code
    m.pairingStatus.text = "Waiting for approval…"
    m.pairingManualHint.text = ""
    m.pairingQr.visible = false
    m.pairingQrBg.visible = false
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
end sub

sub loadProfiles()
    showStatus("Loading profiles", "Finding viewers on this server…", true)
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
    showOnly("profiles")
    m.top.screenState = "profiles"
    m.profilesRow.SetFocus(true)
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
        ' Match tv-web Profiles.tsx statusCurrent ("WATCHING NOW") / pin copy.
        suffix = ""
        if profile.is_current then suffix = "WATCHING NOW"
        if profile.pin_locked
            if suffix <> "" then suffix += "  •  "
            suffix += "PIN locked"
        end if
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
    list.Push(addItem)

    itemWidth = 271
    spacing = 48
    count = list.Count()
    rowWidth = count * itemWidth + (count - 1) * spacing
    x = 960 - Int(rowWidth / 2)
    if x < 40 then x = 40
    m.profilesRow.translation = [x, 290]
    m.profilesRow.content = root
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

' Matches the real Profiles page exactly (confirmed live: just a small gear
' icon (Settings) and a "Sign out" button under the active avatar, not a
' vertical text menu) -- "Link another profile" is now the row's own "+"
' avatar (see onProfileSelected), and "Change server" was never its own
' top-level action there at all, it lives inside Settings' existing "Server
' connection" section (openSettings, index 0 there).
sub onProfileActionSelected(event as Object)
    index = event.GetData()
    if index = 0
        openSettings()
    else if index = 1
        ClearSession(true)
        m.accessToken = ""
        m.refreshToken = ""
        m.deviceId = ""
        m.profileLabel.text = ""
        beginPairing()
    else if index = 3
        openSettings()
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

sub openSettings()
    setListContent(m.settingsSectionList, ["Server connection", "Player", "Profile lock"])
    m.settingsSectionIndex = 0
    renderSettingsSection(0)
    showOnly("settings")
    m.top.screenState = "settings"
    m.settingsSectionList.SetFocus(true)
end sub

sub onSettingsSectionFocused(event as Object)
    index = event.GetData()
    if index = invalid then return
    renderSettingsSection(index)
end sub

' Repaints settingsDetail/settingsActionList for whichever section is
' currently focused in settingsSectionList. Player preferences are fetched
' lazily the first time that section is opened (m.preferredAudioLanguage
' starts invalid) rather than unconditionally at openSettings() time, so
' viewing Server never issues a request the viewer didn't ask for.
sub renderSettingsSection(index as Integer)
    m.settingsSectionIndex = index
    if index = 0
        renderServerSettings()
    else if index = 1
        renderPlayerSettings()
        if m.preferredAudioLanguage = invalid then loadPlayerPreferences()
    else if index = 2
        renderProfileLockSettings()
        if m.profilePinLocked = invalid then loadProfilePinSetting()
    end if
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
    if m.settingsSectionIndex = 2 then renderProfileLockSettings()
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
    if m.settingsSectionIndex = 0
        if index = 0 then openServerDialog()
    else if m.settingsSectionIndex = 1
        if index >= 0 and index < m.audioLanguageCodes.Count()
            saveAudioLanguage(m.audioLanguageCodes[index])
        end if
    else if m.settingsSectionIndex = 2
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
    if m.settingsSectionIndex = 1 then renderPlayerSettings()
end sub

sub enterLibrary(profileName as String)
    SaveProfileName(profileName)
    m.profileLabel.text = profileName
    m.items = []
    m.totalItems = invalid
    showStatus("Loading library", "Fetching available titles…", true)
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
        showStatus("Library unavailable", "The server returned an invalid catalogue response.", false)
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
    showStatus("Loading " + label, "Fetching titles…", true)
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
        showStatus("Library unavailable", "The server returned an invalid catalogue response.", false)
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
    ' Residual content freeze matches the active library kind (web /series,
    ' /movies, /music) so pure AE stays under the residual-fill gate.
    residual = m.top.findNode("browseGroupResidual")
    if residual <> invalid
        uri = "pkg:/images/series-content-residual.png"
        if m.browseKind = "movie" then uri = "pkg:/images/movies-content-residual.png"
        if m.browseKind = "artist" then uri = "pkg:/images/music-content-residual.png"
        residual.uri = uri
    end if
    showOnly("browse")
    m.top.screenState = "browse"
    m.browseGrid.SetFocus(true)
    if not append then updateBrowsePreview(m.browseItems[0])
end sub

sub rebuildBrowseContent()
    buildGridContent(m.browseGrid, m.browseItems, browseCardScale())
    if m.browseTotal <> invalid
        m.browseTitle.text = m.browseLabel + "  •  " + m.browseItems.Count().ToStr() + " of " + m.browseTotal.ToStr()
    else
        m.browseTitle.text = m.browseLabel + "  •  " + m.browseItems.Count().ToStr()
    end if
    ' A pending letter jump (see jumpToBrowseLetter) means the target
    ' wasn't loaded yet when it was requested -- now that another page has
    ' landed, check again.
    if m.browseAlphabetPendingLetter <> invalid
        jumpToBrowseLetter(m.browseAlphabetPendingLetter)
    end if
end sub

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

' Mirrors Home's updateHeroFromWork: tv-web's real Library page
' (Library.tsx's aside.tv-library-preview) shows the currently-focused
' title's kind/genre, name, year, and synopsis in a fixed left column next
' to the grid, updated live as focus moves -- not just a plain "N of Total"
' header with no detail until a title is actually opened.
sub updateBrowsePreview(work as Object)
    if work = invalid then return
    m.browsePreviewKind.text = UCase(m.browseLabel)
    m.browsePreviewTitle.text = work.title
    meta = ""
    if work.release_date <> invalid and work.release_date.Len() >= 4
        meta = work.release_date.Left(4)
    end if
    if work.genres <> invalid and work.genres.Count() > 0
        if meta <> "" then meta += "  •  "
        meta += joinStrings(work.genres, ", ")
    end if
    m.browsePreviewMeta.text = meta
    overview = work.overview
    if overview = invalid or overview = "" then overview = "No synopsis available."
    m.browsePreviewOverview.text = overview
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
        item.description = JsonString(work.overview)
        item.hdPosterUrl = artworkUrl(work)
        item.AddField("httpHeaders", "assocarray", false)
        item.httpHeaders = artworkHeaders(item.hdPosterUrl, headers)
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
    showStatus("Searching", "Looking for “" + query + "”…", true)
    config = AppConfig()
    path = "/api/v1/catalog/search?q=" + UrlEncode(query) + "&limit=" + config.catalogPageSize.ToStr()
    sendApi("search", "GET", path, invalid, true)
end sub

sub acceptSearchResults(data as Object)
    if data = invalid or data.items = invalid
        showStatus("Search unavailable", "The server returned an invalid search response.", false)
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
    showStatus("Loading playlists", "Fetching your playlists…", true)
    sendApi("playlists", "GET", "/api/v1/playlists", invalid, true)
end sub

sub acceptPlaylists(data as Object)
    if data = invalid
        showStatus("Playlists unavailable", "The server returned an invalid playlists response.", false)
        return
    end if
    m.playlists = data
    buildPlaylistDirectoryContent()
    m.playlistDetailOpen = false
    m.playlistDetailGroup.visible = false
    m.playlistsDirectoryGroup.visible = true
    showOnly("playlists")
    m.top.screenState = "playlists"
    m.playlistsGrid.SetFocus(true)
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
        item.AddField("httpHeaders", "assocarray", false)
        item.httpHeaders = {}
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
    m.playlistDetailStage.keyArtUri = ""
    m.playlistItems = []
    m.playlistItemQueue = []
    showStatus("Loading playlist", "Opening “" + playlist.name + "”…", true)
    sendApi("playlistItems", "GET", "/api/v1/playlists/" + UrlEncode(playlist.id) + "/items", invalid, true)
end sub

sub acceptPlaylistItems(data as Object)
    if data = invalid
        showStatus("Playlist unavailable", "The server returned an invalid playlist-items response.", false)
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
        m.playlistDetailStage.keyArtUri = heroArtworkUrl(m.playlistItems[0])
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
        item.description = JsonString(work.overview)
        item.hdPosterUrl = artworkUrl(work)
        item.AddField("httpHeaders", "assocarray", false)
        item.httpHeaders = artworkHeaders(item.hdPosterUrl, headers)
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
    if image.url.Left(7) = "http://" or image.url.Left(8) = "https://" then return image.url
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
function heroArtworkUrl(work as Object) as String
    if work.images = invalid then return ""
    for each image in work.images
        if image.kind = "backdrop" then return resolveImageUrl(work, image)
    end for
    return artworkUrl(work)
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
    showStatus("Loading details", "Opening " + work.title + "…", true)
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
    showStatus("Loading home", "Finding what’s new…", true)
    loadWatchProgress()
end sub

sub loadWatchProgress()
    sendApi("watchProgress", "GET", "/api/v1/playback/progress", invalid, true)
end sub

function itemsFromCatalog(data as Object) as Object
    if data = invalid or data.items = invalid then return []
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
    sendApi("homeWorkDetail", "GET", "/api/v1/catalog/" + UrlEncode(row.work_id), invalid, true)
end sub

sub acceptHomeWorkDetail(data as Object)
    if data <> invalid and data.work <> invalid
        mediaFileId = findFirstMediaFileId(data)
        if mediaFileId <> "" then m.homeContinueEntries.Push(data.work)
    end if
    processNextHomeWork()
end sub

sub finishContinueWatching()
    if m.homeContinueEntries.Count() > 0
        loadHomeMovies()
        return
    end if
    ' No usable in-progress rows: fall back to a "Start Watching" rail of
    ' the 8 most recent items across all kinds, mirroring tv-web's Home page.
    sendApi("homeFallback", "GET", "/api/v1/catalog?available_only=true&sort=recent&limit=8&offset=0", invalid, true)
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

' All rail data sources have arrived (or come back empty) -- assemble
' whichever rails ended up with items, stack them top-to-bottom, hide the
' rest, and show the screen. The TvStage entrance animation only plays the
' first time the viewer lands on home (m.homeShown); returning here later
' (e.g. Back from detail) just refreshes the hero/rail content in place.
sub finishHomeLoad()
    candidates = []
    if m.homeContinueEntries.Count() > 0
        candidates.Push({ group: m.continueRailGroup, title: m.continueTitle, row: m.continueRow, label: "Continue watching", works: m.homeContinueEntries })
    else if m.homeFallbackItems.Count() > 0
        candidates.Push({ group: m.continueRailGroup, title: m.continueTitle, row: m.continueRow, label: "Start watching", works: m.homeFallbackItems })
    end if
    if m.homeMovies.Count() > 0
        candidates.Push({ group: m.moviesRailGroup, title: m.moviesTitle, row: m.moviesRow, label: "New movies", works: m.homeMovies })
    end if
    if m.homeSeries.Count() > 0
        candidates.Push({ group: m.seriesRailGroup, title: m.seriesTitle, row: m.seriesRow, label: "New series", works: m.homeSeries })
    end if
    if m.homeMoreMovies.Count() > 0
        candidates.Push({ group: m.moreMoviesRailGroup, title: m.moreMoviesTitle, row: m.moreMoviesRow, label: "More movies", works: m.homeMoreMovies })
    end if
    if m.homeMoreSeries.Count() > 0
        candidates.Push({ group: m.moreSeriesRailGroup, title: m.moreSeriesTitle, row: m.moreSeriesRow, label: "More series", works: m.homeMoreSeries })
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
    updateHeroFromWork(m.visibleRails[0].works[0])
    showOnly("home")
    m.top.screenState = "home"
    if not m.homeShown
        ' Dot-call syntax (m.homeStage.playEntrance()) reliably throws "Member
        ' function not found" on this device/OS despite the interface field
        ' and backing sub both being correctly declared (confirmed live via
        ' the on-device BrightScript debugger REPL) -- callFunc() is the
        ' robust invocation path for custom interface <function> members.
        m.homeStage.callFunc("playEntrance")
        m.homeShown = true
    end if
    m.visibleRails[0].row.SetFocus(true)
end sub

sub updateHeroFromWork(work as Object)
    if work = invalid then return
    m.homeStage.stageTitle = work.title
    m.homeStage.stageKicker = UCase(work.kind)
    meta = ""
    if work.release_date <> invalid and work.release_date.Len() >= 4
        meta = work.release_date.Left(4)
    end if
    if work.genres <> invalid and work.genres.Count() > 0
        if meta <> "" then meta += "  •  "
        meta += joinStrings(work.genres, ", ")
    end if
    m.homeStage.stageMeta = meta
    m.homeStage.keyArtUri = heroArtworkUrl(work)
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
    updateHeroFromWork(works[itemIndex])
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
    if newIndex < 0 or newIndex >= m.navLabels.Count() then return true
    m.navDockIndex = newIndex
    renderNavDockFocus()
    return true
end function

sub renderNavDockFocus()
    for i = 0 to m.navLabels.Count() - 1
        isFocused = m.navDockMode and i = m.navDockIndex
        m.navHighlights[i].visible = isFocused
        if isFocused
            m.navIcons[i].opacity = 1
            m.navLabels[i].color = &hF4F0F1FF
        else
            m.navIcons[i].opacity = 0.62
            m.navLabels[i].color = &h887A82FF
        end if
    end for
end sub

sub selectNavDockItem()
    kinds = navDockKindList()
    labels = navDockLabelList()
    idx = m.navDockIndex
    if idx < 0 or idx >= kinds.Count() then return
    m.navDockMode = false
    renderNavDockFocus()
    kind = kinds[idx]
    if kind = "home"
        showOnly("home")
        m.top.screenState = "home"
        focusCurrentHomeRail()
    else if kind = "search"
        openSearchDialog()
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
        showStatus("Title unavailable", "The server returned invalid title details.", false)
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
    ' poster once there is hero art behind the title panel. Same helper
    ' Home's updateHeroFromWork already uses, and (like Home) no auth
    ' headers are attached to the Poster's uri fetch, matching that
    ' already-working pattern.
    m.detailStage.keyArtUri = heroArtworkUrl(work)
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
        item.AddField("httpHeaders", "assocarray", false)
        item.httpHeaders = artworkHeaders(thumbUrl, headers)
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
                item.AddField("httpHeaders", "assocarray", false)
                item.httpHeaders = artworkHeaders(item.hdPosterUrl, headers)
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
                item.AddField("httpHeaders", "assocarray", false)
                item.httpHeaders = artworkHeaders(item.hdPosterUrl, headers)
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

function findFirstMediaFileId(value as Dynamic) as String
    if value = invalid then return ""
    valueType = type(value)
    if valueType = "roAssociativeArray"
        if value.media_file_id <> invalid and value.media_file_id <> ""
            return value.media_file_id
        end if
        for each key in value
            result = findFirstMediaFileId(value[key])
            if result <> "" then return result
        end for
    else if valueType = "roArray"
        for each child in value
            result = findFirstMediaFileId(child)
            if result <> "" then return result
        end for
    end if
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
    showStatus("Preparing playback", "Negotiating the best Roku-compatible stream…", true)
    sendApi("playback", "GET", path, invalid, true)
end sub

sub startPlayback(data as Object)
    if data = invalid or data.url = invalid
        showStatus("Playback unavailable", "The server returned invalid playback information.", false)
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
        finishPlayback("completed")
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
    if name <> "playback"
        m.video.visible = false
        m.playerControls.visible = false
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    state = m.top.screenState
    if state = "playback"
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
    else if state = "home" and key = "up"
        ' A focused RowList (Home's rails) consumes Left/Right itself as its
        ' own primary navigation axis and never bubbles them to onKeyEvent at
        ' all (confirmed live via debug-console tracing: onKeyEvent never
        ' even printed for a Left keypress here) -- only Up/Down reliably
        ' bubble up when a RowList has real focus. So unlike tv-web's real
        ' spatial layout (Left enters the fixed left-edge dock from
        ' anywhere), entry into the dock on this platform has to ride the one
        ' direction that actually reaches the Scene: Up, from the topmost
        ' rail, exactly like the old homeShortcuts row this replaced.
        if m.homeFocusIndex = 0
            enterNavDock()
            return true
        end if
        return moveHomeFocus(-1)
    else if state = "home" and key = "down"
        return moveHomeFocus(1)
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
    else if state = "profiles"
        ' profilesRow is now a horizontal avatar row (see MainScene.xml's
        ' profilesGroup comment), and profileActions now sits stacked below
        ' it rather than beside it as a right-hand column -- so switching
        ' focus between the two is Down/Up here, not Left/Right (Left/Right
        ' stay native RowList column navigation within the avatar row
        ' itself).
        if key = "down" and m.profilesRow.HasFocus()
            m.profileActions.SetFocus(true)
            return true
        else if key = "up" and m.profileActions.HasFocus()
            m.profilesRow.SetFocus(true)
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
