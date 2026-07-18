sub init()
    m.statusGroup = m.top.findNode("statusGroup")
    m.spinner = m.top.findNode("spinner")
    m.statusTitle = m.top.findNode("statusTitle")
    m.statusMessage = m.top.findNode("statusMessage")
    m.pairingGroup = m.top.findNode("pairingGroup")
    m.pairingInstruction = m.top.findNode("pairingInstruction")
    m.pairingCode = m.top.findNode("pairingCode")
    m.pairingStatus = m.top.findNode("pairingStatus")
    m.profilesGroup = m.top.findNode("profilesGroup")
    m.profilesList = m.top.findNode("profilesList")
    m.profileActions = m.top.findNode("profileActions")
    m.libraryGroup = m.top.findNode("libraryGroup")
    m.library = m.top.findNode("libraryList")
    m.libraryTitle = m.top.findNode("libraryTitle")
    m.detailGroup = m.top.findNode("detailGroup")
    m.detailPoster = m.top.findNode("detailPoster")
    m.detailTitle = m.top.findNode("detailTitle")
    m.detailMeta = m.top.findNode("detailMeta")
    m.detailOverview = m.top.findNode("detailOverview")
    m.detailActions = m.top.findNode("detailActions")
    m.profileLabel = m.top.findNode("profileLabel")
    m.video = m.top.findNode("video")
    m.pairingTimer = m.top.findNode("pairingTimer")
    m.heartbeatTimer = m.top.findNode("heartbeatTimer")

    m.profilesList.ObserveField("itemSelected", "onProfileSelected")
    m.profileActions.ObserveField("itemSelected", "onProfileActionSelected")
    m.library.ObserveField("rowItemSelected", "onLibraryItemSelected")
    m.library.ObserveField("rowItemFocused", "onLibraryItemFocused")
    m.detailActions.ObserveField("itemSelected", "onDetailActionSelected")
    m.pairingTimer.ObserveField("fire", "pollDeviceToken")
    m.heartbeatTimer.ObserveField("fire", "sendHeartbeat")
    m.video.ObserveField("state", "onVideoStateChanged")

    m.requestBusy = false
    m.items = []
    m.totalItems = invalid
    m.profiles = []
    m.playbackSessionId = ""
    m.playbackEnded = true
    m.lastVideoState = ""
    m.session = LoadSession()
    m.serverUrl = NormaliseServerUrl(m.session.serverUrl)
    m.accessToken = m.session.accessToken
    m.refreshToken = m.session.refreshToken
    m.deviceId = m.session.deviceId
    m.profileLabel.text = m.session.profileName
    setListContent(m.profileActions, ["Link another profile", "Change server", "Sign out"])
    setListContent(m.detailActions, ["Play"])

    if m.serverUrl = ""
        openServerDialog()
    else
        showStatus("Connecting", "Checking " + m.serverUrl + "…", true)
        sendApi("version", "GET", "/api/system/version", invalid, false)
    end if
end sub

sub openServerDialog()
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = "Connect to Streamarr"
    dialog.message = "Enter the full HTTP or HTTPS server address."
    dialog.text = m.serverUrl
    dialog.buttons = ["Connect"]
    dialog.ObserveField("buttonSelected", "onServerDialogButton")
    m.top.dialog = dialog
end sub

sub onServerDialogButton(event as Object)
    if event.GetData() <> 0 then return
    candidate = NormaliseServerUrl(m.top.dialog.text)
    if candidate = ""
        m.top.dialog.message = "Use a full address such as https://streamarr.example.invalid"
        return
    end if
    m.serverUrl = candidate
    SaveServerUrl(candidate)
    m.top.dialog.close = true
    showStatus("Connecting", "Checking " + candidate + "…", true)
    sendApi("version", "GET", "/api/system/version", invalid, false)
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
        handleApiFailure(action, result)
        return
    end if

    if action = "version"
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
    else if action = "detail"
        showDetail(result.data)
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

sub showProfiles(data as Dynamic)
    if data = invalid then data = []
    m.profiles = data
    labels = []
    for each profile in data
        suffix = ""
        if profile.is_current then suffix = "  • Linked"
        if profile.pin_locked then suffix += "  • PIN"
        labels.Push(profile.display_name + suffix)
    end for
    if labels.Count() = 0 then labels.Push("Linked viewer")
    setListContent(m.profilesList, labels)
    showOnly("profiles")
    m.top.screenState = "profiles"
    m.profilesList.SetFocus(true)
end sub

sub onProfileSelected(event as Object)
    index = event.GetData()
    if m.profiles.Count() = 0
        enterLibrary("Viewer")
        return
    end if
    profile = m.profiles[index]
    if profile.is_current
        enterLibrary(profile.display_name)
    else
        ClearSession(true)
        m.accessToken = ""
        m.refreshToken = ""
        m.deviceId = ""
        beginPairing()
    end if
end sub

sub onProfileActionSelected(event as Object)
    index = event.GetData()
    if index = 0
        ClearSession(true)
        m.accessToken = ""
        m.refreshToken = ""
        m.deviceId = ""
        beginPairing()
    else if index = 1
        ClearSession(false)
        m.serverUrl = ""
        m.accessToken = ""
        m.refreshToken = ""
        m.deviceId = ""
        openServerDialog()
    else if index = 2
        ClearSession(true)
        m.accessToken = ""
        m.refreshToken = ""
        m.deviceId = ""
        m.profileLabel.text = ""
        beginPairing()
    end if
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
    root = CreateObject("roSGNode", "ContentNode")
    row = root.CreateChild("ContentNode")
    row.title = "Library"
    headers = ClientHeaders(m.accessToken)
    for each work in m.items
        item = row.CreateChild("ContentNode")
        item.id = work.id
        item.title = work.title
        item.description = JsonString(work.overview)
        item.hdPosterUrl = artworkUrl(work)
        item.AddField("httpHeaders", "assocarray", false)
        item.httpHeaders = artworkHeaders(item.hdPosterUrl, headers)
    end for
    m.library.content = root
    if m.totalItems <> invalid
        m.libraryTitle.text = "Library  •  " + m.items.Count().ToStr() + " of " + m.totalItems.ToStr()
    else
        m.libraryTitle.text = "Library  •  " + m.items.Count().ToStr()
    end if
end sub

function artworkUrl(work as Object) as String
    if work.images = invalid then return ""
    fallback = ""
    for each image in work.images
        if fallback = "" then fallback = AbsoluteUrl(m.serverUrl, image.url)
        if image.kind = "poster" then return AbsoluteUrl(m.serverUrl, image.url)
    end for
    return fallback
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
    m.selectedWork = m.items[index]
    showStatus("Loading details", "Opening " + m.selectedWork.title + "…", true)
    sendApi("detail", "GET", "/api/v1/catalog/" + UrlEncode(m.selectedWork.id), invalid, true)
end sub

sub showDetail(detail as Object)
    if detail = invalid or detail.work = invalid
        showStatus("Title unavailable", "The server returned invalid title details.", false)
        return
    end if
    m.selectedDetail = detail
    work = detail.work
    m.detailTitle.text = work.title
    metadata = UCase(work.kind)
    if work.release_date <> invalid and work.release_date.Len() >= 4
        metadata += "  •  " + work.release_date.Left(4)
    end if
    if work.genres <> invalid and work.genres.Count() > 0
        metadata += "  •  " + joinStrings(work.genres, ", ")
    end if
    m.detailMeta.text = metadata
    overview = JsonString(work.overview)
    if overview = "" then overview = "No description is available."
    m.detailOverview.text = overview
    detailPosterUrl = artworkUrl(work)
    detailAgent = CreateObject("roHttpAgent")
    detailAgent.SetCertificatesFile("common:/certs/ca-bundle.crt")
    detailAgent.InitClientCertificates()
    detailAgent.SetHeaders(artworkHeaders(detailPosterUrl, ClientHeaders(m.accessToken)))
    m.detailPoster.SetHttpAgent(detailAgent)
    m.detailPoster.uri = detailPosterUrl
    mediaFileId = findFirstMediaFileId(detail)
    if mediaFileId = ""
        setListContent(m.detailActions, ["Not available to play"])
    else
        setListContent(m.detailActions, ["Play"])
    end if
    showOnly("detail")
    m.top.screenState = "detail"
    m.detailActions.SetFocus(true)
end sub

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
    requestPlayback()
end sub

sub requestPlayback()
    mediaFileId = findFirstMediaFileId(m.selectedDetail)
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
    m.video.content = content
    m.video.visible = true
    m.video.SetFocus(true)
    m.video.control = "play"
    m.heartbeatTimer.control = "start"
    m.top.screenState = "playback"
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
    m.lastVideoState = state
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
    m.statusGroup.visible = name = "status"
    m.pairingGroup.visible = name = "pairing"
    m.profilesGroup.visible = name = "profiles"
    m.libraryGroup.visible = name = "library"
    m.detailGroup.visible = name = "detail"
    if name <> "playback" then m.video.visible = false
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    state = m.top.screenState
    if state = "playback" and key = "back"
        finishPlayback("user_stopped")
        return true
    else if state = "detail" and key = "back"
        showOnly("library")
        m.top.screenState = "library"
        m.library.SetFocus(true)
        return true
    else if state = "library" and key = "back"
        loadProfiles()
        return true
    else if state = "profiles"
        if key = "right" and m.profilesList.HasFocus()
            m.profileActions.SetFocus(true)
            return true
        else if key = "left" and m.profileActions.HasFocus()
            m.profilesList.SetFocus(true)
            return true
        end if
    else if state = "status" and key = "OK" and not m.requestBusy
        if m.lastFailedAction = "detail" and m.selectedWork <> invalid
            sendApi("detail", "GET", "/api/v1/catalog/" + UrlEncode(m.selectedWork.id), invalid, true)
        else if m.lastFailedAction = "playback"
            requestPlayback()
        else
            sendApi("version", "GET", "/api/system/version", invalid, false)
        end if
        return true
    end if
    return false
end function
