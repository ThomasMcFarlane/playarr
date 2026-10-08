' TvStage.brs
'
' Backing logic for TvStage.xml. Wires the stageTitle/stageKicker/stageMeta/
' keyArtUri interface fields into the Label/Poster nodes declared in XML, and
' exposes contentTarget + show() for other scenes to build page content on
' top of this shared "stage" composition (see TvStage.xml for the CSS ->
' SceneGraph substitution notes).

sub init()
    PlayarrFontifyTree(m.top)
    ThemeSetRole(m.top.findNode("keyArtFade"), "bg")
    ThemeInitComponent()
    m.keyArtLayer = m.top.findNode("keyArtLayer")
    m.keyArt = m.top.findNode("keyArt")
    m.keyArtRetryTimer = m.top.findNode("keyArtRetryTimer")
    m.keyArtRetryTimer.ObserveField("fire", "onKeyArtRetry")
    m.keyArt.ObserveField("loadStatus", "onKeyArtLoadStatus")
    m.keyArtBase = ""
    m.keyArtRetries = 0
    m.titlePanel = m.top.findNode("titlePanel")
    m.stageKickerLabel = m.top.findNode("stageKickerLabel")
    m.stageTitleLabel = m.top.findNode("stageTitleLabel")
    m.stageMetaLabel = m.top.findNode("stageMetaLabel")
    m.stageOverviewLabel = m.top.findNode("stageOverviewLabel")
    m.contentPanel = m.top.findNode("contentPanel")
    m.entranceAnimation = m.top.findNode("entranceAnimation")

    m.top.contentTarget = m.contentPanel

    resetForEntrance()
end sub

' Restores the pre-entrance (hidden/offset) state of every animated layer so
' show() can be called more than once (e.g. a scene re-entering this stage
' for a different title) and still play the full entrance each time.
sub resetForEntrance()
    m.keyArtLayer.opacity = 0
    m.keyArtLayer.translation = [15, 0]
    m.titlePanel.opacity = 0
    m.titlePanel.translation = [119.6, 259.2]
    m.contentPanel.opacity = 0
    m.contentPanel.translation = [941.6, 422.9]
end sub

' Force every stage layer fully visible at its settled translation.
' Used when re-entering Home (entrance already played once) and as a
' recovery path so rails never stay stuck at opacity 0 if the staggered
' entrance Animation does not run.
sub revealStage()
    if m.entranceAnimation <> invalid then m.entranceAnimation.control = "stop"
    m.keyArtLayer.opacity = 1
    m.keyArtLayer.translation = [0, 0]
    m.titlePanel.opacity = 1
    m.titlePanel.translation = [153.6, 259.2]
    m.contentPanel.opacity = 1
    m.contentPanel.translation = [881.6, 422.9]
end sub

sub onKeyArtUriChange()
    uri = m.top.keyArtUri
    if uri = ""
        m.keyArt.uri = ""
        return
    end if
    ' Async only. A previous sync GetToFile() blocked the SceneGraph
    ' thread during finishHomeLoad (before playEntrance), so Home stayed
    ' at contentPanel.opacity=0 with left nav only until the download
    ' finished or hung. PosterCard's roHttpAgent path is the proven one.
    m.keyArtAgent = CreateObject("roHttpAgent")
    m.keyArtAgent.SetCertificatesFile("common:/certs/ca-bundle.crt")
    m.keyArtAgent.InitClientCertificates()
    if m.top.keyArtHeaders <> invalid
        m.keyArtAgent.SetHeaders(m.top.keyArtHeaders)
    end if
    m.keyArt.SetHttpAgent(m.keyArtAgent)
    m.keyArt.loadWidth = 1038
    m.keyArt.loadHeight = 1191
    m.keyArtBase = uri
    m.keyArtRetries = 0
    m.keyArtRetryTimer.control = "stop"
    m.keyArt.uri = uri
    if Instr(1, uri, "style=stage") > 0 then m.keyArt.opacity = 1 else m.keyArt.opacity = 0.4
    m.keyArtRetryTimer.duration = 10
    m.keyArtRetryTimer.control = "start"
    if m.keyArtLayer <> invalid then m.keyArtLayer.opacity = 1
end sub

sub onStageKickerChange()
    ' Web .tv-provider: 12.3 px, weight 820, 0.08em tracking, upper case, brand colour.
    m.stageKickerLabel.spec = { text: m.top.stageKicker, size: 12, weight: 800, tracking: 0.983, role: "brand", upper: true }
end sub

sub onStageTitleChange()
    ' Web .tv-title-panel h1: 69.1 px, weight 560, -0.075em tracking, 62.2 px lines, max-width 9ch (373 px), text-wrap: balance.
    m.stageTitleLabel.spec = { text: m.top.stageTitle, size: 69, weight: 560, tracking: -4.977, role: "ink", width: 373.2, lineHeight: 62.208, maxLines: 3, balance: true }
    layoutStageText()
end sub

sub onStageMetaChange()
    m.stageMetaLabel.text = m.top.stageMeta
    layoutStageText()
end sub

sub onStageOverviewChange()
    ' Web synopsis: 12.9 px (drawn at 14: Roku renders small text about 8 % narrower), 20.3 px lines, 336 px wide, five lines.
    m.stageOverviewLabel.spec = { text: m.top.stageOverview, size: 14, weight: 400, tracking: 0, role: "inkMuted", width: 336, lineHeight: 20.33, maxLines: 5 }
    layoutStageText()
end sub

' The web flows meta and synopsis under the title: one title line puts the meta row 27 px below it, the synopsis 37.5 px
' under the meta (or 21.6 px under the title when there is no meta row). Title lines are 61 px apart at 69 px.
sub layoutStageText()
    lines = m.stageTitleLabel.lineCount
    if lines < 1 then lines = 1
    if lines > 3 then lines = 3
    titleBottom = 44.3 + 62.208 * lines
    if m.top.stageMeta <> invalid and m.top.stageMeta <> ""
        m.stageMetaLabel.translation = [0, titleBottom + 27]
        m.stageOverviewLabel.translation = [0, titleBottom + 27 + 37.5]
    else
        m.stageMetaLabel.translation = [0, titleBottom + 27]
        m.stageOverviewLabel.translation = [0, titleBottom + 21.6]
    end if
end sub

' Public entry point (declared as a <function> in TvStage.xml). Other scenes
' call this once they have set stageTitle/stageKicker/stageMeta and inserted
' their own rail/grid content under contentTarget's children.
sub playEntrance()
    resetForEntrance()
    m.entranceAnimation.control = "start"
end sub

sub onKeyArtLoadStatus()
    if m.keyArt.loadStatus = "ready" then m.keyArtRetryTimer.control = "stop"
    if m.keyArt.loadStatus = "failed" and m.keyArtBase <> "" and m.keyArtRetries < 8
        m.keyArtRetryTimer.control = "start"
    end if
end sub

sub onKeyArtRetry()
    if m.keyArt.loadStatus = "ready" then return
    m.keyArtRetries = m.keyArtRetries + 1
    sep = "?"
    if Instr(1, m.keyArtBase, "?") > 0 then sep = "&"
    m.keyArt.uri = m.keyArtBase + sep + "retry=" + m.keyArtRetries.ToStr()
    ' Keep watching: a request that hangs without failing is tried again after 10 s.
    m.keyArtRetryTimer.duration = 10
    m.keyArtRetryTimer.control = "start"
end sub
