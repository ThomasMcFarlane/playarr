sub init()
    m.rootGroup = m.top.findNode("rootGroup")
    m.rootFocus = m.top.findNode("rootFocus")
    m.rootTitle = m.top.findNode("rootTitle")
    m.rootSubtitle = m.top.findNode("rootSubtitle")
    m.breadcrumbGroup = m.top.findNode("breadcrumbGroup")
    m.breadcrumbFocus = m.top.findNode("breadcrumbFocus")
    m.breadcrumbTitle = m.top.findNode("breadcrumbTitle")
    m.entryGroup = m.top.findNode("entryGroup")
    m.entryFocus = m.top.findNode("entryFocus")
    m.entryArtwork = m.top.findNode("entryArtwork")
    m.entryFallback = m.top.findNode("entryFallback")
    m.entryTitle = m.top.findNode("entryTitle")
    m.entryMetadata = m.top.findNode("entryMetadata")
    m.displayType = ""
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return

    m.displayType = content.displayType
    m.rootGroup.visible = m.displayType = "root"
    m.breadcrumbGroup.visible = m.displayType = "breadcrumb"
    m.entryGroup.visible = m.displayType = "directory" or m.displayType = "media" or m.displayType = "empty"

    if m.displayType = "root"
        m.rootTitle.text = content.title
        m.rootSubtitle.text = content.subtitle
        m.rootGroup.opacity = 1
        if content.available <> invalid and not content.available
            m.rootGroup.opacity = 0.55
        end if
    else if m.displayType = "breadcrumb"
        m.breadcrumbTitle.text = content.title
    else
        m.entryTitle.text = content.title
        m.entryMetadata.text = content.subtitle
        m.entryArtwork.uri = ""
        m.entryArtwork.visible = false
        m.entryFallback.visible = true
        m.entryFallback.text = "FOLDER"
        if m.displayType = "media"
            m.entryFallback.text = "PLAY"
            if content.hdPosterUrl <> invalid and content.hdPosterUrl <> ""
                agent = CreateObject("roHttpAgent")
                agent.SetCertificatesFile("common:/certs/ca-bundle.crt")
                agent.InitClientCertificates()
                globalState = GetGlobalAA()
                headers = globalState.playarrArtHeaders
                if headers <> invalid then agent.SetHeaders(headers)
                m.entryArtwork.SetHttpAgent(agent)
                m.entryArtwork.uri = content.hdPosterUrl
                m.entryArtwork.visible = true
                m.entryFallback.visible = false
            end if
        else if m.displayType = "empty"
            m.entryFallback.text = "EMPTY"
        end if
    end if
    onFocusChanged()
end sub

sub onFocusChanged()
    focused = m.top.focusPercent > 0.5
    m.rootFocus.visible = focused and m.displayType = "root"
    m.breadcrumbFocus.visible = focused and m.displayType = "breadcrumb"
    m.entryFocus.visible = focused and (m.displayType = "directory" or m.displayType = "media" or m.displayType = "empty")
end sub
